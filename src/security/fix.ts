import JSON5 from "json5";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { createConfigIO } from "../config/config.js";
import { INCLUDE_KEY, MAX_INCLUDE_DEPTH } from "../config/includes.js";
import { resolveConfigPath, resolveOAuthDir, resolveStateDir } from "../config/paths.js";
import { readChannelAllowFromStore } from "../pairing/pairing-store.js";
import { runExec } from "../process/exec.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { migrateCredentialsAutoFix, type CredentialMigrationResult } from "./audit-credentials.js";
import { createIcaclsResetCommand, formatIcaclsResetCommand, type ExecFn } from "./windows-acl.js";

export type SecurityFixChmodAction = {
  kind: "chmod";
  path: string;
  mode: number;
  ok: boolean;
  skipped?: string;
  error?: string;
};

export type SecurityFixIcaclsAction = {
  kind: "icacls";
  path: string;
  command: string;
  ok: boolean;
  skipped?: string;
  error?: string;
};

export type SecurityFixCredentialMigrationAction = {
  kind: "credential-migration";
  ok: boolean;
  migrated: number;
  failed: number;
  skipped: number;
  filesDeleted: string[];
  details: Array<{
    key: string;
    status: "migrated" | "failed" | "skipped";
    error?: string;
    fromFile?: string;
  }>;
};

export type SecurityFixAction =
  | SecurityFixChmodAction
  | SecurityFixIcaclsAction
  | SecurityFixCredentialMigrationAction;

export type SecurityFixResult = {
  ok: boolean;
  stateDir: string;
  configPath: string;
  configWritten: boolean;
  changes: string[];
  actions: SecurityFixAction[];
  errors: string[];
};

/**
 * Securely delete a file by overwriting with random data before unlinking.
 */
async function secureDeleteFile(filePath: string): Promise<boolean> {
  try {
    const stat = fsSync.statSync(filePath);
    if (!stat.isFile()) return false;

    // Overwrite with random data
    const randomData = crypto.randomBytes(stat.size);
    fsSync.writeFileSync(filePath, randomData);

    // Overwrite with zeros
    fsSync.writeFileSync(filePath, Buffer.alloc(stat.size, 0));

    // Unlink
    fsSync.unlinkSync(filePath);
    return true;
  } catch {
    // Fall back to regular delete
    try {
      fsSync.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Perform credential migration as part of security fix.
 */
async function performCredentialMigration(params: {
  stateDir: string;
  secureDelete: boolean;
}): Promise<SecurityFixCredentialMigrationAction> {
  const result = await migrateCredentialsAutoFix({
    stateDir: params.stateDir,
    secureDelete: params.secureDelete,
  });

  const filesDeleted: string[] = [];

  // Securely delete files if requested and migration was successful
  if (params.secureDelete && result.ok && result.filesToDelete.length > 0) {
    for (const filePath of result.filesToDelete) {
      const deleted = await secureDeleteFile(filePath);
      if (deleted) {
        filesDeleted.push(filePath);
      }
    }
  }

  return {
    kind: "credential-migration",
    ok: result.ok,
    migrated: result.migrated,
    failed: result.failed,
    skipped: result.skipped,
    filesDeleted,
    details: result.details,
  };
}

async function safeChmod(params: {
  path: string;
  mode: number;
  require: "dir" | "file";
}): Promise<SecurityFixChmodAction> {
  try {
    const st = await fs.lstat(params.path);
    if (st.isSymbolicLink()) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "symlink",
      };
    }
    if (params.require === "dir" && !st.isDirectory()) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "not-a-directory",
      };
    }
    if (params.require === "file" && !st.isFile()) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "not-a-file",
      };
    }
    const current = st.mode & 0o777;
    if (current === params.mode) {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "already",
      };
    }
    await fs.chmod(params.path, params.mode);
    return { kind: "chmod", path: params.path, mode: params.mode, ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        kind: "chmod",
        path: params.path,
        mode: params.mode,
        ok: false,
        skipped: "missing",
      };
    }
    return {
      kind: "chmod",
      path: params.path,
      mode: params.mode,
      ok: false,
      error: String(err),
    };
  }
}

async function safeAclReset(params: {
  path: string;
  require: "dir" | "file";
  env: NodeJS.ProcessEnv;
  exec?: ExecFn;
}): Promise<SecurityFixIcaclsAction> {
  const display = formatIcaclsResetCommand(params.path, {
    isDir: params.require === "dir",
    env: params.env,
  });
  try {
    const st = await fs.lstat(params.path);
    if (st.isSymbolicLink()) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "symlink",
      };
    }
    if (params.require === "dir" && !st.isDirectory()) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "not-a-directory",
      };
    }
    if (params.require === "file" && !st.isFile()) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "not-a-file",
      };
    }
    const cmd = createIcaclsResetCommand(params.path, {
      isDir: st.isDirectory(),
      env: params.env,
    });
    if (!cmd) {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "missing-user",
      };
    }
    const exec = params.exec ?? runExec;
    await exec(cmd.command, cmd.args);
    return { kind: "icacls", path: params.path, command: cmd.display, ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        kind: "icacls",
        path: params.path,
        command: display,
        ok: false,
        skipped: "missing",
      };
    }
    return {
      kind: "icacls",
      path: params.path,
      command: display,
      ok: false,
      error: String(err),
    };
  }
}

function setGroupPolicyAllowlist(params: {
  cfg: OpenClawConfig;
  channel: string;
  changes: string[];
  policyFlips: Set<string>;
}): void {
  if (!params.cfg.channels) {
    return;
  }
  const section = params.cfg.channels[params.channel as keyof OpenClawConfig["channels"]] as
    | Record<string, unknown>
    | undefined;
  if (!section || typeof section !== "object") {
    return;
  }

  const topPolicy = section.groupPolicy;
  if (topPolicy === "open") {
    section.groupPolicy = "allowlist";
    params.changes.push(`channels.${params.channel}.groupPolicy=open -> allowlist`);
    params.policyFlips.add(`channels.${params.channel}.`);
  }

  const accounts = section.accounts;
  if (!accounts || typeof accounts !== "object") {
    return;
  }
  for (const [accountId, accountValue] of Object.entries(accounts)) {
    if (!accountId) {
      continue;
    }
    if (!accountValue || typeof accountValue !== "object") {
      continue;
    }
    const account = accountValue as Record<string, unknown>;
    if (account.groupPolicy === "open") {
      account.groupPolicy = "allowlist";
      params.changes.push(
        `channels.${params.channel}.accounts.${accountId}.groupPolicy=open -> allowlist`,
      );
      params.policyFlips.add(`channels.${params.channel}.accounts.${accountId}.`);
    }
  }
}

function setWhatsAppGroupAllowFromFromStore(params: {
  cfg: OpenClawConfig;
  storeAllowFrom: string[];
  changes: string[];
  policyFlips: Set<string>;
}): void {
  const section = params.cfg.channels?.whatsapp as Record<string, unknown> | undefined;
  if (!section || typeof section !== "object") {
    return;
  }
  if (params.storeAllowFrom.length === 0) {
    return;
  }

  const maybeApply = (prefix: string, obj: Record<string, unknown>) => {
    if (!params.policyFlips.has(prefix)) {
      return;
    }
    const allowFrom = Array.isArray(obj.allowFrom) ? obj.allowFrom : [];
    const groupAllowFrom = Array.isArray(obj.groupAllowFrom) ? obj.groupAllowFrom : [];
    if (allowFrom.length > 0) {
      return;
    }
    if (groupAllowFrom.length > 0) {
      return;
    }
    obj.groupAllowFrom = params.storeAllowFrom;
    params.changes.push(`${prefix}groupAllowFrom=pairing-store`);
  };

  maybeApply("channels.whatsapp.", section);

  const accounts = section.accounts;
  if (!accounts || typeof accounts !== "object") {
    return;
  }
  for (const [accountId, accountValue] of Object.entries(accounts)) {
    if (!accountValue || typeof accountValue !== "object") {
      continue;
    }
    const account = accountValue as Record<string, unknown>;
    maybeApply(`channels.whatsapp.accounts.${accountId}.`, account);
  }
}

function applyConfigFixes(params: { cfg: OpenClawConfig; env: NodeJS.ProcessEnv }): {
  cfg: OpenClawConfig;
  changes: string[];
  policyFlips: Set<string>;
} {
  const next = structuredClone(params.cfg ?? {});
  const changes: string[] = [];
  const policyFlips = new Set<string>();

  if (next.logging?.redactSensitive === "off") {
    next.logging = { ...next.logging, redactSensitive: "tools" };
    changes.push('logging.redactSensitive=off -> "tools"');
  }

  for (const channel of [
    "telegram",
    "whatsapp",
    "discord",
    "signal",
    "imessage",
    "slack",
    "msteams",
  ]) {
    setGroupPolicyAllowlist({ cfg: next, channel, changes, policyFlips });
  }

  return { cfg: next, changes, policyFlips };
}

function listDirectIncludes(parsed: unknown): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    const rec = value as Record<string, unknown>;
    const includeVal = rec[INCLUDE_KEY];
    if (typeof includeVal === "string") {
      out.push(includeVal);
    } else if (Array.isArray(includeVal)) {
      for (const item of includeVal) {
        if (typeof item === "string") {
          out.push(item);
        }
      }
    }
    for (const v of Object.values(rec)) {
      visit(v);
    }
  };
  visit(parsed);
  return out;
}

function resolveIncludePath(baseConfigPath: string, includePath: string): string {
  return path.normalize(
    path.isAbsolute(includePath)
      ? includePath
      : path.resolve(path.dirname(baseConfigPath), includePath),
  );
}

async function collectIncludePathsRecursive(params: {
  configPath: string;
  parsed: unknown;
}): Promise<string[]> {
  const visited = new Set<string>();
  const result: string[] = [];

  const walk = async (basePath: string, parsed: unknown, depth: number): Promise<void> => {
    if (depth > MAX_INCLUDE_DEPTH) {
      return;
    }
    for (const raw of listDirectIncludes(parsed)) {
      const resolved = resolveIncludePath(basePath, raw);
      if (visited.has(resolved)) {
        continue;
      }
      visited.add(resolved);
      result.push(resolved);
      const rawText = await fs.readFile(resolved, "utf-8").catch(() => null);
      if (!rawText) {
        continue;
      }
      const nestedParsed = (() => {
        try {
          return JSON5.parse(rawText);
        } catch {
          return null;
        }
      })();
      if (nestedParsed) {
        // eslint-disable-next-line no-await-in-loop
        await walk(resolved, nestedParsed, depth + 1);
      }
    }
  };

  await walk(params.configPath, params.parsed, 0);
  return result;
}

async function chmodCredentialsAndAgentState(params: {
  env: NodeJS.ProcessEnv;
  stateDir: string;
  cfg: OpenClawConfig;
  actions: SecurityFixAction[];
  applyPerms: (params: {
    path: string;
    mode: number;
    require: "dir" | "file";
  }) => Promise<SecurityFixAction>;
}): Promise<void> {
  const credsDir = resolveOAuthDir(params.env, params.stateDir);
  params.actions.push(await safeChmod({ path: credsDir, mode: 0o700, require: "dir" }));

  const credsEntries = await fs.readdir(credsDir, { withFileTypes: true }).catch(() => []);
  for (const entry of credsEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".json")) {
      continue;
    }
    const p = path.join(credsDir, entry.name);
    // eslint-disable-next-line no-await-in-loop
    params.actions.push(await safeChmod({ path: p, mode: 0o600, require: "file" }));
  }

  const ids = new Set<string>();
  ids.add(resolveDefaultAgentId(params.cfg));
  const list = Array.isArray(params.cfg.agents?.list) ? params.cfg.agents?.list : [];
  for (const agent of list ?? []) {
    if (!agent || typeof agent !== "object") {
      continue;
    }
    const id =
      typeof (agent as { id?: unknown }).id === "string" ? (agent as { id: string }).id.trim() : "";
    if (id) {
      ids.add(id);
    }
  }

  for (const agentId of ids) {
    const normalizedAgentId = normalizeAgentId(agentId);
    const agentRoot = path.join(params.stateDir, "agents", normalizedAgentId);
    const agentDir = path.join(agentRoot, "agent");
    const sessionsDir = path.join(agentRoot, "sessions");

    // eslint-disable-next-line no-await-in-loop
    params.actions.push(await safeChmod({ path: agentRoot, mode: 0o700, require: "dir" }));
    // eslint-disable-next-line no-await-in-loop
    params.actions.push(await params.applyPerms({ path: agentDir, mode: 0o700, require: "dir" }));

    const authPath = path.join(agentDir, "auth-profiles.json");
    // eslint-disable-next-line no-await-in-loop
    params.actions.push(await params.applyPerms({ path: authPath, mode: 0o600, require: "file" }));

    // eslint-disable-next-line no-await-in-loop
    params.actions.push(
      await params.applyPerms({ path: sessionsDir, mode: 0o700, require: "dir" }),
    );

    const storePath = path.join(sessionsDir, "sessions.json");
    // eslint-disable-next-line no-await-in-loop
    params.actions.push(await params.applyPerms({ path: storePath, mode: 0o600, require: "file" }));
  }
}

export async function fixSecurityFootguns(opts?: {
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  configPath?: string;
  platform?: NodeJS.Platform;
  exec?: ExecFn;
  /** If true, migrate plaintext credentials to secure storage. */
  migrateCredentials?: boolean;
  /** If true, securely delete plaintext files after migration. */
  secureDeletePlaintext?: boolean;
}): Promise<SecurityFixResult> {
  const env = opts?.env ?? process.env;
  const platform = opts?.platform ?? process.platform;
  const exec = opts?.exec ?? runExec;
  const isWindows = platform === "win32";
  const stateDir = opts?.stateDir ?? resolveStateDir(env);
  const configPath = opts?.configPath ?? resolveConfigPath(env, stateDir);
  const actions: SecurityFixAction[] = [];
  const errors: string[] = [];

  const io = createConfigIO({ env, configPath });
  const snap = await io.readConfigFileSnapshot();
  if (!snap.valid) {
    errors.push(...snap.issues.map((i) => `${i.path}: ${i.message}`));
  }

  let configWritten = false;
  let changes: string[] = [];
  if (snap.valid) {
    const fixed = applyConfigFixes({ cfg: snap.config, env });
    changes = fixed.changes;

    const whatsappStoreAllowFrom = await readChannelAllowFromStore("whatsapp", env).catch(() => []);
    if (whatsappStoreAllowFrom.length > 0) {
      setWhatsAppGroupAllowFromFromStore({
        cfg: fixed.cfg,
        storeAllowFrom: whatsappStoreAllowFrom,
        changes,
        policyFlips: fixed.policyFlips,
      });
    }

    if (changes.length > 0) {
      try {
        await io.writeConfigFile(fixed.cfg);
        configWritten = true;
      } catch (err) {
        errors.push(`writeConfigFile failed: ${String(err)}`);
      }
    }
  }

  // Credential migration (if enabled)
  if (opts?.migrateCredentials !== false) {
    const migrationResult = await performCredentialMigration({
      stateDir,
      secureDelete: opts?.secureDeletePlaintext ?? false,
    }).catch((err) => {
      errors.push(`credential migration failed: ${String(err)}`);
      return null;
    });

    if (migrationResult) {
      actions.push(migrationResult);
      if (migrationResult.migrated > 0) {
        changes.push(`Migrated ${migrationResult.migrated} credential(s) to secure storage`);
      }
      if (migrationResult.filesDeleted.length > 0) {
        changes.push(`Securely deleted ${migrationResult.filesDeleted.length} plaintext file(s)`);
      }
    }
  }

  const applyPerms = (params: { path: string; mode: number; require: "dir" | "file" }) =>
    isWindows
      ? safeAclReset({ path: params.path, require: params.require, env, exec })
      : safeChmod({ path: params.path, mode: params.mode, require: params.require });

  actions.push(await applyPerms({ path: stateDir, mode: 0o700, require: "dir" }));
  actions.push(await applyPerms({ path: configPath, mode: 0o600, require: "file" }));

  if (snap.exists) {
    const includePaths = await collectIncludePathsRecursive({
      configPath: snap.path,
      parsed: snap.parsed,
    }).catch(() => []);
    for (const p of includePaths) {
      // eslint-disable-next-line no-await-in-loop
      actions.push(await applyPerms({ path: p, mode: 0o600, require: "file" }));
    }
  }

  await chmodCredentialsAndAgentState({
    env,
    stateDir,
    cfg: snap.config ?? {},
    actions,
    applyPerms,
  }).catch((err) => {
    errors.push(`chmodCredentialsAndAgentState failed: ${String(err)}`);
  });

  return {
    ok: errors.length === 0,
    stateDir,
    configPath,
    configWritten,
    changes,
    actions,
    errors,
  };
}

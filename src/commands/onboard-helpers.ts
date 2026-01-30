import fs from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";

import { cancel, isCancel } from "@clack/prompts";

import { DEFAULT_AGENT_WORKSPACE_DIR, ensureAgentWorkspace } from "../agents/workspace.js";
import type { MoltbotConfig } from "../config/config.js";
import { CONFIG_PATH } from "../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions.js";
import { createCredentialStore } from "../credentials/index.js";
import { callGateway } from "../gateway/call.js";
import { normalizeControlUiBasePath } from "../gateway/control-ui-shared.js";
import { isSafeExecutableValue } from "../infra/exec-safety.js";
import { pickPrimaryTailnetIPv4 } from "../infra/tailnet.js";
import { isWSL } from "../infra/wsl.js";
import { runCommandWithTimeout } from "../process/exec.js";
import type { RuntimeEnv } from "../runtime.js";
import { stylePromptTitle } from "../terminal/prompt-style.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import {
  CONFIG_DIR,
  resolveUserPath,
  shortenHomeInString,
  shortenHomePath,
  sleep,
} from "../utils.js";
import { VERSION } from "../version.js";
import { generateAndValidateToken } from "../gateway/token.js";
import type { NodeManagerChoice, OnboardMode, ResetScope } from "./onboard-types.js";

/**
 * Credential key for storing the gateway authentication token in keychain.
 */
export const GATEWAY_TOKEN_CREDENTIAL_KEY = "gateway-auth-token";

export function guardCancel<T>(value: T | symbol, runtime: RuntimeEnv): T {
  if (isCancel(value)) {
    cancel(stylePromptTitle("Setup cancelled.") ?? "Setup cancelled.");
    runtime.exit(0);
  }
  return value as T;
}

export function summarizeExistingConfig(config: MoltbotConfig): string {
  const rows: string[] = [];
  const defaults = config.agents?.defaults;
  if (defaults?.workspace) rows.push(shortenHomeInString(`workspace: ${defaults.workspace}`));
  if (defaults?.model) {
    const model = typeof defaults.model === "string" ? defaults.model : defaults.model.primary;
    if (model) rows.push(shortenHomeInString(`model: ${model}`));
  }
  if (config.gateway?.mode) rows.push(shortenHomeInString(`gateway.mode: ${config.gateway.mode}`));
  if (typeof config.gateway?.port === "number") {
    rows.push(shortenHomeInString(`gateway.port: ${config.gateway.port}`));
  }
  if (config.gateway?.bind) rows.push(shortenHomeInString(`gateway.bind: ${config.gateway.bind}`));
  if (config.gateway?.remote?.url) {
    rows.push(shortenHomeInString(`gateway.remote.url: ${config.gateway.remote.url}`));
  }
  if (config.skills?.install?.nodeManager) {
    rows.push(shortenHomeInString(`skills.nodeManager: ${config.skills.install.nodeManager}`));
  }
  return rows.length ? rows.join("\n") : "No key settings detected.";
}

/**
 * Generate a cryptographically secure gateway token.
 * Uses base64url encoding for URL-safe, compact output.
 * Validates entropy before returning.
 */
export function randomToken(): string {
  return generateAndValidateToken();
}

/**
 * Result of storing a gateway token in keychain.
 */
export type StoreGatewayTokenResult = {
  ok: boolean;
  backend: string;
  error?: string;
};

/**
 * Store the gateway authentication token in the secure credential store (keychain).
 *
 * This provides an additional layer of protection for the gateway token beyond
 * storing it in the config file. Native apps can retrieve the token from keychain
 * without reading the config file.
 *
 * @param token - The gateway authentication token to store.
 * @returns Result indicating success/failure and the backend used.
 */
export async function storeGatewayTokenInKeychain(token: string): Promise<StoreGatewayTokenResult> {
  try {
    const store = await createCredentialStore({ preferredBackend: "keychain" });

    const result = await store.store(GATEWAY_TOKEN_CREDENTIAL_KEY, token, {
      label: "Gateway Authentication Token",
      tags: ["gateway", "auth", "auto-generated"],
    });

    if (!result.ok) {
      return { ok: false, backend: store.backend, error: result.error };
    }

    return { ok: true, backend: store.backend };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, backend: "unknown", error };
  }
}

/**
 * Retrieve the gateway authentication token from the secure credential store.
 *
 * @returns The token if found, or null if not stored in keychain.
 */
export async function retrieveGatewayTokenFromKeychain(): Promise<string | null> {
  try {
    const store = await createCredentialStore({ preferredBackend: "keychain" });
    const result = await store.retrieve(GATEWAY_TOKEN_CREDENTIAL_KEY);

    if (!result.ok) {
      return null;
    }

    return result.value.value;
  } catch {
    return null;
  }
}

export function printWizardHeader(runtime: RuntimeEnv) {
  const header = [
    "▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄",
    "██░▄▀▄░██░▄▄▄░██░████▄▄░▄▄██░▄▄▀██░▄▄▄░█▄▄░▄▄██",
    "██░█░█░██░███░██░██████░████░▄▄▀██░███░███░████",
    "██░███░██░▀▀▀░██░▀▀░███░████░▀▀░██░▀▀▀░███░████",
    "▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
    "               🦞 FRESH DAILY 🦞                ",
    " ",
  ].join("\n");
  runtime.log(header);
}

export function applyWizardMetadata(
  cfg: MoltbotConfig,
  params: { command: string; mode: OnboardMode },
): MoltbotConfig {
  const commit = process.env.GIT_COMMIT?.trim() || process.env.GIT_SHA?.trim() || undefined;
  return {
    ...cfg,
    wizard: {
      ...cfg.wizard,
      lastRunAt: new Date().toISOString(),
      lastRunVersion: VERSION,
      lastRunCommit: commit,
      lastRunCommand: params.command,
      lastRunMode: params.mode,
    },
  };
}

type BrowserOpenSupport = {
  ok: boolean;
  reason?: string;
  command?: string;
};

type BrowserOpenCommand = {
  argv: string[] | null;
  reason?: string;
  command?: string;
  /**
   * Whether the URL must be wrapped in quotes when appended to argv.
   * Needed for Windows `cmd /c start` where `&` splits commands.
   */
  quoteUrl?: boolean;
};

export async function resolveBrowserOpenCommand(): Promise<BrowserOpenCommand> {
  const platform = process.platform;
  const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const isSsh =
    Boolean(process.env.SSH_CLIENT) ||
    Boolean(process.env.SSH_TTY) ||
    Boolean(process.env.SSH_CONNECTION);

  if (isSsh && !hasDisplay && platform !== "win32") {
    return { argv: null, reason: "ssh-no-display" };
  }

  if (platform === "win32") {
    return {
      argv: ["cmd", "/c", "start", ""],
      command: "cmd",
      quoteUrl: true,
    };
  }

  if (platform === "darwin") {
    const hasOpen = await detectBinary("open");
    return hasOpen ? { argv: ["open"], command: "open" } : { argv: null, reason: "missing-open" };
  }

  if (platform === "linux") {
    const wsl = await isWSL();
    if (!hasDisplay && !wsl) {
      return { argv: null, reason: "no-display" };
    }
    if (wsl) {
      const hasWslview = await detectBinary("wslview");
      if (hasWslview) return { argv: ["wslview"], command: "wslview" };
      if (!hasDisplay) return { argv: null, reason: "wsl-no-wslview" };
    }
    const hasXdgOpen = await detectBinary("xdg-open");
    return hasXdgOpen
      ? { argv: ["xdg-open"], command: "xdg-open" }
      : { argv: null, reason: "missing-xdg-open" };
  }

  return { argv: null, reason: "unsupported-platform" };
}

export async function detectBrowserOpenSupport(): Promise<BrowserOpenSupport> {
  const resolved = await resolveBrowserOpenCommand();
  if (!resolved.argv) return { ok: false, reason: resolved.reason };
  return { ok: true, command: resolved.command };
}

export function formatControlUiSshHint(params: {
  port: number;
  basePath?: string;
  token?: string;
}): string {
  const basePath = normalizeControlUiBasePath(params.basePath);
  const uiPath = basePath ? `${basePath}/` : "/";
  const localUrl = `http://localhost:${params.port}${uiPath}`;
  const tokenParam = params.token ? `?token=${encodeURIComponent(params.token)}` : "";
  const authedUrl = params.token ? `${localUrl}${tokenParam}` : undefined;
  const sshTarget = resolveSshTargetHint();
  return [
    "No GUI detected. Open from your computer:",
    `ssh -N -L ${params.port}:127.0.0.1:${params.port} ${sshTarget}`,
    "Then open:",
    localUrl,
    authedUrl,
    "Docs:",
    "https://docs.molt.bot/gateway/remote",
    "https://docs.molt.bot/web/control-ui",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveSshTargetHint(): string {
  const user = process.env.USER || process.env.LOGNAME || "user";
  const conn = process.env.SSH_CONNECTION?.trim().split(/\s+/);
  const host = conn?.[2] ?? "<host>";
  return `${user}@${host}`;
}

export async function openUrl(url: string): Promise<boolean> {
  if (shouldSkipBrowserOpenInTests()) return false;
  const resolved = await resolveBrowserOpenCommand();
  if (!resolved.argv) return false;
  const quoteUrl = resolved.quoteUrl === true;
  const command = [...resolved.argv];
  if (quoteUrl) {
    if (command.at(-1) === "") {
      // Preserve the empty title token for `start` when using verbatim args.
      command[command.length - 1] = '""';
    }
    command.push(`"${url}"`);
  } else {
    command.push(url);
  }
  try {
    await runCommandWithTimeout(command, {
      timeoutMs: 5_000,
      windowsVerbatimArguments: quoteUrl,
    });
    return true;
  } catch {
    // ignore; we still print the URL for manual open
    return false;
  }
}

export async function openUrlInBackground(url: string): Promise<boolean> {
  if (shouldSkipBrowserOpenInTests()) return false;
  if (process.platform !== "darwin") return false;
  const resolved = await resolveBrowserOpenCommand();
  if (!resolved.argv || resolved.command !== "open") return false;
  const command = ["open", "-g", url];
  try {
    await runCommandWithTimeout(command, { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function ensureWorkspaceAndSessions(
  workspaceDir: string,
  runtime: RuntimeEnv,
  options?: { skipBootstrap?: boolean; agentId?: string },
) {
  const ws = await ensureAgentWorkspace({
    dir: workspaceDir,
    ensureBootstrapFiles: !options?.skipBootstrap,
  });
  runtime.log(`Workspace OK: ${shortenHomePath(ws.dir)}`);
  const sessionsDir = resolveSessionTranscriptsDirForAgent(options?.agentId);
  await fs.mkdir(sessionsDir, { recursive: true });
  runtime.log(`Sessions OK: ${shortenHomePath(sessionsDir)}`);
}

export function resolveNodeManagerOptions(): Array<{
  value: NodeManagerChoice;
  label: string;
}> {
  return [
    { value: "npm", label: "npm" },
    { value: "pnpm", label: "pnpm" },
    { value: "bun", label: "bun" },
  ];
}

export async function moveToTrash(pathname: string, runtime: RuntimeEnv): Promise<void> {
  if (!pathname) return;
  try {
    await fs.access(pathname);
  } catch {
    return;
  }
  try {
    await runCommandWithTimeout(["trash", pathname], { timeoutMs: 5000 });
    runtime.log(`Moved to Trash: ${shortenHomePath(pathname)}`);
  } catch {
    runtime.log(`Failed to move to Trash (manual delete): ${shortenHomePath(pathname)}`);
  }
}

export async function handleReset(scope: ResetScope, workspaceDir: string, runtime: RuntimeEnv) {
  await moveToTrash(CONFIG_PATH, runtime);
  if (scope === "config") return;
  await moveToTrash(path.join(CONFIG_DIR, "credentials"), runtime);
  await moveToTrash(resolveSessionTranscriptsDirForAgent(), runtime);
  if (scope === "full") {
    await moveToTrash(workspaceDir, runtime);
  }
}

export async function detectBinary(name: string): Promise<boolean> {
  if (!name?.trim()) return false;
  if (!isSafeExecutableValue(name)) return false;
  const resolved = name.startsWith("~") ? resolveUserPath(name) : name;
  if (
    path.isAbsolute(resolved) ||
    resolved.startsWith(".") ||
    resolved.includes("/") ||
    resolved.includes("\\")
  ) {
    try {
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  const command = process.platform === "win32" ? ["where", name] : ["/usr/bin/env", "which", name];
  try {
    const result = await runCommandWithTimeout(command, { timeoutMs: 2000 });
    return result.code === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function shouldSkipBrowserOpenInTests(): boolean {
  if (process.env.VITEST) return true;
  return process.env.NODE_ENV === "test";
}

export async function probeGatewayReachable(params: {
  url: string;
  token?: string;
  password?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; detail?: string }> {
  const url = params.url.trim();
  const timeoutMs = params.timeoutMs ?? 1500;
  try {
    await callGateway({
      url,
      token: params.token,
      password: params.password,
      method: "health",
      timeoutMs,
      clientName: GATEWAY_CLIENT_NAMES.PROBE,
      mode: GATEWAY_CLIENT_MODES.PROBE,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: summarizeError(err) };
  }
}

export async function waitForGatewayReachable(params: {
  url: string;
  token?: string;
  password?: string;
  /** Total time to wait before giving up. */
  deadlineMs?: number;
  /** Per-probe timeout (each probe makes a full gateway health request). */
  probeTimeoutMs?: number;
  /** Delay between probes. */
  pollMs?: number;
}): Promise<{ ok: boolean; detail?: string }> {
  const deadlineMs = params.deadlineMs ?? 15_000;
  const pollMs = params.pollMs ?? 400;
  const probeTimeoutMs = params.probeTimeoutMs ?? 1500;
  const startedAt = Date.now();
  let lastDetail: string | undefined;

  while (Date.now() - startedAt < deadlineMs) {
    const probe = await probeGatewayReachable({
      url: params.url,
      token: params.token,
      password: params.password,
      timeoutMs: probeTimeoutMs,
    });
    if (probe.ok) return probe;
    lastDetail = probe.detail;
    await sleep(pollMs);
  }

  return { ok: false, detail: lastDetail };
}

function summarizeError(err: unknown): string {
  let raw = "unknown error";
  if (err instanceof Error) {
    raw = err.message || raw;
  } else if (typeof err === "string") {
    raw = err || raw;
  } else if (err !== undefined) {
    raw = inspect(err, { depth: 2 });
  }
  const line =
    raw
      .split("\n")
      .map((s) => s.trim())
      .find(Boolean) ?? raw;
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export const DEFAULT_WORKSPACE = DEFAULT_AGENT_WORKSPACE_DIR;

export function resolveControlUiLinks(params: {
  port: number;
  bind?: "auto" | "lan" | "loopback" | "custom" | "tailnet";
  customBindHost?: string;
  basePath?: string;
}): { httpUrl: string; wsUrl: string } {
  const port = params.port;
  const bind = params.bind ?? "loopback";
  const customBindHost = params.customBindHost?.trim();
  const tailnetIPv4 = pickPrimaryTailnetIPv4();
  const host = (() => {
    if (bind === "custom" && customBindHost && isValidIPv4(customBindHost)) {
      return customBindHost;
    }
    if (bind === "tailnet" && tailnetIPv4) return tailnetIPv4 ?? "127.0.0.1";
    return "127.0.0.1";
  })();
  const basePath = normalizeControlUiBasePath(params.basePath);
  const uiPath = basePath ? `${basePath}/` : "/";
  const wsPath = basePath ? basePath : "";
  return {
    httpUrl: `http://${host}:${port}${uiPath}`,
    wsUrl: `ws://${host}:${port}${wsPath}`,
  };
}

function isValidIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const n = Number.parseInt(part, 10);
    return !Number.isNaN(n) && n >= 0 && n <= 255 && part === String(n);
  });
}

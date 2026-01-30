/**
 * Credentials CLI for managing secure credential storage.
 * Part of Phase 1: Security Hardening by Default.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { Command } from "commander";

import { resolveStateDir } from "../config/paths.js";
import { createCredentialStore, getAvailableBackends } from "../credentials/index.js";
import { defaultRuntime } from "../runtime.js";
import {
  scanForPlaintextCredentials,
  type PlaintextCredentialFinding,
} from "../security/audit-credentials.js";
import { formatDocsLink } from "../terminal/links.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

type MigrateOptions = {
  yes?: boolean;
  dryRun?: boolean;
  secureDelete?: boolean;
  target?: "keychain" | "encrypted-file";
};

type ListOptions = {
  json?: boolean;
};

type StatusOptions = {
  json?: boolean;
};

/**
 * Securely delete a file by overwriting with random data before unlinking.
 */
async function secureDeleteFile(filePath: string): Promise<boolean> {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;

    // Overwrite with random data
    const randomData = crypto.randomBytes(stat.size);
    fs.writeFileSync(filePath, randomData);

    // Overwrite with zeros
    fs.writeFileSync(filePath, Buffer.alloc(stat.size, 0));

    // Unlink
    fs.unlinkSync(filePath);
    return true;
  } catch {
    // Fall back to regular delete
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Group plaintext findings by file.
 */
function groupFindingsByFile(
  findings: PlaintextCredentialFinding[],
): Map<string, PlaintextCredentialFinding[]> {
  const grouped = new Map<string, PlaintextCredentialFinding[]>();
  for (const finding of findings) {
    const existing = grouped.get(finding.filePath) ?? [];
    existing.push(finding);
    grouped.set(finding.filePath, existing);
  }
  return grouped;
}

export function registerCredentialsCli(program: Command) {
  const credentials = program
    .command("credentials")
    .description("Credential storage management (migrate, list, status)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/credentials", "docs.molt.bot/cli/credentials")}\n`,
    );

  // moltbot credentials status
  credentials
    .command("status")
    .description("Show credential storage status")
    .option("--json", "Print JSON", false)
    .action(async (opts: StatusOptions) => {
      const stateDir = resolveStateDir();
      const store = await createCredentialStore({ storeDir: path.join(stateDir, "credentials") });
      const backends = await getAvailableBackends();
      const plaintextFindings = scanForPlaintextCredentials(stateDir);
      const listResult = await store.list();

      const status = {
        currentBackend: store.backend,
        availableBackends: backends,
        secureCredentialCount: listResult.ok ? listResult.value.length : 0,
        plaintextCredentialsDetected: plaintextFindings.length,
        stateDir,
      };

      if (opts.json) {
        defaultRuntime.log(JSON.stringify(status, null, 2));
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);
      const ok = (text: string) => (rich ? theme.success(text) : text);
      const warn = (text: string) => (rich ? theme.warn(text) : text);
      const error = (text: string) => (rich ? theme.error(text) : text);

      const lines: string[] = [];
      lines.push(heading("Credential Storage Status"));
      lines.push("");
      lines.push(`${muted("Current backend:")} ${ok(store.backend)}`);
      lines.push(`${muted("Secure credentials:")} ${status.secureCredentialCount}`);

      if (plaintextFindings.length > 0) {
        lines.push(
          `${muted("Plaintext detected:")} ${error(String(plaintextFindings.length))} ${error("(migration recommended)")}`,
        );
      } else {
        lines.push(`${muted("Plaintext detected:")} ${ok("0")}`);
      }

      lines.push("");
      lines.push(heading("Available Backends"));
      for (const backend of backends) {
        const icon = backend.available ? ok("✓") : muted("○");
        lines.push(`  ${icon} ${backend.backend} - ${muted(backend.description)}`);
      }

      if (plaintextFindings.length > 0) {
        lines.push("");
        lines.push(warn("Recommendation: Run migration to secure your credentials"));
        lines.push(muted(`  ${formatCliCommand("moltbot credentials migrate")}`));
      }

      defaultRuntime.log(lines.join("\n"));
    });

  // moltbot credentials list
  credentials
    .command("list")
    .description("List stored credentials (keys only, not values)")
    .option("--json", "Print JSON", false)
    .action(async (opts: ListOptions) => {
      const stateDir = resolveStateDir();
      const store = await createCredentialStore({ storeDir: path.join(stateDir, "credentials") });
      const listResult = await store.list();

      if (!listResult.ok) {
        throw new Error(`Failed to list credentials: ${listResult.error}`);
      }

      if (opts.json) {
        defaultRuntime.log(JSON.stringify(listResult.value, null, 2));
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);

      if (listResult.value.length === 0) {
        defaultRuntime.log(muted("No credentials stored."));
        return;
      }

      const lines: string[] = [];
      lines.push(heading(`Stored Credentials (${listResult.value.length})`));
      lines.push("");

      for (const { key, metadata } of listResult.value) {
        const label = metadata.label ? ` (${metadata.label})` : "";
        const age = Math.floor((Date.now() - metadata.updatedAtMs) / (24 * 60 * 60 * 1000));
        const ageStr = age === 0 ? "today" : `${age}d ago`;
        lines.push(`  ${key}${muted(label)} - ${muted(`updated ${ageStr}`)}`);
      }

      defaultRuntime.log(lines.join("\n"));
    });

  // moltbot credentials migrate
  credentials
    .command("migrate")
    .description("Migrate plaintext credentials to secure storage")
    .option("-y, --yes", "Skip confirmation prompt", false)
    .option("--dry-run", "Show what would be migrated without making changes", false)
    .option("--secure-delete", "Securely delete plaintext files after migration", false)
    .option("--target <backend>", "Target backend (keychain or encrypted-file)", undefined)
    .action(async (opts: MigrateOptions) => {
      const stateDir = resolveStateDir();
      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);
      const ok = (text: string) => (rich ? theme.success(text) : text);
      const warn = (text: string) => (rich ? theme.warn(text) : text);
      const error = (text: string) => (rich ? theme.error(text) : text);

      // Step 1: Scan for plaintext credentials
      defaultRuntime.log(heading("Scanning for plaintext credentials..."));
      const findings = scanForPlaintextCredentials(stateDir);

      if (findings.length === 0) {
        defaultRuntime.log(ok("No plaintext credentials found. Your credentials are secure."));
        return;
      }

      // Step 2: Show what was found
      const grouped = groupFindingsByFile(findings);
      defaultRuntime.log("");
      defaultRuntime.log(
        warn(`Found ${findings.length} plaintext credential(s) in ${grouped.size} file(s):`),
      );
      defaultRuntime.log("");

      for (const [filePath, fileFindings] of grouped) {
        defaultRuntime.log(`  ${shortenHomePath(filePath)}`);
        for (const finding of fileFindings) {
          const lineInfo = finding.lineNumber ? ` (line ${finding.lineNumber})` : "";
          defaultRuntime.log(muted(`    - ${finding.credentialType}${lineInfo}`));
        }
      }

      // Step 3: Show target backend
      const targetBackend = opts.target as "keychain" | "encrypted-file" | undefined;
      const targetStore = await createCredentialStore({
        preferredBackend: targetBackend,
        storeDir: path.join(stateDir, "credentials"),
      });

      defaultRuntime.log("");
      defaultRuntime.log(`${muted("Target backend:")} ${ok(targetStore.backend)}`);

      if (opts.dryRun) {
        defaultRuntime.log("");
        defaultRuntime.log(muted("Dry run mode - no changes will be made."));
        return;
      }

      // Step 4: Confirm migration
      if (!opts.yes) {
        defaultRuntime.log("");
        defaultRuntime.log(warn("This will:"));
        defaultRuntime.log(muted("  1. Extract credentials from plaintext files"));
        defaultRuntime.log(muted(`  2. Store them securely in ${targetStore.backend}`));
        if (opts.secureDelete) {
          defaultRuntime.log(muted("  3. Securely delete the plaintext files"));
        }
        defaultRuntime.log("");
        defaultRuntime.log(muted("Run with --yes to proceed, or --dry-run to preview."));
        return;
      }

      // Step 5: Perform migration
      defaultRuntime.log("");
      defaultRuntime.log(heading("Migrating credentials..."));

      let migrated = 0;
      let failed = 0;
      const filesToDelete: string[] = [];

      for (const [filePath, fileFindings] of grouped) {
        try {
          // Read the file content
          const content = fs.readFileSync(filePath, "utf8");

          // Try to parse as JSON
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(content) as Record<string, unknown>;
          } catch {
            // Not JSON, skip structured migration
          }

          if (parsed) {
            // Migrate JSON credentials
            for (const finding of fileFindings) {
              // Try to find the key that matches this credential type
              const credentialKeys = Object.keys(parsed).filter((key) => {
                const value = parsed[key];
                return typeof value === "string" && value.length >= 16;
              });

              for (const key of credentialKeys) {
                const value = parsed[key] as string;
                const storeResult = await targetStore.store(key, value, {
                  label: `Migrated from ${path.basename(filePath)}`,
                  tags: ["migrated", finding.credentialType.toLowerCase().replace(/\s+/g, "-")],
                });

                if (storeResult.ok) {
                  migrated++;
                  defaultRuntime.log(ok(`  ✓ Migrated: ${key}`));
                } else {
                  failed++;
                  defaultRuntime.log(error(`  ✗ Failed: ${key} - ${storeResult.error}`));
                }
              }
            }

            filesToDelete.push(filePath);
          } else {
            // For non-JSON files, just note them
            defaultRuntime.log(
              warn(`  ○ Skipped: ${shortenHomePath(filePath)} (manual migration required)`),
            );
          }
        } catch (err) {
          failed++;
          defaultRuntime.log(
            error(`  ✗ Error processing ${shortenHomePath(filePath)}: ${String(err)}`),
          );
        }
      }

      // Step 6: Securely delete if requested
      if (opts.secureDelete && filesToDelete.length > 0) {
        defaultRuntime.log("");
        defaultRuntime.log(heading("Securely deleting plaintext files..."));

        for (const filePath of filesToDelete) {
          const deleted = await secureDeleteFile(filePath);
          if (deleted) {
            defaultRuntime.log(ok(`  ✓ Deleted: ${shortenHomePath(filePath)}`));
          } else {
            defaultRuntime.log(warn(`  ○ Could not delete: ${shortenHomePath(filePath)}`));
          }
        }
      }

      // Step 7: Summary
      defaultRuntime.log("");
      defaultRuntime.log(heading("Migration Summary"));
      defaultRuntime.log(`  ${ok(`${migrated} credential(s) migrated`)}`);
      if (failed > 0) {
        defaultRuntime.log(`  ${error(`${failed} failed`)}`);
      }
      if (!opts.secureDelete && filesToDelete.length > 0) {
        defaultRuntime.log("");
        defaultRuntime.log(warn("Note: Plaintext files were not deleted."));
        defaultRuntime.log(muted("  Run with --secure-delete to remove them securely."));
      }
    });

  // moltbot credentials backends
  credentials
    .command("backends")
    .description("List available credential storage backends")
    .option("--json", "Print JSON", false)
    .action(async (opts: { json?: boolean }) => {
      const backends = await getAvailableBackends();

      if (opts.json) {
        defaultRuntime.log(JSON.stringify(backends, null, 2));
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);
      const ok = (text: string) => (rich ? theme.success(text) : text);

      const lines: string[] = [];
      lines.push(heading("Available Credential Backends"));
      lines.push("");

      for (const backend of backends) {
        const icon = backend.available ? ok("✓") : muted("○");
        const status = backend.available ? ok("available") : muted("not available");
        lines.push(`  ${icon} ${backend.backend} (${status})`);
        lines.push(muted(`      ${backend.description}`));
      }

      defaultRuntime.log(lines.join("\n"));
    });
}

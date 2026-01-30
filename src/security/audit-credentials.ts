/**
 * Security audit checks for credential storage.
 * Part of Phase 1: Security Hardening by Default.
 */

import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "../config/paths.js";
import { createCredentialStore, getAvailableBackends } from "../credentials/index.js";
import type { ResolvedSecurityConfig } from "../config/types.security.js";
import { resolveSecurityConfig } from "../config/security-presets.js";
import type { SecurityAuditFinding } from "./audit.js";

/**
 * Known patterns that indicate plaintext credentials in files.
 */
const PLAINTEXT_CREDENTIAL_PATTERNS = [
  // API keys
  { pattern: /sk-[a-zA-Z0-9]{20,}/, type: "OpenAI API key" },
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/, type: "Anthropic API key" },
  { pattern: /xai-[a-zA-Z0-9]{20,}/, type: "xAI/Grok API key" },
  // Tokens
  { pattern: /ghp_[a-zA-Z0-9]{36}/, type: "GitHub Personal Access Token" },
  { pattern: /gho_[a-zA-Z0-9]{36}/, type: "GitHub OAuth Token" },
  { pattern: /xoxb-[0-9]+-[a-zA-Z0-9]+/, type: "Slack Bot Token" },
  { pattern: /xoxp-[0-9]+-[a-zA-Z0-9]+/, type: "Slack User Token" },
  // Discord tokens (base64-ish)
  { pattern: /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9-_]{6}\.[A-Za-z0-9-_]{27,}/, type: "Discord Token" },
  // Generic patterns
  { pattern: /"password"\s*:\s*"[^"]{8,}"/, type: "Password in JSON" },
  { pattern: /"token"\s*:\s*"[^"]{20,}"/, type: "Token in JSON" },
  { pattern: /"api_key"\s*:\s*"[^"]{20,}"/, type: "API key in JSON" },
  { pattern: /"apiKey"\s*:\s*"[^"]{20,}"/, type: "API key in JSON" },
  { pattern: /"secret"\s*:\s*"[^"]{16,}"/, type: "Secret in JSON" },
];

/**
 * Files to scan for plaintext credentials.
 */
const FILES_TO_SCAN = ["config.json", "credentials.json", "secrets.json", "tokens.json", ".env"];

/**
 * Directories under state dir to scan.
 */
const DIRS_TO_SCAN = ["credentials", "identity", "sessions"];

export type PlaintextCredentialFinding = {
  filePath: string;
  credentialType: string;
  lineNumber?: number;
};

/**
 * Scan a file for plaintext credentials.
 */
function scanFileForPlaintextCredentials(filePath: string): PlaintextCredentialFinding[] {
  const findings: PlaintextCredentialFinding[] = [];

  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 1024 * 1024) {
      // Skip non-files or files > 1MB
      return [];
    }

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { pattern, type } of PLAINTEXT_CREDENTIAL_PATTERNS) {
        if (pattern.test(line)) {
          findings.push({
            filePath,
            credentialType: type,
            lineNumber: i + 1,
          });
          break; // Only report one finding per line
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return findings;
}

/**
 * Scan state directory for plaintext credentials.
 */
export function scanForPlaintextCredentials(stateDir?: string): PlaintextCredentialFinding[] {
  const dir = stateDir ?? resolveStateDir();
  const findings: PlaintextCredentialFinding[] = [];

  // Scan root files
  for (const file of FILES_TO_SCAN) {
    const filePath = path.join(dir, file);
    findings.push(...scanFileForPlaintextCredentials(filePath));
  }

  // Scan subdirectories
  for (const subdir of DIRS_TO_SCAN) {
    const subdirPath = path.join(dir, subdir);
    try {
      if (fs.existsSync(subdirPath) && fs.statSync(subdirPath).isDirectory()) {
        const files = fs.readdirSync(subdirPath);
        for (const file of files) {
          if (file.endsWith(".json") || file.endsWith(".txt") || file === ".env") {
            findings.push(...scanFileForPlaintextCredentials(path.join(subdirPath, file)));
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  return findings;
}

/**
 * Collect credential storage audit findings.
 */
export async function collectCredentialStorageFindings(params: {
  stateDir?: string;
  securityConfig?: ResolvedSecurityConfig;
}): Promise<SecurityAuditFinding[]> {
  const findings: SecurityAuditFinding[] = [];
  const stateDir = params.stateDir ?? resolveStateDir();
  const securityConfig = params.securityConfig ?? resolveSecurityConfig(undefined);

  // Check 1: Plaintext credentials in state directory
  const plaintextFindings = scanForPlaintextCredentials(stateDir);
  if (plaintextFindings.length > 0) {
    const types = [...new Set(plaintextFindings.map((f) => f.credentialType))];
    findings.push({
      checkId: "credentials.plaintext",
      severity: "critical",
      title: "Plaintext credentials detected",
      detail: `Found ${plaintextFindings.length} potential plaintext credential(s) in state directory: ${types.join(", ")}`,
      remediation: `Run "moltbot credentials migrate" to move credentials to secure storage.`,
    });
  }

  // Check 2: Credential store backend availability
  const backends = await getAvailableBackends();
  const keychainBackend = backends.find((b) => b.backend === "keychain");
  const preferredBackend = securityConfig.credentials.store;

  if (preferredBackend === "keychain" && keychainBackend && !keychainBackend.available) {
    findings.push({
      checkId: "credentials.keychain_unavailable",
      severity: "warn",
      title: "Keychain not available",
      detail:
        "Configuration prefers keychain storage, but it's not available on this platform. " +
        "Falling back to encrypted file storage.",
      remediation: "This is expected on non-macOS platforms. Encrypted file storage is secure.",
    });
  }

  // Check 3: Plaintext backend configured (deprecated)
  if (securityConfig.credentials.store === "plaintext") {
    findings.push({
      checkId: "credentials.plaintext_configured",
      severity: "critical",
      title: "Plaintext credential storage configured",
      detail: 'security.credentials.store is set to "plaintext", which stores secrets unencrypted.',
      remediation:
        'Set security.credentials.store to "keychain" (macOS) or "encrypted-file" (cross-platform).',
    });
  }

  // Check 4: Check if secure credential store is in use
  try {
    const store = await createCredentialStore({ storeDir: path.join(stateDir, "credentials") });
    const listResult = await store.list();

    if (listResult.ok && listResult.value.length === 0 && plaintextFindings.length > 0) {
      findings.push({
        checkId: "credentials.migration_needed",
        severity: "warn",
        title: "Credentials not migrated",
        detail:
          "Secure credential store is empty but plaintext credentials were found. " +
          "Credentials should be migrated to secure storage.",
        remediation: `Run "moltbot credentials migrate" to migrate credentials.`,
      });
    }
  } catch {
    // Ignore errors - store might not be initialized yet
  }

  // Check 5: Credential file permissions (if encrypted file backend is used)
  const credentialsDir = path.join(stateDir, "credentials");
  const encryptedFile = path.join(credentialsDir, "credentials.enc.json");

  if (fs.existsSync(encryptedFile)) {
    try {
      const stat = fs.statSync(encryptedFile);
      const mode = stat.mode & 0o777;

      if (mode !== 0o600) {
        findings.push({
          checkId: "credentials.file_permissions",
          severity: "warn",
          title: "Credential file permissions too permissive",
          detail: `${encryptedFile} has mode ${mode.toString(8)}, should be 600.`,
          remediation: `Run: chmod 600 "${encryptedFile}"`,
        });
      }
    } catch {
      // Ignore stat errors
    }
  }

  // Check 6: Rotation reminder
  const credStore = await createCredentialStore({ storeDir: path.join(stateDir, "credentials") });
  const listResult = await credStore.list();

  if (listResult.ok) {
    const rotationDays = securityConfig.credentials.rotationReminderDays;
    const rotationMs = rotationDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const staleCredentials = listResult.value.filter((entry) => {
      const age = now - entry.metadata.updatedAtMs;
      return age > rotationMs;
    });

    if (staleCredentials.length > 0) {
      findings.push({
        checkId: "credentials.rotation_due",
        severity: "info",
        title: "Credentials due for rotation",
        detail: `${staleCredentials.length} credential(s) haven't been rotated in ${rotationDays} days: ${staleCredentials.map((c) => c.key).join(", ")}`,
        remediation: `Consider rotating old credentials for security.`,
      });
    }
  }

  return findings;
}

/**
 * Get credential storage status summary.
 */
/**
 * Result of a credential migration attempt.
 */
export type CredentialMigrationResult = {
  ok: boolean;
  migrated: number;
  failed: number;
  skipped: number;
  details: Array<{
    key: string;
    status: "migrated" | "failed" | "skipped";
    error?: string;
    fromFile?: string;
  }>;
  filesToDelete: string[];
};

/**
 * Attempt to automatically migrate plaintext credentials to secure storage.
 * Called by `moltbot security audit --fix`.
 */
export async function migrateCredentialsAutoFix(params: {
  stateDir?: string;
  secureDelete?: boolean;
}): Promise<CredentialMigrationResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const result: CredentialMigrationResult = {
    ok: true,
    migrated: 0,
    failed: 0,
    skipped: 0,
    details: [],
    filesToDelete: [],
  };

  // Scan for plaintext credentials
  const findings = scanForPlaintextCredentials(stateDir);
  if (findings.length === 0) {
    return result;
  }

  // Group findings by file
  const fileFindings = new Map<string, PlaintextCredentialFinding[]>();
  for (const finding of findings) {
    const existing = fileFindings.get(finding.filePath) ?? [];
    existing.push(finding);
    fileFindings.set(finding.filePath, existing);
  }

  // Create credential store
  const store = await createCredentialStore({ storeDir: path.join(stateDir, "credentials") });

  // Process each file
  for (const [filePath, fileEntries] of fileFindings) {
    try {
      // Read the file
      const content = fs.readFileSync(filePath, "utf8");

      // Try to parse as JSON
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(content) as Record<string, unknown>;
      } catch {
        // Not JSON - skip
        result.skipped++;
        result.details.push({
          key: path.basename(filePath),
          status: "skipped",
          fromFile: filePath,
          error: "Not a valid JSON file",
        });
        continue;
      }

      if (parsed) {
        // Extract credentials based on finding types
        let foundAny = false;
        for (const entry of fileEntries) {
          // Try to find keys that might contain this credential type
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value !== "string" || value.length < 16) continue;

            // Check if this value matches the credential type pattern
            const isMatch = PLAINTEXT_CREDENTIAL_PATTERNS.some(
              (p) => p.type === entry.credentialType && p.pattern.test(value),
            );

            if (!isMatch) continue;

            // Try to store the credential
            const storeResult = await store.store(key, value, {
              label: `Auto-migrated from ${path.basename(filePath)}`,
              tags: ["migrated", "auto-fix"],
            });

            if (storeResult.ok) {
              result.migrated++;
              result.details.push({
                key,
                status: "migrated",
                fromFile: filePath,
              });
              foundAny = true;
            } else {
              result.failed++;
              result.details.push({
                key,
                status: "failed",
                fromFile: filePath,
                error: storeResult.error,
              });
            }
          }
        }

        // Mark file for deletion if all credentials were migrated
        if (foundAny && result.failed === 0) {
          result.filesToDelete.push(filePath);
        }
      }
    } catch (err) {
      result.failed++;
      result.details.push({
        key: path.basename(filePath),
        status: "failed",
        fromFile: filePath,
        error: String(err),
      });
    }
  }

  result.ok = result.failed === 0;
  return result;
}

export async function getCredentialStorageStatus(stateDir?: string): Promise<{
  backend: string;
  backendAvailable: boolean;
  credentialCount: number;
  plaintextCount: number;
  oldestCredentialDays: number | null;
  newestCredentialDays: number | null;
}> {
  const dir = stateDir ?? resolveStateDir();
  const store = await createCredentialStore({ storeDir: path.join(dir, "credentials") });

  const backends = await getAvailableBackends();
  const currentBackend = backends.find((b) => b.backend === store.backend);

  const listResult = await store.list();
  const credentials = listResult.ok ? listResult.value : [];

  const plaintextFindings = scanForPlaintextCredentials(dir);
  const now = Date.now();

  let oldestDays: number | null = null;
  let newestDays: number | null = null;

  if (credentials.length > 0) {
    const ages = credentials.map((c) => now - c.metadata.updatedAtMs);
    const oldest = Math.max(...ages);
    const newest = Math.min(...ages);
    oldestDays = Math.floor(oldest / (24 * 60 * 60 * 1000));
    newestDays = Math.floor(newest / (24 * 60 * 60 * 1000));
  }

  return {
    backend: store.backend,
    backendAvailable: currentBackend?.available ?? false,
    credentialCount: credentials.length,
    plaintextCount: plaintextFindings.length,
    oldestCredentialDays: oldestDays,
    newestCredentialDays: newestDays,
  };
}

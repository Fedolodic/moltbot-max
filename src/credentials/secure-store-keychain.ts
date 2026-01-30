/**
 * macOS Keychain-based credential store.
 * Uses the `security` CLI for secure credential storage.
 * Part of Phase 1: Security Hardening by Default.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "../config/paths.js";
import type {
  CredentialMetadata,
  CredentialResult,
  SecureCredentialStore,
  StoreCredentialOptions,
  StoredCredential,
} from "./secure-store.js";
import {
  CREDENTIAL_KEY_PREFIX,
  CREDENTIAL_SERVICE_NAME,
  validateCredentialKey,
} from "./secure-store.js";

/**
 * Metadata store file (separate from keychain, since keychain only stores key/value).
 */
type MetadataStoreFile = {
  version: 1;
  entries: Record<string, CredentialMetadata>;
};

const METADATA_FILENAME = "keychain-metadata.json";

/**
 * Configuration for the keychain store.
 */
export type KeychainStoreConfig = {
  /** Custom metadata directory (defaults to ~/.moltbot/credentials). */
  metadataDir?: string;
  /** Custom service name for keychain entries. */
  serviceName?: string;
};

/**
 * macOS Keychain credential store implementation.
 */
export class KeychainCredentialStore implements SecureCredentialStore {
  readonly backend = "keychain" as const;
  private readonly metadataDir: string;
  private readonly serviceName: string;

  constructor(config: KeychainStoreConfig = {}) {
    this.metadataDir = config.metadataDir ?? path.join(resolveStateDir(), "credentials");
    this.serviceName = config.serviceName ?? CREDENTIAL_SERVICE_NAME;
  }

  private get metadataPath(): string {
    return path.join(this.metadataDir, METADATA_FILENAME);
  }

  private getKeychainKey(key: string): string {
    return `${CREDENTIAL_KEY_PREFIX}${key}`;
  }

  async isAvailable(): Promise<boolean> {
    // Check if we're on macOS and security command is available
    if (process.platform !== "darwin") {
      return false;
    }
    try {
      const result = spawnSync("which", ["security"], { encoding: "utf8" });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private readMetadata(): MetadataStoreFile {
    try {
      if (!fs.existsSync(this.metadataPath)) {
        return { version: 1, entries: {} };
      }
      const raw = fs.readFileSync(this.metadataPath, "utf8");
      const parsed = JSON.parse(raw) as MetadataStoreFile;
      if (parsed?.version !== 1) {
        return { version: 1, entries: {} };
      }
      return parsed;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private writeMetadata(store: MetadataStoreFile): void {
    fs.mkdirSync(this.metadataDir, { recursive: true, mode: 0o700 });
    const content = JSON.stringify(store, null, 2);
    fs.writeFileSync(this.metadataPath, content, { mode: 0o600 });
    try {
      fs.chmodSync(this.metadataPath, 0o600);
    } catch {
      // best-effort
    }
  }

  private keychainAdd(account: string, password: string): boolean {
    try {
      // Use -U to update if exists, otherwise add
      const result = spawnSync(
        "security",
        ["add-generic-password", "-U", "-a", account, "-s", this.serviceName, "-w", password],
        { encoding: "utf8", stdio: "pipe" },
      );
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private keychainFind(account: string): string | null {
    try {
      const result = spawnSync(
        "security",
        ["find-generic-password", "-a", account, "-s", this.serviceName, "-w"],
        { encoding: "utf8", stdio: "pipe" },
      );
      if (result.status !== 0) {
        return null;
      }
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  private keychainDelete(account: string): boolean {
    try {
      const result = spawnSync(
        "security",
        ["delete-generic-password", "-a", account, "-s", this.serviceName],
        { encoding: "utf8", stdio: "pipe" },
      );
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private keychainList(): string[] {
    try {
      // List all generic passwords for our service
      const result = spawnSync("security", ["dump-keychain"], {
        encoding: "utf8",
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024,
      });
      if (result.status !== 0) {
        return [];
      }

      // Parse the output to find entries matching our service
      const accounts: string[] = [];
      const lines = result.stdout.split("\n");
      let inEntry = false;
      let currentService = "";
      let currentAccount = "";

      for (const line of lines) {
        if (line.includes("keychain:") || line.includes("class:")) {
          if (inEntry && currentService === this.serviceName && currentAccount) {
            accounts.push(currentAccount);
          }
          inEntry = line.includes('class: "genp"');
          currentService = "";
          currentAccount = "";
        }
        if (inEntry) {
          const serviceMatch = line.match(/"svce"<blob>="([^"]+)"/);
          if (serviceMatch) {
            currentService = serviceMatch[1];
          }
          const accountMatch = line.match(/"acct"<blob>="([^"]+)"/);
          if (accountMatch) {
            currentAccount = accountMatch[1];
          }
        }
      }
      // Handle last entry
      if (inEntry && currentService === this.serviceName && currentAccount) {
        accounts.push(currentAccount);
      }

      // Filter to only our prefixed keys
      return accounts
        .filter((a) => a.startsWith(CREDENTIAL_KEY_PREFIX))
        .map((a) => a.slice(CREDENTIAL_KEY_PREFIX.length));
    } catch {
      return [];
    }
  }

  async store(
    key: string,
    value: string,
    options?: StoreCredentialOptions,
  ): Promise<CredentialResult<void>> {
    const keyResult = validateCredentialKey(key);
    if (!keyResult.ok) {
      return keyResult;
    }
    const normalizedKey = keyResult.value;
    const keychainKey = this.getKeychainKey(normalizedKey);

    try {
      const success = this.keychainAdd(keychainKey, value);
      if (!success) {
        return { ok: false, error: "Failed to store credential in keychain" };
      }

      // Update metadata
      const metadata = this.readMetadata();
      const now = Date.now();
      const existingMeta = metadata.entries[normalizedKey];

      metadata.entries[normalizedKey] = {
        createdAtMs: existingMeta?.createdAtMs ?? now,
        updatedAtMs: now,
        expiresAtMs: options?.expiresAtMs,
        label: options?.label,
        tags: options?.tags,
      };

      this.writeMetadata(metadata);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to store credential: ${String(err)}` };
    }
  }

  async retrieve(key: string): Promise<CredentialResult<StoredCredential>> {
    const keyResult = validateCredentialKey(key);
    if (!keyResult.ok) {
      return keyResult;
    }
    const normalizedKey = keyResult.value;
    const keychainKey = this.getKeychainKey(normalizedKey);

    try {
      const value = this.keychainFind(keychainKey);
      if (value === null) {
        return { ok: false, error: `Credential not found: ${key}` };
      }

      const metadata = this.readMetadata();
      const entryMeta = metadata.entries[normalizedKey] ?? {
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };

      return {
        ok: true,
        value: {
          key: normalizedKey,
          value,
          metadata: entryMeta,
        },
      };
    } catch (err) {
      return { ok: false, error: `Failed to retrieve credential: ${String(err)}` };
    }
  }

  async delete(key: string): Promise<CredentialResult<void>> {
    const keyResult = validateCredentialKey(key);
    if (!keyResult.ok) {
      return keyResult;
    }
    const normalizedKey = keyResult.value;
    const keychainKey = this.getKeychainKey(normalizedKey);

    try {
      const success = this.keychainDelete(keychainKey);
      if (!success) {
        return { ok: false, error: `Credential not found: ${key}` };
      }

      // Remove metadata
      const metadata = this.readMetadata();
      delete metadata.entries[normalizedKey];
      this.writeMetadata(metadata);

      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to delete credential: ${String(err)}` };
    }
  }

  async list(): Promise<CredentialResult<Array<{ key: string; metadata: CredentialMetadata }>>> {
    try {
      const keys = this.keychainList();
      const metadata = this.readMetadata();

      const entries = keys.map((key) => ({
        key,
        metadata: metadata.entries[key] ?? {
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
      }));

      return { ok: true, value: entries };
    } catch (err) {
      return { ok: false, error: `Failed to list credentials: ${String(err)}` };
    }
  }

  async exists(key: string): Promise<boolean> {
    const keyResult = validateCredentialKey(key);
    if (!keyResult.ok) {
      return false;
    }
    const normalizedKey = keyResult.value;
    const keychainKey = this.getKeychainKey(normalizedKey);

    try {
      return this.keychainFind(keychainKey) !== null;
    } catch {
      return false;
    }
  }

  async rotate(key: string, newValue: string, backupOld = true): Promise<CredentialResult<void>> {
    const keyResult = validateCredentialKey(key);
    if (!keyResult.ok) {
      return keyResult;
    }
    const normalizedKey = keyResult.value;

    try {
      // Get existing metadata for preservation
      const metadata = this.readMetadata();
      const existingMeta = metadata.entries[normalizedKey];

      if (backupOld) {
        // Retrieve old value for backup
        const oldResult = await this.retrieve(key);
        if (oldResult.ok) {
          // Store backup with timestamp suffix
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          const backupKey = `${normalizedKey}-backup-${timestamp}`;
          await this.store(backupKey, oldResult.value.value, {
            label: `Backup of ${existingMeta?.label ?? key}`,
            tags: ["backup", ...(existingMeta?.tags ?? [])],
          });
        }
      }

      // Store new value
      return this.store(key, newValue, {
        label: existingMeta?.label,
        tags: existingMeta?.tags,
        expiresAtMs: existingMeta?.expiresAtMs,
      });
    } catch (err) {
      return { ok: false, error: `Failed to rotate credential: ${String(err)}` };
    }
  }
}

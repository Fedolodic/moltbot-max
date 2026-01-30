/**
 * Encrypted file-based credential store.
 * Cross-platform fallback when OS keychain is unavailable.
 * Part of Phase 1: Security Hardening by Default.
 */

import crypto from "node:crypto";
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
import { validateCredentialKey } from "./secure-store.js";

/**
 * Encrypted credential entry in the store file.
 */
type EncryptedEntry = {
  /** Encrypted value (base64). */
  encrypted: string;
  /** Initialization vector (base64). */
  iv: string;
  /** Salt used for key derivation (base64). */
  salt: string;
  /** Auth tag for GCM (base64). */
  authTag: string;
  /** Metadata (not encrypted). */
  metadata: CredentialMetadata;
};

/**
 * Store file structure.
 */
type CredentialStoreFile = {
  version: 1;
  entries: Record<string, EncryptedEntry>;
};

/**
 * Configuration for the encrypted file store.
 */
export type EncryptedFileStoreConfig = {
  /** Custom store directory (defaults to ~/.moltbot/credentials). */
  storeDir?: string;
  /** Custom machine key for encryption (defaults to derived key). */
  machineKey?: Buffer;
};

// Encryption constants
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const STORE_FILENAME = "credentials.enc.json";
const BACKUP_DIR = "backups";

/**
 * Derive an encryption key from machine-specific data.
 * Uses hostname + username as entropy source.
 */
function deriveMachineKey(): Buffer {
  const hostname = process.env.HOSTNAME ?? require("node:os").hostname();
  const username = process.env.USER ?? process.env.USERNAME ?? "unknown";
  const machineId = `${hostname}:${username}:moltbot-credential-store`;
  return crypto.createHash("sha256").update(machineId).digest();
}

/**
 * Derive an encryption key from password and salt using scrypt.
 */
function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return crypto.scryptSync(masterKey, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
}

/**
 * Encrypt a value using AES-256-GCM.
 */
function encrypt(
  value: string,
  masterKey: Buffer,
): { encrypted: string; iv: string; salt: string; authTag: string } {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/**
 * Decrypt a value using AES-256-GCM.
 */
function decrypt(
  entry: { encrypted: string; iv: string; salt: string; authTag: string },
  masterKey: Buffer,
): string {
  const salt = Buffer.from(entry.salt, "base64");
  const key = deriveKey(masterKey, salt);
  const iv = Buffer.from(entry.iv, "base64");
  const encrypted = Buffer.from(entry.encrypted, "base64");
  const authTag = Buffer.from(entry.authTag, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/**
 * Encrypted file-based credential store implementation.
 */
export class EncryptedFileCredentialStore implements SecureCredentialStore {
  readonly backend = "encrypted-file" as const;
  private readonly storeDir: string;
  private readonly masterKey: Buffer;

  constructor(config: EncryptedFileStoreConfig = {}) {
    this.storeDir = config.storeDir ?? path.join(resolveStateDir(), "credentials");
    this.masterKey = config.machineKey ?? deriveMachineKey();
  }

  private get storePath(): string {
    return path.join(this.storeDir, STORE_FILENAME);
  }

  private get backupDir(): string {
    return path.join(this.storeDir, BACKUP_DIR);
  }

  async isAvailable(): Promise<boolean> {
    // File-based store is always available as a fallback
    return true;
  }

  private readStore(): CredentialStoreFile {
    try {
      if (!fs.existsSync(this.storePath)) {
        return { version: 1, entries: {} };
      }
      const raw = fs.readFileSync(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as CredentialStoreFile;
      if (parsed?.version !== 1) {
        return { version: 1, entries: {} };
      }
      return parsed;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private writeStore(store: CredentialStoreFile): void {
    fs.mkdirSync(this.storeDir, { recursive: true, mode: 0o700 });
    const content = JSON.stringify(store, null, 2);
    fs.writeFileSync(this.storePath, content, { mode: 0o600 });
    // Ensure restrictive permissions
    try {
      fs.chmodSync(this.storePath, 0o600);
      fs.chmodSync(this.storeDir, 0o700);
    } catch {
      // best-effort
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

    try {
      const store = this.readStore();
      const now = Date.now();
      const existingMeta = store.entries[normalizedKey]?.metadata;

      const encrypted = encrypt(value, this.masterKey);

      store.entries[normalizedKey] = {
        ...encrypted,
        metadata: {
          createdAtMs: existingMeta?.createdAtMs ?? now,
          updatedAtMs: now,
          expiresAtMs: options?.expiresAtMs,
          label: options?.label,
          tags: options?.tags,
        },
      };

      this.writeStore(store);
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

    try {
      const store = this.readStore();
      const entry = store.entries[normalizedKey];

      if (!entry) {
        return { ok: false, error: `Credential not found: ${key}` };
      }

      const value = decrypt(entry, this.masterKey);

      return {
        ok: true,
        value: {
          key: normalizedKey,
          value,
          metadata: entry.metadata,
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

    try {
      const store = this.readStore();

      if (!store.entries[normalizedKey]) {
        return { ok: false, error: `Credential not found: ${key}` };
      }

      delete store.entries[normalizedKey];
      this.writeStore(store);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: `Failed to delete credential: ${String(err)}` };
    }
  }

  async list(): Promise<CredentialResult<Array<{ key: string; metadata: CredentialMetadata }>>> {
    try {
      const store = this.readStore();
      const entries = Object.entries(store.entries).map(([key, entry]) => ({
        key,
        metadata: entry.metadata,
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

    try {
      const store = this.readStore();
      return normalizedKey in store.entries;
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
      const store = this.readStore();
      const existingEntry = store.entries[normalizedKey];

      if (existingEntry && backupOld) {
        // Backup old value
        fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = path.join(this.backupDir, `${normalizedKey}-${timestamp}.enc.json`);
        fs.writeFileSync(backupPath, JSON.stringify(existingEntry, null, 2), { mode: 0o600 });
      }

      // Store new value
      return this.store(key, newValue, {
        label: existingEntry?.metadata.label,
        tags: existingEntry?.metadata.tags,
        expiresAtMs: existingEntry?.metadata.expiresAtMs,
      });
    } catch (err) {
      return { ok: false, error: `Failed to rotate credential: ${String(err)}` };
    }
  }

  /**
   * Export all credentials for migration (encrypted).
   * Returns the entire store file content.
   */
  exportForMigration(): CredentialResult<string> {
    try {
      const store = this.readStore();
      return { ok: true, value: JSON.stringify(store, null, 2) };
    } catch (err) {
      return { ok: false, error: `Failed to export credentials: ${String(err)}` };
    }
  }

  /**
   * Import credentials from a migration export.
   * @param data - The exported store data.
   * @param overwrite - Whether to overwrite existing entries.
   */
  importFromMigration(data: string, overwrite = false): CredentialResult<number> {
    try {
      const imported = JSON.parse(data) as CredentialStoreFile;
      if (imported?.version !== 1) {
        return { ok: false, error: "Invalid migration data version" };
      }

      const store = this.readStore();
      let count = 0;

      for (const [key, entry] of Object.entries(imported.entries)) {
        if (!overwrite && key in store.entries) {
          continue;
        }
        store.entries[key] = entry;
        count++;
      }

      this.writeStore(store);
      return { ok: true, value: count };
    } catch (err) {
      return { ok: false, error: `Failed to import credentials: ${String(err)}` };
    }
  }
}

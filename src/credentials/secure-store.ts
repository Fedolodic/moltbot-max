/**
 * SecureCredentialStore interface for platform-agnostic credential storage.
 * Part of Phase 1: Security Hardening by Default.
 */

import type { CredentialStoreBackend } from "../config/types.security.js";

/**
 * Metadata associated with a stored credential.
 */
export type CredentialMetadata = {
  /** When the credential was first stored. */
  createdAtMs: number;
  /** When the credential was last updated. */
  updatedAtMs: number;
  /** Optional expiration timestamp. */
  expiresAtMs?: number;
  /** Human-readable label for the credential. */
  label?: string;
  /** Tags for categorization. */
  tags?: string[];
};

/**
 * A stored credential with its metadata.
 */
export type StoredCredential = {
  /** The credential key/identifier. */
  key: string;
  /** The secret value (retrieved only when explicitly requested). */
  value: string;
  /** Associated metadata. */
  metadata: CredentialMetadata;
};

/**
 * Options for storing a credential.
 */
export type StoreCredentialOptions = {
  /** Human-readable label. */
  label?: string;
  /** Tags for categorization. */
  tags?: string[];
  /** Optional expiration timestamp. */
  expiresAtMs?: number;
};

/**
 * Result of a credential operation.
 */
export type CredentialResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Interface for secure credential storage backends.
 */
export interface SecureCredentialStore {
  /** The backend type identifier. */
  readonly backend: CredentialStoreBackend;

  /** Whether this backend is available on the current platform. */
  isAvailable(): Promise<boolean>;

  /**
   * Store a credential securely.
   * @param key - Unique identifier for the credential.
   * @param value - The secret value to store.
   * @param options - Optional metadata.
   */
  store(
    key: string,
    value: string,
    options?: StoreCredentialOptions,
  ): Promise<CredentialResult<void>>;

  /**
   * Retrieve a credential by key.
   * @param key - The credential key.
   */
  retrieve(key: string): Promise<CredentialResult<StoredCredential>>;

  /**
   * Delete a credential.
   * @param key - The credential key to delete.
   */
  delete(key: string): Promise<CredentialResult<void>>;

  /**
   * List all stored credential keys (without values).
   */
  list(): Promise<CredentialResult<Array<{ key: string; metadata: CredentialMetadata }>>>;

  /**
   * Check if a credential exists.
   * @param key - The credential key.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Rotate a credential (store new value, optionally backup old).
   * @param key - The credential key.
   * @param newValue - The new secret value.
   * @param backupOld - Whether to backup the old value.
   */
  rotate(key: string, newValue: string, backupOld?: boolean): Promise<CredentialResult<void>>;
}

/**
 * Service name used for keychain/credential storage.
 */
export const CREDENTIAL_SERVICE_NAME = "com.moltbot.credentials";

/**
 * Prefix for credential keys in keychain.
 */
export const CREDENTIAL_KEY_PREFIX = "moltbot:";

/**
 * Normalize a credential key for storage.
 */
export function normalizeCredentialKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

/**
 * Validate a credential key.
 */
export function validateCredentialKey(key: string): CredentialResult<string> {
  const normalized = normalizeCredentialKey(key);
  if (normalized.length === 0) {
    return { ok: false, error: "Credential key cannot be empty" };
  }
  if (normalized.length > 256) {
    return { ok: false, error: "Credential key too long (max 256 characters)" };
  }
  return { ok: true, value: normalized };
}

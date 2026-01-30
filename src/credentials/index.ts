/**
 * Credential store factory and exports.
 * Part of Phase 1: Security Hardening by Default.
 */

import type { CredentialStoreBackend } from "../config/types.security.js";
import type { SecureCredentialStore } from "./secure-store.js";
import { EncryptedFileCredentialStore } from "./secure-store-file.js";
import { KeychainCredentialStore } from "./secure-store-keychain.js";

// Re-export types and utilities
export type {
  CredentialMetadata,
  CredentialResult,
  SecureCredentialStore,
  StoreCredentialOptions,
  StoredCredential,
} from "./secure-store.js";

export {
  CREDENTIAL_KEY_PREFIX,
  CREDENTIAL_SERVICE_NAME,
  normalizeCredentialKey,
  validateCredentialKey,
} from "./secure-store.js";

export { EncryptedFileCredentialStore } from "./secure-store-file.js";
export { KeychainCredentialStore } from "./secure-store-keychain.js";

/**
 * Options for creating a credential store.
 */
export type CreateCredentialStoreOptions = {
  /** Preferred backend (will fall back if unavailable). */
  preferredBackend?: CredentialStoreBackend;
  /** Custom store directory for file-based stores. */
  storeDir?: string;
};

/**
 * Create a credential store with the best available backend.
 *
 * Priority order:
 * 1. User-specified backend (if available)
 * 2. OS keychain (if available on platform)
 * 3. Encrypted file (always available)
 */
export async function createCredentialStore(
  options: CreateCredentialStoreOptions = {},
): Promise<SecureCredentialStore> {
  const { preferredBackend, storeDir } = options;

  // If user explicitly wants plaintext, use encrypted-file with a warning
  if (preferredBackend === "plaintext") {
    console.warn(
      "[security] plaintext credential storage is deprecated. Using encrypted-file instead.",
    );
    return new EncryptedFileCredentialStore({ storeDir });
  }

  // Try preferred backend first
  if (preferredBackend === "keychain") {
    const keychain = new KeychainCredentialStore({ metadataDir: storeDir });
    if (await keychain.isAvailable()) {
      return keychain;
    }
    console.warn("[security] Keychain not available, falling back to encrypted-file.");
  }

  if (preferredBackend === "encrypted-file") {
    return new EncryptedFileCredentialStore({ storeDir });
  }

  // Auto-detect: try keychain first on macOS
  if (process.platform === "darwin") {
    const keychain = new KeychainCredentialStore({ metadataDir: storeDir });
    if (await keychain.isAvailable()) {
      return keychain;
    }
  }

  // Fall back to encrypted file
  return new EncryptedFileCredentialStore({ storeDir });
}

/**
 * Get information about available credential backends on this system.
 */
export async function getAvailableBackends(): Promise<
  Array<{ backend: CredentialStoreBackend; available: boolean; description: string }>
> {
  const keychain = new KeychainCredentialStore();
  const keychainAvailable = await keychain.isAvailable();

  return [
    {
      backend: "keychain",
      available: keychainAvailable,
      description: keychainAvailable
        ? "macOS Keychain (recommended)"
        : "macOS Keychain (not available on this platform)",
    },
    {
      backend: "encrypted-file",
      available: true,
      description: "Encrypted file storage (cross-platform fallback)",
    },
    {
      backend: "plaintext",
      available: false,
      description: "Plaintext storage (deprecated, not recommended)",
    },
  ];
}

/**
 * Migrate credentials from one store to another.
 *
 * @param source - Source credential store.
 * @param target - Target credential store.
 * @param options - Migration options.
 * @returns Number of credentials migrated.
 */
export async function migrateCredentials(
  source: SecureCredentialStore,
  target: SecureCredentialStore,
  options: { overwrite?: boolean; deleteSource?: boolean } = {},
): Promise<{ migrated: number; failed: string[]; skipped: string[] }> {
  const result = {
    migrated: 0,
    failed: [] as string[],
    skipped: [] as string[],
  };

  const listResult = await source.list();
  if (!listResult.ok) {
    throw new Error(`Failed to list source credentials: ${listResult.error}`);
  }

  for (const { key, metadata } of listResult.value) {
    // Check if already exists in target
    if (!options.overwrite && (await target.exists(key))) {
      result.skipped.push(key);
      continue;
    }

    // Retrieve from source
    const retrieveResult = await source.retrieve(key);
    if (!retrieveResult.ok) {
      result.failed.push(key);
      continue;
    }

    // Store in target
    const storeResult = await target.store(key, retrieveResult.value.value, {
      label: metadata.label,
      tags: metadata.tags,
      expiresAtMs: metadata.expiresAtMs,
    });

    if (!storeResult.ok) {
      result.failed.push(key);
      continue;
    }

    // Delete from source if requested
    if (options.deleteSource) {
      await source.delete(key);
    }

    result.migrated++;
  }

  return result;
}

/**
 * Tests for SecureCredentialStore implementations.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCredentialStore,
  EncryptedFileCredentialStore,
  getAvailableBackends,
  migrateCredentials,
  normalizeCredentialKey,
  validateCredentialKey,
} from "./index.js";

describe("normalizeCredentialKey", () => {
  it("normalizes keys to lowercase with safe characters", () => {
    expect(normalizeCredentialKey("API_KEY")).toBe("api_key");
    expect(normalizeCredentialKey("My Token")).toBe("my_token");
    expect(normalizeCredentialKey("test@123")).toBe("test_123");
  });

  it("handles empty strings", () => {
    expect(normalizeCredentialKey("")).toBe("");
    expect(normalizeCredentialKey("   ")).toBe("");
  });
});

describe("validateCredentialKey", () => {
  it("validates normal keys", () => {
    const result = validateCredentialKey("api_key");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("api_key");
    }
  });

  it("rejects empty keys", () => {
    const result = validateCredentialKey("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("empty");
    }
  });

  it("rejects overly long keys", () => {
    const longKey = "a".repeat(300);
    const result = validateCredentialKey(longKey);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("too long");
    }
  });
});

describe("EncryptedFileCredentialStore", () => {
  let tempDir: string;
  let store: EncryptedFileCredentialStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moltbot-cred-test-"));
    store = new EncryptedFileCredentialStore({ storeDir: tempDir });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports as available", async () => {
    expect(await store.isAvailable()).toBe(true);
  });

  it("has correct backend type", () => {
    expect(store.backend).toBe("encrypted-file");
  });

  it("stores and retrieves credentials", async () => {
    const storeResult = await store.store("test-key", "secret-value", {
      label: "Test Credential",
      tags: ["test"],
    });
    expect(storeResult.ok).toBe(true);

    const retrieveResult = await store.retrieve("test-key");
    expect(retrieveResult.ok).toBe(true);
    if (retrieveResult.ok) {
      expect(retrieveResult.value.value).toBe("secret-value");
      expect(retrieveResult.value.metadata.label).toBe("Test Credential");
      expect(retrieveResult.value.metadata.tags).toEqual(["test"]);
    }
  });

  it("returns error for non-existent credential", async () => {
    const result = await store.retrieve("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  it("checks credential existence", async () => {
    expect(await store.exists("test-key")).toBe(false);

    await store.store("test-key", "value");
    expect(await store.exists("test-key")).toBe(true);
  });

  it("lists credentials", async () => {
    await store.store("key1", "value1", { label: "First" });
    await store.store("key2", "value2", { label: "Second" });

    const listResult = await store.list();
    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      expect(listResult.value).toHaveLength(2);
      expect(listResult.value.map((e) => e.key).sort()).toEqual(["key1", "key2"]);
    }
  });

  it("deletes credentials", async () => {
    await store.store("to-delete", "value");
    expect(await store.exists("to-delete")).toBe(true);

    const deleteResult = await store.delete("to-delete");
    expect(deleteResult.ok).toBe(true);
    expect(await store.exists("to-delete")).toBe(false);
  });

  it("rotates credentials with backup", async () => {
    await store.store("rotate-test", "old-value");

    const rotateResult = await store.rotate("rotate-test", "new-value", true);
    expect(rotateResult.ok).toBe(true);

    const retrieveResult = await store.retrieve("rotate-test");
    expect(retrieveResult.ok).toBe(true);
    if (retrieveResult.ok) {
      expect(retrieveResult.value.value).toBe("new-value");
    }

    // Check backup exists
    const backupDir = path.join(tempDir, "backups");
    expect(fs.existsSync(backupDir)).toBe(true);
    const backups = fs.readdirSync(backupDir);
    expect(backups.length).toBeGreaterThan(0);
    expect(backups[0]).toContain("rotate-test");
  });

  it("updates existing credential metadata", async () => {
    await store.store("update-test", "value1", { label: "Original" });

    const firstRetrieve = await store.retrieve("update-test");
    expect(firstRetrieve.ok).toBe(true);
    const createdAt = firstRetrieve.ok ? firstRetrieve.value.metadata.createdAtMs : 0;

    // Wait a bit to ensure updatedAt differs
    await new Promise((r) => setTimeout(r, 10));

    await store.store("update-test", "value2", { label: "Updated" });

    const secondRetrieve = await store.retrieve("update-test");
    expect(secondRetrieve.ok).toBe(true);
    if (secondRetrieve.ok) {
      expect(secondRetrieve.value.value).toBe("value2");
      expect(secondRetrieve.value.metadata.label).toBe("Updated");
      // createdAt should be preserved
      expect(secondRetrieve.value.metadata.createdAtMs).toBe(createdAt);
      // updatedAt should be newer
      expect(secondRetrieve.value.metadata.updatedAtMs).toBeGreaterThan(createdAt);
    }
  });

  it("encrypts credentials at rest", async () => {
    await store.store("encrypted-test", "super-secret-value");

    // Read raw file
    const storePath = path.join(tempDir, "credentials.enc.json");
    const raw = fs.readFileSync(storePath, "utf8");

    // The secret should NOT appear in plaintext
    expect(raw).not.toContain("super-secret-value");
    // But the key should be readable in metadata
    expect(raw).toContain("encrypted-test");
  });

  it("sets restrictive file permissions", async () => {
    await store.store("perm-test", "value");

    const storePath = path.join(tempDir, "credentials.enc.json");
    const stats = fs.statSync(storePath);

    // Check for 0o600 (owner read/write only)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("createCredentialStore", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moltbot-cred-factory-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates encrypted-file store when explicitly requested", async () => {
    const store = await createCredentialStore({
      preferredBackend: "encrypted-file",
      storeDir: tempDir,
    });
    expect(store.backend).toBe("encrypted-file");
  });

  it("falls back from plaintext to encrypted-file", async () => {
    const store = await createCredentialStore({
      preferredBackend: "plaintext",
      storeDir: tempDir,
    });
    expect(store.backend).toBe("encrypted-file");
  });

  it("returns a working store with auto-detection", async () => {
    // Force encrypted-file backend to avoid keychain permission prompts in tests
    const store = await createCredentialStore({
      preferredBackend: "encrypted-file",
      storeDir: tempDir,
    });
    expect(await store.isAvailable()).toBe(true);

    // Should work regardless of backend
    await store.store("auto-test", "value");
    const result = await store.retrieve("auto-test");
    expect(result.ok).toBe(true);
  });
});

describe("getAvailableBackends", () => {
  it("returns backend availability information", async () => {
    const backends = await getAvailableBackends();

    expect(backends).toHaveLength(3);
    expect(backends.map((b) => b.backend)).toEqual(["keychain", "encrypted-file", "plaintext"]);

    // encrypted-file should always be available
    const encFile = backends.find((b) => b.backend === "encrypted-file");
    expect(encFile?.available).toBe(true);

    // plaintext should never be available (deprecated)
    const plaintext = backends.find((b) => b.backend === "plaintext");
    expect(plaintext?.available).toBe(false);
  });
});

describe("migrateCredentials", () => {
  let sourceDir: string;
  let targetDir: string;
  let sourceStore: EncryptedFileCredentialStore;
  let targetStore: EncryptedFileCredentialStore;

  beforeEach(() => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "moltbot-cred-source-"));
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "moltbot-cred-target-"));
    sourceStore = new EncryptedFileCredentialStore({ storeDir: sourceDir });
    targetStore = new EncryptedFileCredentialStore({ storeDir: targetDir });
  });

  afterEach(() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  it("migrates credentials between stores", async () => {
    await sourceStore.store("key1", "value1");
    await sourceStore.store("key2", "value2");

    const result = await migrateCredentials(sourceStore, targetStore);

    expect(result.migrated).toBe(2);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);

    // Verify in target
    const r1 = await targetStore.retrieve("key1");
    expect(r1.ok && r1.value.value).toBe("value1");
  });

  it("skips existing credentials without overwrite", async () => {
    await sourceStore.store("existing", "new-value");
    await targetStore.store("existing", "old-value");

    const result = await migrateCredentials(sourceStore, targetStore, { overwrite: false });

    expect(result.migrated).toBe(0);
    expect(result.skipped).toEqual(["existing"]);

    // Target should retain old value
    const r = await targetStore.retrieve("existing");
    expect(r.ok && r.value.value).toBe("old-value");
  });

  it("overwrites existing credentials when requested", async () => {
    await sourceStore.store("existing", "new-value");
    await targetStore.store("existing", "old-value");

    const result = await migrateCredentials(sourceStore, targetStore, { overwrite: true });

    expect(result.migrated).toBe(1);
    expect(result.skipped).toHaveLength(0);

    // Target should have new value
    const r = await targetStore.retrieve("existing");
    expect(r.ok && r.value.value).toBe("new-value");
  });

  it("deletes from source when requested", async () => {
    await sourceStore.store("to-move", "value");

    await migrateCredentials(sourceStore, targetStore, { deleteSource: true });

    // Should be gone from source
    expect(await sourceStore.exists("to-move")).toBe(false);
    // Should be in target
    expect(await targetStore.exists("to-move")).toBe(true);
  });
});

/**
 * Tests for gateway token keychain storage functions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoist the mock store to ensure it's available before module imports
const { inMemoryStore, resetStore, getStore } = vi.hoisted(() => {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    inMemoryStore: store,
    resetStore: () => store.clear(),
    getStore: () => store,
  };
});

// Mock the credential store module to avoid actual keychain access in tests
vi.mock("../credentials/index.js", () => ({
  createCredentialStore: vi.fn().mockImplementation(async () => ({
    backend: "encrypted-file",
    isAvailable: async () => true,
    store: async (key: string, value: string, options?: { label?: string; tags?: string[] }) => {
      inMemoryStore.set(key, { value, metadata: options ?? {} });
      return { ok: true };
    },
    retrieve: async (key: string) => {
      const entry = inMemoryStore.get(key);
      if (!entry) {
        return { ok: false, error: `Credential not found: ${key}` };
      }
      return {
        ok: true,
        value: { key, value: entry.value, metadata: entry.metadata },
      };
    },
    delete: async (key: string) => {
      inMemoryStore.delete(key);
      return { ok: true };
    },
    list: async () => ({
      ok: true,
      value: Array.from(inMemoryStore.entries()).map(([key, entry]) => ({
        key,
        metadata: entry.metadata,
      })),
    }),
    exists: async (key: string) => inMemoryStore.has(key),
    rotate: async () => ({ ok: true }),
  })),
}));

import {
  GATEWAY_TOKEN_CREDENTIAL_KEY,
  storeGatewayTokenInKeychain,
  retrieveGatewayTokenFromKeychain,
} from "./onboard-helpers.js";

describe("GATEWAY_TOKEN_CREDENTIAL_KEY", () => {
  it("has expected value", () => {
    expect(GATEWAY_TOKEN_CREDENTIAL_KEY).toBe("gateway-auth-token");
  });
});

describe("storeGatewayTokenInKeychain", () => {
  beforeEach(() => {
    resetStore();
  });

  it("stores token successfully", async () => {
    const result = await storeGatewayTokenInKeychain("test-token-12345");

    expect(result.ok).toBe(true);
    expect(result.backend).toBe("encrypted-file");
    expect(result.error).toBeUndefined();
  });

  it("stores token with correct key and metadata", async () => {
    await storeGatewayTokenInKeychain("my-secure-token");

    const store = getStore();

    expect(store.has(GATEWAY_TOKEN_CREDENTIAL_KEY)).toBe(true);
    const entry = store.get(GATEWAY_TOKEN_CREDENTIAL_KEY);
    expect(entry?.value).toBe("my-secure-token");
    expect((entry?.metadata as { label: string }).label).toBe("Gateway Authentication Token");
    expect((entry?.metadata as { tags: string[] }).tags).toContain("gateway");
    expect((entry?.metadata as { tags: string[] }).tags).toContain("auth");
  });
});

describe("retrieveGatewayTokenFromKeychain", () => {
  beforeEach(() => {
    resetStore();
  });

  it("returns null when token not stored", async () => {
    const token = await retrieveGatewayTokenFromKeychain();
    expect(token).toBeNull();
  });

  it("retrieves stored token", async () => {
    // Store a token first
    await storeGatewayTokenInKeychain("retrieved-token-xyz");

    // Retrieve it
    const token = await retrieveGatewayTokenFromKeychain();
    expect(token).toBe("retrieved-token-xyz");
  });

  it("returns exact token value", async () => {
    const originalToken = "AbCdEf123456!@#$%^&*()_+-=[]{}|;':\",./<>?";
    await storeGatewayTokenInKeychain(originalToken);

    const retrievedToken = await retrieveGatewayTokenFromKeychain();
    expect(retrievedToken).toBe(originalToken);
  });
});

describe("round-trip token storage", () => {
  beforeEach(() => {
    resetStore();
  });

  it("can store and retrieve multiple times", async () => {
    // First token
    await storeGatewayTokenInKeychain("first-token");
    expect(await retrieveGatewayTokenFromKeychain()).toBe("first-token");

    // Update with second token
    await storeGatewayTokenInKeychain("second-token");
    expect(await retrieveGatewayTokenFromKeychain()).toBe("second-token");

    // Update with third token
    await storeGatewayTokenInKeychain("third-token");
    expect(await retrieveGatewayTokenFromKeychain()).toBe("third-token");
  });
});

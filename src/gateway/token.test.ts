import { describe, expect, it } from "vitest";

import {
  calculateEntropy,
  DEFAULT_TOKEN_BYTES,
  detectWeakPatterns,
  generateAndValidateToken,
  generateSecureToken,
  isTokenSecure,
  MIN_TOKEN_LENGTH,
  validateToken,
} from "./token.js";

describe("generateSecureToken", () => {
  it("generates a token of expected length", () => {
    const token = generateSecureToken();
    // 32 bytes base64url encoded = ~43 characters
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(token.length).toBeLessThanOrEqual(44);
  });

  it("generates unique tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateSecureToken());
    }
    expect(tokens.size).toBe(100);
  });

  it("respects custom byte length", () => {
    const token16 = generateSecureToken(16);
    const token64 = generateSecureToken(64);
    expect(token16.length).toBeLessThan(token64.length);
    // 16 bytes base64url = ~22 chars
    expect(token16.length).toBeGreaterThanOrEqual(21);
    // 64 bytes base64url = ~86 chars
    expect(token64.length).toBeGreaterThanOrEqual(85);
  });

  it("produces URL-safe characters only", () => {
    for (let i = 0; i < 50; i++) {
      const token = generateSecureToken();
      // base64url uses A-Z, a-z, 0-9, -, _
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("calculateEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(calculateEntropy("")).toBe(0);
  });

  it("returns 0 for single character repeated", () => {
    expect(calculateEntropy("aaaaaaaaaa")).toBe(0);
  });

  it("returns ~1 for two equally distributed characters", () => {
    const entropy = calculateEntropy("ababababab");
    expect(entropy).toBeCloseTo(1, 1);
  });

  it("returns higher entropy for more diverse strings", () => {
    const lowEntropy = calculateEntropy("aabbccdd");
    const highEntropy = calculateEntropy("a1B2c3D4e5F6g7H8");
    expect(highEntropy).toBeGreaterThan(lowEntropy);
  });

  it("returns high entropy for random base64url string", () => {
    // A truly random base64url string has 64 possible chars = log2(64) = 6 bits max
    // In practice, entropy of finite strings is lower than theoretical max
    const randomToken = generateSecureToken(32);
    const entropy = calculateEntropy(randomToken);
    // Should be reasonably high (above our validation threshold)
    expect(entropy).toBeGreaterThan(4);
    expect(entropy).toBeLessThanOrEqual(6);
  });
});

describe("detectWeakPatterns", () => {
  it("detects repeated characters", () => {
    const patterns = detectWeakPatterns("aaaa1234");
    expect(patterns).toContain("repeated characters detected");
  });

  it("detects sequential characters", () => {
    const patterns = detectWeakPatterns("abc12345xyz");
    expect(patterns.some((p) => p.includes("sequential"))).toBe(true);
  });

  it("detects common weak words", () => {
    const patterns = detectWeakPatterns("mypassword123");
    expect(patterns.some((p) => p.includes("common word"))).toBe(true);
  });

  it("detects all-alphabetic tokens", () => {
    const patterns = detectWeakPatterns("OnlyLettersHere");
    expect(patterns).toContain("only alphabetic characters");
  });

  it("detects all-numeric tokens", () => {
    const patterns = detectWeakPatterns("12345678901234567890123456789012");
    expect(patterns).toContain("only numeric characters");
  });

  it("returns empty array for secure tokens", () => {
    const token = generateSecureToken();
    const patterns = detectWeakPatterns(token);
    expect(patterns).toHaveLength(0);
  });
});

describe("validateToken", () => {
  it("rejects undefined token", () => {
    const result = validateToken(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Token is required");
  });

  it("rejects null token", () => {
    const result = validateToken(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Token is required");
  });

  it("rejects empty token", () => {
    const result = validateToken("");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Token is required");
  });

  it("rejects short tokens", () => {
    const result = validateToken("short");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("too short"))).toBe(true);
  });

  it("rejects low entropy tokens", () => {
    const result = validateToken("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("low entropy"))).toBe(true);
  });

  it("accepts secure generated tokens", () => {
    const token = generateSecureToken();
    const result = validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("includes entropy in result", () => {
    const token = generateSecureToken();
    const result = validateToken(token);
    expect(result.entropy).toBeDefined();
    // Entropy should be above our validation threshold (4.5 for warnings)
    expect(result.entropy).toBeGreaterThan(4);
  });

  it("warns on weak patterns but may still be valid", () => {
    // A long enough token with some weak patterns
    const token = "abcdefghABCDEFGH12345678!@#$%^&*()";
    const result = validateToken(token);
    // May be valid (depends on overall entropy)
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("isTokenSecure", () => {
  it("returns false for invalid tokens", () => {
    expect(isTokenSecure(undefined)).toBe(false);
    expect(isTokenSecure(null)).toBe(false);
    expect(isTokenSecure("")).toBe(false);
    expect(isTokenSecure("short")).toBe(false);
  });

  it("returns true for secure tokens", () => {
    const token = generateSecureToken();
    expect(isTokenSecure(token)).toBe(true);
  });
});

describe("generateAndValidateToken", () => {
  it("generates valid tokens", () => {
    for (let i = 0; i < 10; i++) {
      const token = generateAndValidateToken();
      expect(isTokenSecure(token)).toBe(true);
    }
  });

  it("respects custom byte length", () => {
    const token = generateAndValidateToken(48);
    expect(token.length).toBeGreaterThan(60);
    expect(isTokenSecure(token)).toBe(true);
  });
});

describe("constants", () => {
  it("MIN_TOKEN_LENGTH is 32", () => {
    expect(MIN_TOKEN_LENGTH).toBe(32);
  });

  it("DEFAULT_TOKEN_BYTES is 32", () => {
    expect(DEFAULT_TOKEN_BYTES).toBe(32);
  });
});

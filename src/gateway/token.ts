/**
 * Secure token generation and validation for gateway authentication.
 * Part of Phase 2: Gateway Hardening.
 */

import crypto from "node:crypto";

/**
 * Minimum recommended token length in characters.
 */
export const MIN_TOKEN_LENGTH = 32;

/**
 * Default token byte length for generation (32 bytes = 256 bits).
 * When base64url encoded, this produces a ~43 character token.
 */
export const DEFAULT_TOKEN_BYTES = 32;

/**
 * Result of token validation.
 */
export type TokenValidationResult = {
  valid: boolean;
  warnings: string[];
  errors: string[];
  entropy?: number;
};

/**
 * Generate a cryptographically secure token.
 *
 * @param bytes - Number of random bytes to generate (default: 32)
 * @returns Base64url-encoded token string
 */
export function generateSecureToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  const buffer = crypto.randomBytes(bytes);
  // Use base64url encoding (URL-safe, no padding)
  return buffer.toString("base64url");
}

/**
 * Calculate Shannon entropy of a string.
 * Higher entropy indicates more randomness.
 *
 * @param str - String to analyze
 * @returns Entropy in bits per character (0-8 for ASCII)
 */
export function calculateEntropy(str: string): number {
  if (!str || str.length === 0) return 0;

  // Count character frequencies
  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  // Calculate entropy: -sum(p * log2(p))
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

/**
 * Check if a token contains common weak patterns.
 *
 * @param token - Token to check
 * @returns Array of detected weak patterns
 */
export function detectWeakPatterns(token: string): string[] {
  const patterns: string[] = [];

  // Check for repeated characters (more than 3 in a row)
  if (/(.)\1{3,}/.test(token)) {
    patterns.push("repeated characters detected");
  }

  // Check for sequential characters (abc, 123, etc.)
  const sequential =
    /(?:abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i;
  if (sequential.test(token)) {
    patterns.push("sequential characters detected");
  }

  // Check for common weak tokens
  const weakTokens = [
    "password",
    "secret",
    "token",
    "admin",
    "test",
    "demo",
    "changeme",
    "default",
  ];
  const lower = token.toLowerCase();
  for (const weak of weakTokens) {
    if (lower.includes(weak)) {
      patterns.push(`contains common word: ${weak}`);
      break;
    }
  }

  // Check for all same character type
  if (/^[a-z]+$/i.test(token)) {
    patterns.push("only alphabetic characters");
  } else if (/^\d+$/.test(token)) {
    patterns.push("only numeric characters");
  }

  return patterns;
}

/**
 * Validate a gateway authentication token.
 *
 * @param token - Token to validate
 * @returns Validation result with any warnings or errors
 */
export function validateToken(token: string | undefined | null): TokenValidationResult {
  const result: TokenValidationResult = {
    valid: true,
    warnings: [],
    errors: [],
  };

  if (!token || typeof token !== "string") {
    result.valid = false;
    result.errors.push("Token is required");
    return result;
  }

  const trimmed = token.trim();

  // Check minimum length
  if (trimmed.length < MIN_TOKEN_LENGTH) {
    result.valid = false;
    result.errors.push(`Token is too short (${trimmed.length} chars, minimum ${MIN_TOKEN_LENGTH})`);
  }

  // Calculate and check entropy
  const entropy = calculateEntropy(trimmed);
  result.entropy = entropy;

  // For a good random token, expect entropy > 4 bits/char
  // A truly random base64url string has ~6 bits/char entropy
  if (entropy < 3.5) {
    result.valid = false;
    result.errors.push(`Token has low entropy (${entropy.toFixed(2)} bits/char, minimum 3.5)`);
  } else if (entropy < 4.5) {
    result.warnings.push(
      `Token has moderate entropy (${entropy.toFixed(2)} bits/char), consider regenerating`,
    );
  }

  // Check for weak patterns
  const weakPatterns = detectWeakPatterns(trimmed);
  if (weakPatterns.length > 0) {
    result.warnings.push(...weakPatterns.map((p) => `Weak pattern: ${p}`));
  }

  return result;
}

/**
 * Check if a token meets minimum security requirements.
 *
 * @param token - Token to check
 * @returns true if token is acceptable, false otherwise
 */
export function isTokenSecure(token: string | undefined | null): boolean {
  const result = validateToken(token);
  return result.valid && result.errors.length === 0;
}

/**
 * Generate a secure token and validate it.
 * Retries if the generated token doesn't meet requirements (extremely rare).
 *
 * @param bytes - Number of random bytes (default: 32)
 * @param maxRetries - Maximum retries if validation fails (default: 3)
 * @returns Validated secure token
 */
export function generateAndValidateToken(
  bytes: number = DEFAULT_TOKEN_BYTES,
  maxRetries: number = 3,
): string {
  for (let i = 0; i < maxRetries; i++) {
    const token = generateSecureToken(bytes);
    if (isTokenSecure(token)) {
      return token;
    }
  }
  // Should never happen with crypto.randomBytes, but fallback
  return generateSecureToken(bytes);
}

/**
 * Tests for security presets and configuration resolution.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SECURITY_LEVEL,
  recommendSecurityLevel,
  resolveSecurityConfig,
  SECURITY_PRESETS,
  validateSecurityConfig,
} from "./security-presets.js";
import type { SecurityConfig } from "./types.security.js";

describe("SECURITY_PRESETS", () => {
  it("has all three security levels", () => {
    expect(Object.keys(SECURITY_PRESETS)).toEqual(["standard", "hardened", "paranoid"]);
  });

  it("standard preset has expected defaults", () => {
    const preset = SECURITY_PRESETS.standard;
    expect(preset.level).toBe("standard");
    expect(preset.credentials.store).toBe("keychain");
    expect(preset.gateway.requireAuthForLoopback).toBe(false);
    expect(preset.sandbox.defaultMode).toBe("non-main");
    expect(preset.skills.requireAllowlist).toBe(false);
  });

  it("hardened preset has stricter settings", () => {
    const preset = SECURITY_PRESETS.hardened;
    expect(preset.level).toBe("hardened");
    expect(preset.gateway.requireAuthForLoopback).toBe(true);
    expect(preset.gateway.minTokenLength).toBe(32);
    expect(preset.sandbox.defaultMode).toBe("all");
    expect(preset.audit.runOnStart).toBe(true);
    expect(preset.skills.blockCriticalRisks).toBe(true);
  });

  it("paranoid preset has maximum security", () => {
    const preset = SECURITY_PRESETS.paranoid;
    expect(preset.level).toBe("paranoid");
    expect(preset.audit.blockOnCritical).toBe(true);
    expect(preset.sandbox.networkPolicy).toBe("deny");
    expect(preset.skills.requireAllowlist).toBe(true);
    expect(preset.skills.quarantinePeriodMs).toBe(604800_000); // 7 days
  });
});

describe("DEFAULT_SECURITY_LEVEL", () => {
  it("defaults to hardened", () => {
    expect(DEFAULT_SECURITY_LEVEL).toBe("hardened");
  });
});

describe("resolveSecurityConfig", () => {
  it("returns hardened preset when no config provided", () => {
    const resolved = resolveSecurityConfig(undefined);
    expect(resolved.level).toBe("hardened");
    expect(resolved.gateway.requireAuthForLoopback).toBe(true);
  });

  it("uses specified level preset as base", () => {
    const resolved = resolveSecurityConfig({ level: "standard" });
    expect(resolved.level).toBe("standard");
    expect(resolved.gateway.requireAuthForLoopback).toBe(false);
  });

  it("allows overriding individual settings", () => {
    const config: SecurityConfig = {
      level: "standard",
      gateway: {
        requireAuthForLoopback: true, // Override standard default
      },
    };
    const resolved = resolveSecurityConfig(config);
    expect(resolved.level).toBe("standard");
    expect(resolved.gateway.requireAuthForLoopback).toBe(true);
    // Other standard defaults should still apply
    expect(resolved.gateway.minTokenLength).toBe(24);
  });

  it("preserves all user overrides", () => {
    const config: SecurityConfig = {
      level: "paranoid",
      credentials: {
        rotationReminderDays: 7,
      },
      audit: {
        alertWebhook: "https://example.com/webhook",
      },
      skills: {
        quarantinePeriodMs: 1000,
      },
    };
    const resolved = resolveSecurityConfig(config);
    expect(resolved.credentials.rotationReminderDays).toBe(7);
    expect(resolved.audit.alertWebhook).toBe("https://example.com/webhook");
    expect(resolved.skills.quarantinePeriodMs).toBe(1000);
    // Paranoid defaults should still apply where not overridden
    expect(resolved.audit.blockOnCritical).toBe(true);
  });
});

describe("recommendSecurityLevel", () => {
  it("recommends standard for casual use", () => {
    expect(recommendSecurityLevel({})).toBe("standard");
  });

  it("recommends hardened for production", () => {
    expect(recommendSecurityLevel({ isProduction: true })).toBe("hardened");
  });

  it("recommends hardened for external collaborators", () => {
    expect(recommendSecurityLevel({ hasExternalCollaborators: true })).toBe("hardened");
  });

  it("recommends paranoid for financial workflows", () => {
    expect(recommendSecurityLevel({ hasFinancialWorkflows: true })).toBe("paranoid");
  });

  it("prioritizes financial over production", () => {
    expect(
      recommendSecurityLevel({
        isProduction: true,
        hasFinancialWorkflows: true,
      }),
    ).toBe("paranoid");
  });
});

describe("validateSecurityConfig", () => {
  it("validates standard config against standard level", () => {
    const config = resolveSecurityConfig({ level: "standard" });
    const issues = validateSecurityConfig(config, "standard");
    expect(issues).toHaveLength(0);
  });

  it("validates hardened config against hardened level", () => {
    const config = resolveSecurityConfig({ level: "hardened" });
    const issues = validateSecurityConfig(config, "hardened");
    expect(issues).toHaveLength(0);
  });

  it("validates paranoid config against paranoid level", () => {
    const config = resolveSecurityConfig({ level: "paranoid" });
    const issues = validateSecurityConfig(config, "paranoid");
    expect(issues).toHaveLength(0);
  });

  it("finds issues when standard config used for hardened requirements", () => {
    const config = resolveSecurityConfig({ level: "standard" });
    const issues = validateSecurityConfig(config, "hardened");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.includes("requireAuthForLoopback"))).toBe(true);
    expect(issues.some((i) => i.includes("minTokenLength"))).toBe(true);
  });

  it("finds issues when hardened config used for paranoid requirements", () => {
    const config = resolveSecurityConfig({ level: "hardened" });
    const issues = validateSecurityConfig(config, "paranoid");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.includes("blockOnCritical"))).toBe(true);
  });

  it("allows stricter config for lower level", () => {
    const config = resolveSecurityConfig({ level: "paranoid" });
    const issues = validateSecurityConfig(config, "standard");
    expect(issues).toHaveLength(0);
  });

  it("identifies specific configuration gaps", () => {
    const config = resolveSecurityConfig({
      level: "standard",
      gateway: {
        minTokenLength: 20, // Too short for hardened
      },
    });
    const issues = validateSecurityConfig(config, "hardened");
    expect(issues.some((i) => i.includes("minTokenLength") && i.includes("20"))).toBe(true);
  });
});

/**
 * Security level presets for Moltbot.
 * Part of Phase 1: Security Hardening by Default.
 */

import type { ResolvedSecurityConfig, SecurityConfig, SecurityLevel } from "./types.security.js";

// Default network allowlist for AI providers
const DEFAULT_NETWORK_ALLOWLIST = [
  "api.anthropic.com",
  "api.openai.com",
  "*.bedrock.*.amazonaws.com",
  "api.x.ai", // Grok
  "generativelanguage.googleapis.com", // Gemini
  "registry.npmjs.org", // For skill/plugin installation
];

/**
 * Standard security preset - good defaults for most users.
 * Balances security with ease of use.
 */
const STANDARD_PRESET: ResolvedSecurityConfig = {
  level: "standard",
  credentials: {
    store: "keychain",
    rotationReminderDays: 90,
    backupBeforeMigration: true,
  },
  audit: {
    runOnStart: false,
    blockOnCritical: false,
    logFindings: true,
    alertWebhook: undefined,
  },
  gateway: {
    requireAuthForLoopback: false,
    minTokenLength: 24,
    autoGenerateToken: true,
    warnOnInsecureBind: true,
  },
  sandbox: {
    defaultMode: "non-main",
    networkPolicy: "allow",
    networkAllowlist: undefined,
  },
  skills: {
    requireAllowlist: false,
    autoVet: true,
    blockCriticalRisks: false,
    quarantinePeriodMs: 0,
    requireSignature: "none",
  },
};

/**
 * Hardened security preset - recommended for production use.
 * Enables additional security controls.
 */
const HARDENED_PRESET: ResolvedSecurityConfig = {
  level: "hardened",
  credentials: {
    store: "keychain",
    rotationReminderDays: 60,
    backupBeforeMigration: true,
  },
  audit: {
    runOnStart: true,
    blockOnCritical: false,
    logFindings: true,
    alertWebhook: undefined,
  },
  gateway: {
    requireAuthForLoopback: true,
    minTokenLength: 32,
    autoGenerateToken: true,
    warnOnInsecureBind: true,
  },
  sandbox: {
    defaultMode: "all",
    networkPolicy: "allow",
    networkAllowlist: DEFAULT_NETWORK_ALLOWLIST,
  },
  skills: {
    requireAllowlist: false,
    autoVet: true,
    blockCriticalRisks: true,
    quarantinePeriodMs: 86400_000, // 24 hours
    requireSignature: "official",
  },
};

/**
 * Paranoid security preset - maximum security, reduced functionality.
 * Use when security is more important than convenience.
 */
const PARANOID_PRESET: ResolvedSecurityConfig = {
  level: "paranoid",
  credentials: {
    store: "keychain",
    rotationReminderDays: 30,
    backupBeforeMigration: true,
  },
  audit: {
    runOnStart: true,
    blockOnCritical: true,
    logFindings: true,
    alertWebhook: undefined,
  },
  gateway: {
    requireAuthForLoopback: true,
    minTokenLength: 32,
    autoGenerateToken: true,
    warnOnInsecureBind: true,
  },
  sandbox: {
    defaultMode: "all",
    networkPolicy: "deny",
    networkAllowlist: DEFAULT_NETWORK_ALLOWLIST,
  },
  skills: {
    requireAllowlist: true,
    autoVet: true,
    blockCriticalRisks: true,
    quarantinePeriodMs: 604800_000, // 7 days
    requireSignature: "official",
  },
};

/**
 * Security presets by level.
 */
export const SECURITY_PRESETS: Record<SecurityLevel, ResolvedSecurityConfig> = {
  standard: STANDARD_PRESET,
  hardened: HARDENED_PRESET,
  paranoid: PARANOID_PRESET,
};

/**
 * Default security level for new installations.
 */
export const DEFAULT_SECURITY_LEVEL: SecurityLevel = "hardened";

/**
 * Resolve security configuration by merging user config with preset defaults.
 * User config values take precedence over preset defaults.
 */
export function resolveSecurityConfig(
  userConfig: SecurityConfig | undefined,
): ResolvedSecurityConfig {
  const level = userConfig?.level ?? DEFAULT_SECURITY_LEVEL;
  const preset = SECURITY_PRESETS[level];

  return {
    level,
    credentials: {
      store: userConfig?.credentials?.store ?? preset.credentials.store,
      rotationReminderDays:
        userConfig?.credentials?.rotationReminderDays ?? preset.credentials.rotationReminderDays,
      backupBeforeMigration:
        userConfig?.credentials?.backupBeforeMigration ?? preset.credentials.backupBeforeMigration,
    },
    audit: {
      runOnStart: userConfig?.audit?.runOnStart ?? preset.audit.runOnStart,
      blockOnCritical: userConfig?.audit?.blockOnCritical ?? preset.audit.blockOnCritical,
      logFindings: userConfig?.audit?.logFindings ?? preset.audit.logFindings,
      alertWebhook: userConfig?.audit?.alertWebhook ?? preset.audit.alertWebhook,
    },
    gateway: {
      requireAuthForLoopback:
        userConfig?.gateway?.requireAuthForLoopback ?? preset.gateway.requireAuthForLoopback,
      minTokenLength: userConfig?.gateway?.minTokenLength ?? preset.gateway.minTokenLength,
      autoGenerateToken: userConfig?.gateway?.autoGenerateToken ?? preset.gateway.autoGenerateToken,
      warnOnInsecureBind:
        userConfig?.gateway?.warnOnInsecureBind ?? preset.gateway.warnOnInsecureBind,
    },
    sandbox: {
      defaultMode: userConfig?.sandbox?.defaultMode ?? preset.sandbox.defaultMode,
      networkPolicy: userConfig?.sandbox?.networkPolicy ?? preset.sandbox.networkPolicy,
      networkAllowlist: userConfig?.sandbox?.networkAllowlist ?? preset.sandbox.networkAllowlist,
    },
    skills: {
      requireAllowlist: userConfig?.skills?.requireAllowlist ?? preset.skills.requireAllowlist,
      autoVet: userConfig?.skills?.autoVet ?? preset.skills.autoVet,
      blockCriticalRisks:
        userConfig?.skills?.blockCriticalRisks ?? preset.skills.blockCriticalRisks,
      quarantinePeriodMs:
        userConfig?.skills?.quarantinePeriodMs ?? preset.skills.quarantinePeriodMs,
      requireSignature: userConfig?.skills?.requireSignature ?? preset.skills.requireSignature,
    },
  };
}

/**
 * Get recommended security level based on intended use case.
 */
export function recommendSecurityLevel(useCase: {
  isProduction?: boolean;
  hasFinancialWorkflows?: boolean;
  hasExternalCollaborators?: boolean;
  isHeadless?: boolean;
}): SecurityLevel {
  if (useCase.hasFinancialWorkflows) {
    return "paranoid";
  }
  if (useCase.isProduction || useCase.hasExternalCollaborators) {
    return "hardened";
  }
  return "standard";
}

/**
 * Validate that a security configuration meets minimum requirements for a level.
 * Returns array of validation issues (empty if valid).
 */
export function validateSecurityConfig(
  config: ResolvedSecurityConfig,
  requiredLevel: SecurityLevel,
): string[] {
  const issues: string[] = [];
  const preset = SECURITY_PRESETS[requiredLevel];

  // Token length validation
  if (config.gateway.minTokenLength < preset.gateway.minTokenLength) {
    issues.push(
      `minTokenLength (${config.gateway.minTokenLength}) is less than required for ${requiredLevel} (${preset.gateway.minTokenLength})`,
    );
  }

  // Loopback auth for hardened/paranoid
  if (requiredLevel !== "standard" && !config.gateway.requireAuthForLoopback) {
    issues.push(`requireAuthForLoopback must be enabled for ${requiredLevel} security level`);
  }

  // Sandbox mode for paranoid
  if (requiredLevel === "paranoid" && config.sandbox.defaultMode !== "all") {
    issues.push(`sandbox.defaultMode must be 'all' for paranoid security level`);
  }

  // Audit on start for hardened/paranoid
  if (requiredLevel !== "standard" && !config.audit.runOnStart) {
    issues.push(`audit.runOnStart must be enabled for ${requiredLevel} security level`);
  }

  // Block on critical for paranoid
  if (requiredLevel === "paranoid" && !config.audit.blockOnCritical) {
    issues.push(`audit.blockOnCritical must be enabled for paranoid security level`);
  }

  return issues;
}

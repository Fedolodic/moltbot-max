/**
 * Security configuration types for Moltbot.
 * Part of Phase 1: Security Hardening by Default.
 */

// Credential storage backend types
export type CredentialStoreBackend = "keychain" | "encrypted-file" | "plaintext";

// Security level presets
export type SecurityLevel = "standard" | "hardened" | "paranoid";

// Credential configuration
export type SecurityCredentialsConfig = {
  /** Storage backend for credentials (default: keychain with encrypted-file fallback). */
  store?: CredentialStoreBackend;
  /** Days between automatic token rotation reminders (default: 90). */
  rotationReminderDays?: number;
  /** Enable automatic backup of credentials before migration (default: true). */
  backupBeforeMigration?: boolean;
};

// Audit configuration
export type SecurityAuditConfig = {
  /** Run security audit on gateway start (default: true for hardened/paranoid). */
  runOnStart?: boolean;
  /** Block gateway start if critical findings (default: true for paranoid). */
  blockOnCritical?: boolean;
  /** Log audit findings to file (default: true). */
  logFindings?: boolean;
  /** Webhook URL for security alerts. */
  alertWebhook?: string;
};

// Gateway security hardening
export type SecurityGatewayConfig = {
  /** Require authentication even for loopback connections (default: true for hardened/paranoid). */
  requireAuthForLoopback?: boolean;
  /** Minimum token length in characters (default: 32). */
  minTokenLength?: number;
  /** Auto-generate token on first onboard if not set (default: true). */
  autoGenerateToken?: boolean;
  /** Warn when binding to non-loopback without explicit flag (default: true). */
  warnOnInsecureBind?: boolean;
};

// Sandbox security configuration
export type SecuritySandboxConfig = {
  /** Sandbox mode override (default: 'all' for hardened/paranoid). */
  defaultMode?: "off" | "non-main" | "all";
  /** Network policy for sandboxed execution. */
  networkPolicy?: "allow" | "deny";
  /** Allowed outbound domains when networkPolicy is 'deny'. */
  networkAllowlist?: string[];
};

// Skills security configuration
export type SecuritySkillsConfig = {
  /** Require skills to be in allowlist (default: true for paranoid). */
  requireAllowlist?: boolean;
  /** Auto-vet skills on installation (default: true). */
  autoVet?: boolean;
  /** Block skills with critical risk findings (default: true for hardened/paranoid). */
  blockCriticalRisks?: boolean;
  /** Quarantine period in ms for new skills (default: 0 for standard, 86400000 for paranoid). */
  quarantinePeriodMs?: number;
  /** Require signature verification (default: 'none' for standard, 'official' for paranoid). */
  requireSignature?: "none" | "official" | "any";
};

// Main security configuration
export type SecurityConfig = {
  /** Security level preset (applies sensible defaults based on level). */
  level?: SecurityLevel;
  /** Credential storage configuration. */
  credentials?: SecurityCredentialsConfig;
  /** Security audit configuration. */
  audit?: SecurityAuditConfig;
  /** Gateway security hardening. */
  gateway?: SecurityGatewayConfig;
  /** Sandbox security configuration. */
  sandbox?: SecuritySandboxConfig;
  /** Skills security configuration. */
  skills?: SecuritySkillsConfig;
};

// Resolved security configuration (with all defaults applied)
export type ResolvedSecurityConfig = {
  level: SecurityLevel;
  credentials: Required<SecurityCredentialsConfig>;
  audit: Required<Omit<SecurityAuditConfig, "alertWebhook">> &
    Pick<SecurityAuditConfig, "alertWebhook">;
  gateway: Required<SecurityGatewayConfig>;
  sandbox: Required<Omit<SecuritySandboxConfig, "networkAllowlist">> &
    Pick<SecuritySandboxConfig, "networkAllowlist">;
  skills: Required<SecuritySkillsConfig>;
};

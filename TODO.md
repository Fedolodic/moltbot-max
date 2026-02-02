# SecureClaw - Security Hardening Work Breakdown Structure

**Generated**: 2026-01-29
**Last Updated**: 2026-02-02 (Gap Analysis v3 - CLI Complete)
**Status**: Active
**Source**: [Security Hardening Design Doc](design-docs/2-security-hardening-by-default.md)

## Overview

Implementation plan for making OpenClaw secure by default across all platforms, plus workflow-specific security profiles for Second Brain, Twitter Intelligence, Email Assistant, Autonomous Dev, Voice TTS, Trading Agent, and Idea Pipeline.

## Project Goals

- G1: Zero-config secure defaults (fresh install passes `openclaw security audit --deep`)
- G2: Defense in depth (3+ security layers between untrusted input and host)
- G3: Platform-appropriate hardening (Keychain, Secure Enclave, App Sandbox)
- G4: Credential protection (no plaintext secrets on disk)
- G5: Minimal attack surface (default tool profile is `minimal`)
- G6: Transparent security posture (users can audit their config)

## Milestones

- [ ] **M1: Foundation Complete** - SecureCredentialStore + security presets working (IN PROGRESS - 98% for CLI, mobile backends remaining)
- [ ] **M2: Gateway Hardened** - Auto-token generation, loopback auth, native apps authenticated (IN PROGRESS - Phase 2.1 + 2.2 complete, 2.3 native apps remaining)
- [ ] **M3: Sandbox Default** - All tool execution sandboxed by default
- [ ] **M4: Skill Vetting** - Vetting engine, quarantine, signature verification
- [ ] **M5: Workflows Enabled** - All 7 workflow profiles implemented and secure
- [ ] **M6: Multi-Model Routing** - Per-workflow model assignment with cost budgets
- [ ] **M7: Collaboration Security** - Signed commits, collaborator trust, ctx namespacing
- [ ] **M8: Documentation Complete** - All docs updated, migration guide published

---

## Implementation Progress Summary

### Completed (2026-01-30)

| Task | Files Created | Tests |
|------|---------------|-------|
| 1.1.1 SecureCredentialStore interface | `src/credentials/secure-store.ts` | ✅ 24 tests |
| 1.1.2 macOS Keychain backend | `src/credentials/secure-store-keychain.ts` | ✅ (via factory) |
| 1.1.7 Encrypted file fallback | `src/credentials/secure-store-file.ts` | ✅ 12 tests |
| 1.1.8 Platform detection factory | `src/credentials/index.ts` | ✅ 4 tests |
| 1.2.1-1.2.4 Security presets | `src/config/types.security.ts`, `security-presets.ts`, `zod-schema.security.ts` | ✅ 21 tests |
| 1.3.1 Plaintext credential detector | `src/security/audit-credentials.ts` | ✅ (integrated) |
| 1.3.2 Migration wizard CLI | `src/cli/credentials-cli.ts` | ✅ (via CLI) |
| 1.3.3 Secure file deletion | `src/cli/credentials-cli.ts` | ✅ (secureDeleteFile) |
| 1.4.1 Credential storage audit checks | `src/security/audit-credentials.ts` | ✅ (integrated) |
| 1.4.2 Security level audit checks | `src/security/audit.ts` | ✅ (integrated) |
| 1.4.3 Security status command | `src/cli/security-cli.ts` | ✅ (via CLI) |
| 1.3.4 Migration in audit --fix | `src/security/fix.ts`, `src/security/audit-credentials.ts` | ✅ (integrated) |

### Intentional Design Enhancements

The implementation enhances the design doc interface for better robustness:

| Design Doc | Implementation | Rationale |
|------------|----------------|-----------|
| `get(key): Promise<string \| null>` | `retrieve(key): Promise<CredentialResult<StoredCredential>>` | Better error handling with typed results |
| No metadata | Full metadata (createdAt, updatedAt, label, tags, expiresAt) | Audit trail, rotation reminders |
| No rotation | `rotate(key, newValue, backupOld)` | Safe credential rotation with backup |
| age encryption | AES-256-GCM with scrypt | Standard Node.js crypto, equally secure |

---

## Identified Gaps & Areas of Improvement

### Gap Analysis (2026-01-30, Updated v3)

These items were identified as gaps between the design doc and current implementation:

#### Design Doc Component Status Summary

| Component | Design Doc Lines | Status | Key Gaps |
|-----------|------------------|--------|----------|
| 1. Secure Gateway Defaults | 128-166 | 85% | GAP-35, GAP-36 |
| 2. Strict DM Policy Engine | 167-204 | 0% | GAP-31-34 (High Priority) |
| 3. Sandboxed Execution | 205-267 | 10% | Phase 3 tasks + GAP-16-17, 37 |
| 4. Encrypted Credential Storage | 268-308 | 75% | GAP-1, 2, 7, 8, 13 (mobile/desktop backends) |
| 5. Skill Vetting | 309-356 | 0% | Phase 4 tasks + GAP-24-25 |
| 6. Security Audit Checks | 362-376 | 70% | GAP-24-27 |
| 7. CLI Commands | 378-394 | 100% ✅ | All complete (GAP-28-30) |
| 8. Workflow Profiles (Part 2) | 398-1585 | 0% | Phase 5-6 tasks |
| 9. Platform Hardening | 1766-1941 | 0% | Phase 3.4 tasks |

#### HIGH Priority Gaps

- [ ] **GAP-1** iOS Keychain backend (Swift) - Required for iOS app security
  - Design doc: 1.1.3
  - Blocks: M1 completion, iOS app hardening

- [ ] **GAP-2** Android Keystore backend (Kotlin) - Required for Android app security
  - Design doc: 1.1.4
  - Blocks: M1 completion, Android app hardening

- [x] **GAP-3** Plaintext credential detector - Finds legacy insecure credentials ✅
  - Design doc: 1.3.1
  - Location: Scan `~/.clawdbot/credentials/`, `~/.clawdbot/config.json`
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit-credentials.ts` - `scanForPlaintextCredentials()`

- [x] **GAP-4** Migration wizard CLI (`openclaw credentials migrate`) ✅
  - Design doc: 1.3.2
  - Depends on: GAP-3
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/credentials-cli.ts`
  - Commands: `openclaw credentials status`, `migrate`, `list`, `backends`

- [x] **GAP-5** `openclaw security status` command - Show security posture summary ✅
  - Design doc: 1.4.3
  - Should show: security level, credential storage, sandbox mode, audit findings
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/security-cli.ts` - `openclaw security status`

- [x] **GAP-6** Credential storage audit checks integration ✅
  - Design doc: 1.4.1
  - Add checks to existing `src/security/audit.ts`: `credentials.plaintext`, `credentials.keychain_unavailable`
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit-credentials.ts` - `collectCredentialStorageFindings()`

#### MEDIUM Priority Gaps

- [ ] **GAP-7** Linux libsecret backend - For Linux desktop users
  - Design doc: 1.1.5
  - Falls back to encrypted file currently

- [ ] **GAP-8** Windows Credential Manager backend - For Windows users
  - Design doc: 1.1.6
  - Falls back to encrypted file currently

- [x] **GAP-9** Secure file deletion (overwrite + unlink) ✅
  - Design doc: 1.3.3
  - Needed for: Securely removing migrated plaintext credentials
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/credentials-cli.ts` - `secureDeleteFile()` function
  - Usage: `openclaw credentials migrate --secure-delete`

- [x] **GAP-10** Security level audit checks ✅
  - Design doc: 1.4.2
  - Check: preset compliance, warn if 'standard' with sensitive workflows
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit.ts` - `collectSecurityLevelFindings()`

- [ ] **GAP-11** User passphrase option for encrypted file fallback
  - Design doc: 1.1.7
  - Current: Uses machine-derived key only
  - Needed: User can set custom passphrase for portability

#### LOW Priority Gaps

- [ ] **GAP-12** Hardware key (YubiKey) support for file fallback
  - Design doc: 1.1.7
  - Nice-to-have for high-security environments

- [ ] **GAP-13** Credential category access control
  - Design doc: Component 4 credential categories table
  - Currently: All credentials have same access level
  - Should: API Keys = Agent only, Channel Tokens = Gateway only, etc.

- [ ] **GAP-14** Rotation reminder system
  - Design doc: `rotationReminderDays` in config
  - Currently: Config exists but no reminder mechanism
  - Should: Alert when credentials are due for rotation

#### SecurityConfig Type Alignment Gaps (2026-01-30)

These gaps were identified by comparing `src/config/types.security.ts` with design doc specification (lines 1683-1730):

- [ ] **GAP-15** `gateway.auth.mode` - Missing authentication mode option
  - Design doc: `mode: 'token' | 'password'`
  - Current: Only token mode assumed
  - Impact: Limited flexibility for enterprise deployments

- [x] **GAP-16** `sandbox.scope` - Missing sandbox isolation scope ✅
  - Design doc: `scope: 'session' | 'agent' | 'shared'`
  - **Completed**: 2026-01-30 (verified via 3.1.2)
  - Implementation: `resolveSandboxScope()` in `src/agents/sandbox/config.ts` already supports all three modes with 'agent' as default

- [x] **GAP-17** `sandbox.limits` - Missing resource limits configuration ✅
  - Design doc: `limits: { memory: '2g', cpus: 1, timeout: 300_000 }`
  - **Completed**: 2026-01-30 (via 3.1.3)
  - Implementation: Defaults applied in `resolveSandboxDockerConfig()` for memory, cpus, timeout

- [ ] **GAP-18** `credentials.encryptionKey` - Missing encryption key source option
  - Design doc: `encryptionKey?: 'passphrase' | 'hardware' | 'env'`
  - Current: Uses machine-derived key only
  - Impact: Limited portability and enterprise key management

#### Missing Audit Checks (Design Doc lines 362-376)

- [x] **GAP-19** `gateway.auth.missing_loopback` audit check ✅
  - Severity: Critical
  - Description: No auth even for localhost
  - **Completed**: Already exists as `gateway.loopback_no_auth` in `src/security/audit.ts:296-305`
  - Note: Checks when control UI enabled without gateway auth

- [x] **GAP-20** `gateway.auth.weak_token` audit check ✅
  - Severity: Critical
  - Description: Token < 32 chars or low entropy
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit.ts` - renamed to `gateway.auth.weak_token`, threshold increased to 32 chars
  - Note: Entropy check deferred (low priority)

- [x] **GAP-21** `sandbox.mode.off` audit check ✅
  - Severity: Critical
  - Description: No sandboxing enabled
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit.ts` - `collectSandboxSecurityFindings()`

- [x] **GAP-22** `sandbox.network.unrestricted` audit check ✅
  - Severity: Warn
  - Description: Sandbox allows all outbound
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit.ts` - `collectSandboxSecurityFindings()`

- [x] **GAP-23** `tools.dangerous.enabled` audit check ✅
  - Severity: Warn
  - Description: Dangerous tools enabled without approval
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit.ts` - `collectDangerousToolsFindings()`

- [ ] **GAP-24** `skills.unvetted` audit check
  - Severity: Warn
  - Description: Installed skills not vetted
  - Current: Not implemented

- [ ] **GAP-25** `skills.quarantined` audit check
  - Severity: Info
  - Description: Skills in quarantine period
  - Current: Not implemented

- [ ] **GAP-26** `platform.sandbox.disabled` audit check
  - Severity: Critical
  - Description: App Sandbox not enforced (macOS)
  - Current: Not implemented

- [ ] **GAP-27** `platform.hardened_runtime` audit check
  - Severity: Warn
  - Description: Hardened Runtime not enabled (macOS)
  - Current: Not implemented

#### Missing CLI Commands (Design Doc lines 378-394)

- [x] **GAP-28** `openclaw security configure` command ✅
  - Description: Interactive security configuration wizard
  - **Completed**: 2026-02-02
  - Implementation: `src/cli/security-cli.ts` - `openclaw security configure`
  - Features: Use case recommendation, security level selection, customizable settings, non-interactive mode

- [x] **GAP-29** `openclaw security report` command ✅
  - Description: Export security report in json/html format
  - **Completed**: 2026-02-02
  - Implementation: `src/cli/security-cli.ts` - `openclaw security report --format json|html -o <file>`
  - Features: Full audit with credentials, configuration, findings; HTML report with styling

- [x] **GAP-30** `openclaw security test` command ✅
  - Description: Simulate attack scenarios (prompt-injection, credential-exfil, skill-malware)
  - **Completed**: 2026-02-02
  - Implementation: `src/cli/security-cli.ts` - `openclaw security test --scenario <name>`
  - Scenarios: prompt-injection, credential-exfil, skill-malware, all

#### DM Policy & Channel Security Gaps (Design Doc lines 167-204)

- [x] **GAP-31** Default DM policy change from 'pairing' to 'allowlist' ✅
  - Design doc: `channels._default.dmPolicy: 'allowlist'`
  - Current: Defaults to 'pairing' which allows strangers to request access
  - Impact: Unauthorized access via messaging channels
  - Priority: High
  - **Completed**: 2026-01-30
  - Implementation: Changed Zod schema defaults in `zod-schema.providers-core.ts` and `zod-schema.providers-whatsapp.ts`

- [x] **GAP-32** Auto-add onboarding user to allowlist ✅
  - Design doc: `autoAllowOnboardingUser: true`
  - Current: Not implemented
  - Impact: Users must manually add themselves after onboarding
  - **Completed**: 2026-01-30
  - Implementation: Updated `src/wizard/onboarding.ts` to always prompt for allowFrom during channel setup

- [x] **GAP-33** Default group policy should be 'disabled' ✅
  - Design doc: `groups._default.policy: 'disabled'`, `requireMention: true`
  - Current: Groups enabled by default without mention requirement
  - Impact: Bot responds to messages in groups without being mentioned
  - **Completed**: 2026-01-30
  - Implementation: Changed Zod schema defaults for groupPolicy from 'allowlist' to 'disabled'

- [x] **GAP-34** Session scoping change to 'per-channel-peer' ✅
  - Design doc: `session.dmScope: 'per-channel-peer'`
  - Current: May use shared session scope
  - Impact: Session isolation between different channel peers
  - **Completed**: 2026-01-30
  - Implementation: Changed default dmScope from "main" to "per-channel-peer" in Zod schema and all runtime code

#### Control UI & Gateway Security Gaps (Design Doc lines 149-158)

- [x] **GAP-35** Control UI security defaults ✅
  - Design doc: `controlUi.allowInsecureAuth: false`, `dangerouslyDisableDeviceAuth: false`
  - Current: Not explicitly set to secure defaults
  - Priority: Medium
  - **Completed**: 2026-01-30
  - Implementation: Added `.default(false)` to `allowInsecureAuth` and `dangerouslyDisableDeviceAuth` in `src/config/zod-schema.ts`

- [ ] **GAP-36** Proxy trust warning on startup
  - Design doc: `gateway.warnOnProxyWithoutTrust: true`
  - Current: Not implemented
  - Priority: Low (defense in depth)

#### Tool Execution Security Gaps (Design Doc lines 247-253)

- [x] **GAP-37** Elevated execution disabled by default ✅
  - Design doc: `tools.elevated.enabled: false`, `requireApproval: true`
  - Current: Not explicitly disabled
  - Priority: Medium
  - **Completed**: 2026-01-30
  - Implementation: Added `.default(false)` to `tools.elevated.enabled` in `src/config/zod-schema.agent-runtime.ts`, updated runtime checks to use `=== true`

#### Token Onboarding UX Gaps (Design Doc lines 161-165)

- [x] **GAP-38** Token display during onboarding ✅
  - Design doc: "Display token once for user to save" (line 163)
  - **Completed**: 2026-01-30
  - Implementation: Added token display note in `src/wizard/onboarding.ts` after keychain storage
  - Shows token value with copy instructions for web UI, third-party integrations, CLI on other machines

- [x] **GAP-39** Token recovery mechanism ✅
  - Design doc: Implies token can be retrieved from keychain
  - **Completed**: 2026-01-30
  - Implementation: Added `openclaw gateway token show` command in `src/cli/gateway-cli/register.ts`
  - Retrieves token from keychain (preferred) or config file (fallback)
  - Supports `--json` output

#### Secure Enclave Gaps (Design Doc line 307)

- [ ] **GAP-40** Session encryption keys in Secure Enclave
  - Design doc: "Session Encryption Keys | Secure Enclave (where available) | Derived per-session"
  - Current: Not implemented
  - Should: Use Secure Enclave on iOS/macOS for session key derivation
  - Priority: Low (advanced hardening)

#### Security Preset Verification Gaps

- [x] **GAP-41** Verify security preset values match design doc ✅ (Verified 2026-01-30)
  - Design doc lines 1736-1763 specify exact preset values
  - **Verified alignment:**
    - standard: `requireAuthForLoopback: false` ✅, `sandbox.mode: 'non-main'` ✅, `quarantinePeriod: 0` ✅
    - hardened: `requireAuthForLoopback: true` ✅, `sandbox.mode: 'all'` ✅, `quarantinePeriod: 86400_000` ✅, `requireSignature: 'official'` ✅
    - paranoid: `networkPolicy: 'deny'` ✅, `requireAllowlist: true` ✅, `blockCriticalRisks: true` ✅, `blockOnCritical: true` ✅
  - **Missing from presets (handled elsewhere):**
    - `tools.profile` (coding/minimal) - Not in security presets, needs separate config integration
    - `tools.elevated.enabled` - Not in security presets, needs Phase 3 implementation
  - Implementation: `src/config/security-presets.ts`

- [x] **GAP-42** Add `tools.profile` to security presets ✅ (partial - default changed)
  - Design doc: standard='coding', hardened/paranoid='minimal'
  - **Completed**: 2026-01-30 (via 3.3.1)
  - Note: Default profile changed to 'minimal' globally. Security preset integration (standard='coding') deferred to future iteration.

### Technical Debt

- [ ] **DEBT-1** keytar package integration - Would provide unified cross-platform keychain access
  - Current: Using native `security` CLI on macOS
  - Consider: keytar for Windows/Linux support

- [ ] **DEBT-2** Age encryption option - Design doc specifies age, we use AES-256-GCM
  - Current implementation is secure and works
  - Consider: age as optional alternative for interoperability

---

## Phase 1: Foundation (Credential Storage & Security Presets)

### 1.1 SecureCredentialStore Interface

**Dependencies**: None
**Priority**: Critical
**Status**: 75% Complete (Core backends done, mobile backends remaining)

- [x] **1.1.1** Create `src/credentials/secure-store.ts` with interface definition ✅
  - Dependencies: None
  - Interface: Enhanced with `store()`, `retrieve()`, `delete()`, `list()`, `exists()`, `rotate()`
  - Notes: Uses `CredentialResult<T>` for typed error handling, includes metadata tracking
  - **Completed**: 2026-01-30

- [x] **1.1.2** Implement macOS Keychain backend (`secure-store-keychain.ts`) ✅
  - Dependencies: 1.1.1
  - Uses: `security` CLI (native macOS command)
  - **Completed**: 2026-01-30
  - Notes: Uses security CLI instead of keytar; metadata stored in separate JSON file
    - [x] Handle Keychain access errors (returns CredentialResult with error)
    - [x] Unit tests via factory integration tests
  - Technical notes:
    - Uses `security add-generic-password -U` for upsert
    - Uses `security find-generic-password -w` for retrieval
    - Metadata stored separately in `keychain-metadata.json`

- [ ] **1.1.3** Implement iOS Keychain backend (`secure-store-ios.swift`)
  - Dependencies: 1.1.1
  - Uses: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  - Subtasks:
    - [ ] Implement SecItemAdd/SecItemCopyMatching/SecItemDelete
    - [ ] Add biometric protection option (kSecAttrAccessControl)
    - [ ] Test on device and simulator

- [ ] **1.1.4** Implement Android Keystore backend (`SecureStoreAndroid.kt`)
  - Dependencies: 1.1.1
  - Uses: EncryptedSharedPreferences + Android Keystore
  - Subtasks:
    - [ ] Create MasterKey with AES256_GCM
    - [ ] Implement EncryptedSharedPreferences wrapper
    - [ ] Add biometric authentication option
    - [ ] Test on device and emulator

- [ ] **1.1.5** Implement Linux libsecret backend (`secure-store-linux.ts`)
  - Dependencies: 1.1.1
  - Uses: libsecret via secret-service or keytar
  - Notes: Handle missing libsecret gracefully (fallback to encrypted file)

- [ ] **1.1.6** Implement Windows Credential Manager backend (`secure-store-windows.ts`)
  - Dependencies: 1.1.1
  - Uses: Windows Credential Manager via keytar or native
  - Notes: Handle enterprise policies that may block access

- [x] **1.1.7** Implement encrypted file fallback (`secure-store-file.ts`) ✅
  - Dependencies: 1.1.1
  - Uses: AES-256-GCM with scrypt key derivation (enhanced from design doc's age encryption)
  - **Completed**: 2026-01-30
  - Implementation notes:
    - [x] AES-256-GCM encryption with per-credential salt
    - [x] scrypt key derivation (N=16384, r=8, p=1)
    - [x] 0o600 file permissions, 0o700 directory permissions
    - [x] Backup support for credential rotation
  - Remaining (see GAP-11, GAP-12):
    - [ ] User passphrase option (currently uses machine-derived key)
    - [ ] Hardware key (YubiKey) support

- [x] **1.1.8** Create credential store factory with platform detection ✅
  - Dependencies: 1.1.2, 1.1.7
  - **Completed**: 2026-01-30
  - Implementation: `src/credentials/index.ts`
  - Features:
    - [x] Auto-select backend based on platform (macOS → Keychain, others → encrypted file)
    - [x] Fallback chain: Keychain → encrypted file
    - [x] `getAvailableBackends()` for introspection
    - [x] `migrateCredentials()` for moving between stores

### 1.2 Security Level Presets

**Dependencies**: None
**Priority**: High
**Status**: 100% Complete ✅

- [x] **1.2.1** Create `src/config/types.security.ts` with SecurityConfig interface ✅
  - Dependencies: None
  - **Completed**: 2026-01-30
  - Defines: SecurityLevel, CredentialStoreBackend, SecurityConfig (credentials, audit, gateway, sandbox, skills)

- [x] **1.2.2** Implement security presets (`src/config/security-presets.ts`) ✅
  - Dependencies: 1.2.1
  - **Completed**: 2026-01-30
  - Presets: standard, hardened (default), paranoid
  - Includes: `SECURITY_PRESETS`, `DEFAULT_SECURITY_LEVEL`, `validateSecurityConfig()`

- [x] **1.2.3** Add `security.level` to main config schema ✅
  - Dependencies: 1.2.2
  - **Completed**: 2026-01-30
  - Created: `src/config/zod-schema.security.ts`
  - Updated: `src/config/zod-schema.ts` to include SecuritySchema
  - Updated: `src/config/types.ts` to export security types

- [x] **1.2.4** Implement preset application on config load ✅
  - Dependencies: 1.2.3
  - **Completed**: 2026-01-30
  - Function: `resolveSecurityConfig(userConfig)` merges user config with preset defaults
  - Includes: `recommendSecurityLevel(useCase)` for guided configuration

### 1.3 Credential Migration

**Dependencies**: 1.1.8
**Priority**: High

- [x] **1.3.1** Create plaintext credential detector ✅
  - Dependencies: 1.1.8
  - Scan: `~/.clawdbot/credentials/`, `~/.clawdbot/config.json`
  - Identify: API keys, tokens, passwords in plaintext
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit-credentials.ts` - `scanForPlaintextCredentials()`, `PLAINTEXT_CREDENTIAL_PATTERNS`

- [x] **1.3.2** Implement migration wizard CLI (`openclaw credentials migrate`) ✅
  - Dependencies: 1.3.1
  - Show: found credentials, target store
  - Confirm before migration
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/credentials-cli.ts`

- [x] **1.3.3** Implement secure file deletion (overwrite + unlink) ✅
  - Dependencies: 1.3.2
  - Overwrite with random data before unlink
  - Handle filesystem journaling limitations
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/credentials-cli.ts` - `secureDeleteFile()`

- [x] **1.3.4** Add migration to `openclaw security audit --fix` ✅
  - Dependencies: 1.3.2, 1.3.3
  - Auto-migrate if user confirms
  - Report success/failure
  - **Completed**: 2026-01-30
  - Implementation: `src/security/fix.ts` - `performCredentialMigration()`, `migrateCredentialsAutoFix()`
  - Output shown in `src/cli/security-cli.ts` audit action

### 1.4 Security Audit Enhancements

**Dependencies**: 1.1.8, 1.2.2
**Priority**: High

- [x] **1.4.1** Add credential storage audit checks ✅
  - Dependencies: 1.1.8
  - Checks: `credentials.plaintext`, `credentials.keychain_unavailable`, `credentials.plaintext_configured`, `credentials.migration_needed`, `credentials.file_permissions`, `credentials.rotation_due`
  - Report storage type and recommendations
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit-credentials.ts` - `collectCredentialStorageFindings()`

- [x] **1.4.2** Add security level audit checks ✅
  - Dependencies: 1.2.2
  - Check: preset compliance, conflicting settings
  - Warn if security level is 'standard' with sensitive workflows
  - **Completed**: 2026-01-30
  - Implementation: `src/security/audit.ts` - `collectSecurityLevelFindings()`

- [x] **1.4.3** Implement `openclaw security status` command ✅
  - Dependencies: 1.4.1, 1.4.2
  - Summary: security level, credential storage, sandbox mode, etc.
  - Color-coded output (green/yellow/red)
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/security-cli.ts` - `openclaw security status [--json]`

---

## Phase 2: Gateway Hardening

### 2.1 Auto-Token Generation

**Dependencies**: 1.1.8
**Priority**: Critical

- [x] **2.1.1** Implement secure token generator ✅
  - Dependencies: None
  - Use: crypto.randomBytes(32)
  - Output: base64url encoded
  - **Completed**: 2026-01-30
  - Implementation: `src/gateway/token.ts` - `generateSecureToken()`, `generateAndValidateToken()`
  - Tests: 29 tests in `src/gateway/token.test.ts`

- [x] **2.1.2** Auto-generate token on first `openclaw onboard` ✅
  - Dependencies: 2.1.1, 1.1.8
  - Store in keychain
  - Display token once for user to save
  - **Completed**: 2026-01-30
  - Implementation:
    - `src/commands/onboard-helpers.ts` - `GATEWAY_TOKEN_CREDENTIAL_KEY`, `storeGatewayTokenInKeychain()`, `retrieveGatewayTokenFromKeychain()`
    - `src/wizard/onboarding.gateway-config.ts` - Stores token in keychain during onboarding
    - `src/wizard/onboarding.ts` - Shows keychain storage status to user
  - Tests: 7 tests in `src/commands/onboard-helpers.gateway-token.test.ts`

- [x] **2.1.3** Add token entropy validation ✅
  - Dependencies: 2.1.1
  - Reject tokens < 32 chars
  - Warn on low entropy (repeated chars, common patterns)
  - **Completed**: 2026-01-30
  - Implementation: `src/gateway/token.ts` - `validateToken()`, `calculateEntropy()`, `detectWeakPatterns()`

### 2.2 Loopback Authentication

**Dependencies**: 2.1.2
**Priority**: Critical

- [x] **2.2.1** Add `gateway.auth.requireAuthForLoopback` config option ✅
  - Dependencies: None
  - Default: true for 'hardened' preset
  - **Completed**: 2026-01-30
  - Implementation:
    - `src/config/types.gateway.ts` - Added `requireAuthForLoopback?: boolean` to `GatewayAuthConfig`
    - `src/config/zod-schema.ts` - Added Zod validation for the field
    - `src/config/security-presets.ts` - Already had correct defaults (standard=false, hardened/paranoid=true)

- [x] **2.2.2** Implement loopback auth enforcement in gateway server ✅
  - Dependencies: 2.2.1
  - Require token even for 127.0.0.1 connections
  - Defense against localhost proxy bypass
  - **Completed**: 2026-01-30
  - Implementation:
    - `src/gateway/auth.ts` - Added `requireAuthForLoopback` parameter to `authorizeGatewayConnect()`
    - `src/gateway/server/ws-connection/message-handler.ts` - Passes config value to auth function
    - Defaults to `true` (secure by default), respects config setting
  - Tests: 5 new tests in `src/gateway/auth.test.ts`

- [x] **2.2.3** Add `--i-know-what-im-doing` flag for insecure overrides ✅
  - Dependencies: 2.2.2
  - Required for: non-loopback bind, disabled auth
  - Log warning when used
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/gateway-cli/run.ts` - Added `--i-know-what-im-doing` flag
  - Logs security warnings when flag is used

- [x] **2.2.4** Block startup on insecure config without override flag ✅
  - Dependencies: 2.2.3
  - Clear error message explaining the risk
  - Point to documentation
  - **Completed**: 2026-01-30
  - Implementation: `src/cli/gateway-cli/run.ts` - Updated error message to suggest the flag
  - Note: This was already partially implemented (line 245-257), enhanced with override flag support

### 2.3 Native App Authentication

**Dependencies**: 2.1.2, 1.1.2, 1.1.3, 1.1.4
**Priority**: High

- [ ] **2.3.1** Update macOS app to read token from Keychain
  - Dependencies: 2.1.2, 1.1.2
  - Auto-authenticate WebSocket connections
  - Handle missing token (prompt onboarding)

- [ ] **2.3.2** Update iOS app to read token from Keychain
  - Dependencies: 2.1.2, 1.1.3
  - Auto-authenticate gateway connections
  - Handle Keychain access denied

- [ ] **2.3.3** Update Android app to read token from Keystore
  - Dependencies: 2.1.2, 1.1.4
  - Auto-authenticate gateway connections
  - Handle biometric prompt if configured

- [ ] **2.3.4** Add gateway auth tests for native apps
  - Dependencies: 2.3.1, 2.3.2, 2.3.3
  - Test: valid token, invalid token, missing token
  - E2E test on each platform

---

## Phase 3: Sandboxed Execution by Default

### 3.1 Sandbox Mode Changes

**Dependencies**: None
**Priority**: Critical

- [x] **3.1.1** Change default `sandbox.mode` from 'off' to 'all' ✅
  - Dependencies: None
  - Update: src/agents/sandbox/config.ts, Zod schemas
  - Migration: preserve existing user settings
  - **Completed**: 2026-01-30
  - Implementation: Changed default in `resolveSandboxConfigForAgent()` from "off" to "all", updated Zod schema defaults

- [x] **3.1.2** Change default `sandbox.scope` from 'session' to 'agent' ✅
  - Dependencies: None
  - More isolation per agent
  - Document behavior change
  - **Completed**: 2026-01-30
  - Implementation: `resolveSandboxScope()` in `src/agents/sandbox/config.ts:34` already returns "agent" as default
  - Tests: `sandbox-merge.test.ts:7` verifies `resolveSandboxScope({})` returns "agent"

- [x] **3.1.3** Implement resource limits config ✅
  - Dependencies: None
  - Config: memory (2g), cpus (1), timeout (300s)
  - Apply to container/sandbox creation
  - **Completed**: 2026-01-30
  - Implementation:
    - Added defaults in `src/agents/sandbox/constants.ts`: `DEFAULT_SANDBOX_MEMORY="2g"`, `DEFAULT_SANDBOX_CPUS=1`, `DEFAULT_SANDBOX_TIMEOUT_MS=300000`
    - Updated `SandboxDockerConfig` type in `src/agents/sandbox/types.docker.ts` with `timeout` field
    - Applied defaults in `resolveSandboxDockerConfig()` in `src/agents/sandbox/config.ts`
    - Updated Zod schema in `src/config/zod-schema.agent-runtime.ts`
    - Updated settings type in `src/config/types.sandbox.ts`

### 3.2 Network Policy

**Dependencies**: 3.1.1
**Priority**: High

- [ ] **3.2.1** Implement network allowlist for sandbox
  - Dependencies: 3.1.1
  - Default allowlist: api.anthropic.com, api.openai.com, *.bedrock.*.amazonaws.com
  - Block all other outbound by default

- [ ] **3.2.2** Add `sandbox.network.defaultPolicy` config
  - Dependencies: 3.2.1
  - Options: 'allow', 'deny'
  - Default: 'deny' for 'paranoid' preset

- [ ] **3.2.3** Implement DNS-based allowlist enforcement
  - Dependencies: 3.2.1
  - Resolve allowlist domains at sandbox creation
  - Block connections to non-allowlisted IPs

### 3.3 Dangerous Tools Opt-In

**Dependencies**: None
**Priority**: High

- [x] **3.3.1** Change default `tools.profile` from 'coding' to 'minimal' ✅
  - Dependencies: None
  - 'minimal' = session_status only
  - Users opt-in to more capabilities
  - **Completed**: 2026-01-30
  - Implementation:
    - Added `.default("minimal")` to ToolProfileSchema in `src/config/zod-schema.agent-runtime.ts`
    - Updated runtime fallback in `resolveEffectiveToolPolicy()` in `src/agents/pi-tools.policy.ts`
    - Updated type comments in `src/config/types.tools.ts`

- [x] **3.3.2** Implement `tools.dangerousTools` config ✅
  - Dependencies: None
  - Tools: browser, canvas, cron, exec
  - Each has: enabled (default false), requireApproval (default true)
  - **Completed**: 2026-01-30
  - Implementation:
    - Added `DangerousToolConfig` and `DangerousToolsConfig` types in `src/config/types.tools.ts`
    - Added `DangerousToolsSchema` Zod schema in `src/config/zod-schema.agent-runtime.ts`
    - Added `dangerousTools` field to `ToolsConfig` type and `ToolsSchema`

- [ ] **3.3.3** Implement approval flow for dangerous tool invocation
  - Dependencies: 3.3.2
  - Prompt user before first use
  - Option to remember approval per session/permanently

- [x] **3.3.4** Add audit check for dangerous tools enabled without approval ✅
  - Dependencies: 3.3.2
  - Severity: warn (enabled), critical (enabled without approval)
  - Recommend enabling requireApproval
  - **Completed**: 2026-01-30
  - Implementation: Updated `collectDangerousToolsFindings()` in `src/security/audit.ts`
    - Checks `tools.dangerousTools.<tool>.enabled` and `requireApproval`
    - Critical severity if enabled without approval
    - Warn severity if enabled with approval

### 3.4 Platform Sandbox Implementations

**Dependencies**: 3.1.1, 3.2.1
**Priority**: High

- [ ] **3.4.1** Implement macOS XPC sandbox service
  - Dependencies: 3.1.1
  - Separate process with tighter sandbox
  - XPC protocol for tool execution
  - Subtasks:
    - [ ] Create XPC service target in Xcode
    - [ ] Define XPC protocol interface
    - [ ] Implement sandbox entitlements
    - [ ] Test isolation

- [ ] **3.4.2** Implement Android isolated process sandbox
  - Dependencies: 3.1.1
  - Use: android:isolatedProcess="true"
  - Communicate via bound service
  - Subtasks:
    - [ ] Create SandboxService in AndroidManifest
    - [ ] Implement IPC protocol
    - [ ] Test process isolation

- [ ] **3.4.3** Verify Docker sandbox hardening
  - Dependencies: 3.1.1, 3.2.1
  - Flags: --read-only, --cap-drop=ALL, --security-opt=no-new-privileges
  - Test: container cannot escape

- [ ] **3.4.4** Implement Bubblewrap fallback for Linux without Docker
  - Dependencies: 3.1.1
  - Use: bwrap with restricted namespaces
  - Fallback if Docker unavailable

---

## Phase 4: Skill Vetting

### 4.1 Vetting Engine

**Dependencies**: None
**Priority**: High

- [ ] **4.1.1** Create `src/skills/vetting.ts` with SkillVettingResult interface
  - Dependencies: None
  - Fields: safe, risks[], requiredPermissions[], networkAccess[], fileAccess[]

- [ ] **4.1.2** Implement shell command pattern detection
  - Dependencies: 4.1.1
  - Patterns: curl|sh, wget, nc, bash -c, eval, etc.
  - Severity: critical

- [ ] **4.1.3** Implement filesystem access analysis
  - Dependencies: 4.1.1
  - Detect: access outside workspace, ~/.ssh, ~/.aws, etc.
  - Severity: high

- [ ] **4.1.4** Implement network connection analysis
  - Dependencies: 4.1.1
  - Detect: connections to non-allowlisted domains
  - Extract domain list from skill code

- [ ] **4.1.5** Implement obfuscation detection
  - Dependencies: 4.1.1
  - Patterns: base64 encoded commands, hex strings, minified code
  - Severity: warn

- [ ] **4.1.6** Integrate Cisco Skill Scanner signatures
  - Dependencies: 4.1.1
  - Load signatures from database
  - Match known malicious patterns

### 4.2 Skill Installation Security

**Dependencies**: 4.1.6
**Priority**: High

- [ ] **4.2.1** Add `skills.requireAllowlist` config
  - Dependencies: None
  - Default: true for 'hardened' preset
  - Block install if skill not in allowlist

- [ ] **4.2.2** Implement detailed permission prompt
  - Dependencies: 4.1.6
  - Show: required permissions, network access, file access, risks
  - User must confirm before install

- [ ] **4.2.3** Implement skill quarantine
  - Dependencies: 4.1.6
  - Config: quarantinePeriod (default 24h)
  - Skill active but marked as quarantined
  - Alert user when quarantine ends

- [ ] **4.2.4** Implement signature verification for official skills
  - Dependencies: None
  - Config: requireSignature ('official', 'any', 'none')
  - Verify GPG signature against OpenClaw public key

### 4.3 Skill Audit

**Dependencies**: 4.2.3
**Priority**: Medium

- [ ] **4.3.1** Add `skills.unvetted` audit check
  - Dependencies: 4.1.6
  - Scan installed skills
  - Report any not vetted

- [ ] **4.3.2** Add `skills.quarantined` audit info
  - Dependencies: 4.2.3
  - List skills in quarantine
  - Show time remaining

- [ ] **4.3.3** Implement `openclaw skills audit` command
  - Dependencies: 4.3.1, 4.3.2
  - Vet all installed skills
  - Report risks and recommendations

---

## Phase 5: Workflow Security Profiles

### 5.1 Workflow Profile System

**Dependencies**: 1.2.2
**Priority**: High

- [ ] **5.1.1** Create `src/workflows/profile.ts` with WorkflowProfile interface
  - Dependencies: None
  - Fields: id, filesystem, oauth, api, contentSecurity, schedule, etc.

- [ ] **5.1.2** Implement `openclaw workflow create <profile>` command
  - Dependencies: 5.1.1
  - Load profile definition
  - Configure workflow with security settings

- [ ] **5.1.3** Implement `openclaw workflow list` command
  - Dependencies: 5.1.2
  - Show active workflows
  - Display security zone, status

- [ ] **5.1.4** Implement `openclaw workflow stop <id>` command
  - Dependencies: 5.1.2
  - Graceful shutdown
  - `--emergency` flag for immediate halt

### 5.2 Second Brain Workflow

**Dependencies**: 5.1.2
**Priority**: High

- [ ] **5.2.1** Implement SECOND_BRAIN_PROFILE configuration
  - Dependencies: 5.1.1
  - Scoped filesystem access
  - Anytype MCP settings

- [ ] **5.2.2** Implement Anytype MCP integration
  - Dependencies: 5.2.1
  - Endpoint: localhost:31009
  - API key from keychain
  - Rate limiting

- [ ] **5.2.3** Implement GitHub collaboration security
  - Dependencies: 5.2.1
  - Signed commits required
  - Malicious pattern scanning
  - Trusted collaborator list

- [ ] **5.2.4** Implement ctx namespace isolation
  - Dependencies: 5.2.1
  - Prefix: 'local:' vs 'shared:'
  - Prevent cross-contamination

### 5.3 Twitter Intelligence Workflow

**Dependencies**: 5.1.2
**Priority**: Medium

- [ ] **5.3.1** Implement TWITTER_INTELLIGENCE_PROFILE configuration
  - Dependencies: 5.1.1
  - Read-only OAuth scopes
  - API endpoint allowlist

- [ ] **5.3.2** Implement Twitter OAuth integration
  - Dependencies: 5.3.1, 1.1.8
  - Store tokens in keychain
  - Auto-refresh

- [ ] **5.3.3** Implement content quarantine for tweets
  - Dependencies: 5.3.1
  - Injection pattern detection
  - Suspicious content flagging

- [ ] **5.3.4** Implement tweet sanitization
  - Dependencies: 5.3.3
  - Strip injection patterns
  - Escape markdown
  - Max content length

### 5.4 Email Assistant Workflow

**Dependencies**: 5.1.2
**Priority**: Medium

- [ ] **5.4.1** Implement EMAIL_ASSISTANT_PROFILE configuration
  - Dependencies: 5.1.1
  - Gmail readonly + compose scopes (NO send)
  - PII redaction settings

- [ ] **5.4.2** Implement Gmail OAuth integration
  - Dependencies: 5.4.1, 1.1.8
  - Store tokens in keychain
  - Scope validation (reject if send scope requested)

- [ ] **5.4.3** Implement PII detection and redaction
  - Dependencies: 5.4.1
  - Patterns: SSN, credit card, phone
  - Redact in logs and summaries

- [ ] **5.4.4** Implement phishing detection
  - Dependencies: 5.4.1
  - Suspicious sender flagging
  - Pattern matching for phishing

- [ ] **5.4.5** Implement draft generation with disclaimer
  - Dependencies: 5.4.1
  - Add disclaimer to all drafts
  - Never auto-send (verify scope)

### 5.5 Autonomous Dev Workflow

**Dependencies**: 5.1.2
**Priority**: High

- [ ] **5.5.1** Implement AUTONOMOUS_DEV_PROFILE configuration
  - Dependencies: 5.1.1
  - Project scoping
  - HEARTBEAT settings
  - WBS integration

- [ ] **5.5.2** Implement design doc discovery
  - Dependencies: 5.5.1
  - Pattern matching for design docs
  - Status detection (implemented vs not)

- [ ] **5.5.3** Implement HEARTBEAT permission model
  - Dependencies: 5.5.1
  - Autonomous: create_todo, update_todo, run_tests, etc.
  - Requires approval: delete_files, git_commit, git_push

- [ ] **5.5.4** Implement gap analysis validation
  - Dependencies: 5.5.1
  - Design doc alignment check
  - Deficiency detection
  - Error analysis

- [ ] **5.5.5** Implement iteration limits and runaway detection
  - Dependencies: 5.5.1
  - Max iterations: 50
  - Max duration per cycle: 15 minutes
  - Pause and alert on critical error

### 5.6 Voice TTS Workflow

**Dependencies**: 5.1.2
**Priority**: Low

- [ ] **5.6.1** Implement VOICE_TTS_PROFILE configuration
  - Dependencies: 5.1.1
  - Local model only
  - No network access

- [ ] **5.6.2** Implement Qwen3-TTS model loader
  - Dependencies: 5.6.1
  - Model path: ~/.openclaw/models/qwen3-tts-1.7b
  - Checksum verification

- [ ] **5.6.3** Implement content redaction before TTS
  - Dependencies: 5.6.1
  - Redact: API keys, passwords, credit cards, SSN
  - Replace with "sensitive information redacted"

- [ ] **5.6.4** Implement audio cleanup
  - Dependencies: 5.6.1
  - Temp dir: /tmp/openclaw-tts
  - Auto-cleanup after 5 minutes

### 5.7 Trading Agent Workflow

**Dependencies**: 5.1.2
**Priority**: Critical (due to financial risk)

- [ ] **5.7.1** Implement TRADING_AGENT_PROFILE configuration
  - Dependencies: 5.1.1
  - Security level: paranoid
  - Paper trading default: TRUE

- [ ] **5.7.2** Implement broker API integration (Alpaca)
  - Dependencies: 5.7.1, 1.1.8
  - API keys in keychain
  - Paper trading mode by default

- [ ] **5.7.3** Implement mandatory trade approval flow
  - Dependencies: 5.7.1
  - ALL trades require human approval
  - Show: symbol, amount, risk %, confidence, stop loss
  - No timeout (never auto-approve)

- [ ] **5.7.4** Implement risk management
  - Dependencies: 5.7.1
  - Stop loss on all positions
  - Daily loss limit
  - Drawdown protection

- [ ] **5.7.5** Implement trading audit trail
  - Dependencies: 5.7.1
  - Log: timestamp, action, symbol, amount, price, reasoning, approval, result
  - Retain for 365 days

- [ ] **5.7.6** Implement workflow isolation
  - Dependencies: 5.7.1
  - Dedicated sandbox
  - Separate credential namespace
  - No cross-workflow data access

### 5.8 Idea Pipeline Workflow

**Dependencies**: 5.1.2, 5.5.1
**Priority**: Medium

- [ ] **5.8.1** Implement IDEA_PIPELINE_PROFILE configuration
  - Dependencies: 5.1.1
  - Pattern chain settings
  - Seed management
  - Safety boundaries

- [ ] **5.8.2** Implement OBSERVE phase
  - Dependencies: 5.8.1
  - Source aggregation from workflows
  - Weight-based prioritization

- [ ] **5.8.3** Implement CONNECT phase
  - Dependencies: 5.8.2
  - Pattern detection
  - Connection type classification

- [ ] **5.8.4** Implement DEVELOP phase
  - Dependencies: 5.8.3
  - Autonomous: create_seed, expand_seed, etc.
  - Requires approval: promote_to_insight, create_project

- [ ] **5.8.5** Implement seed maturity tracking
  - Dependencies: 5.8.4
  - Levels: planted, sprouting, growing, mature
  - Promotion criteria with human review gate

- [ ] **5.8.6** Implement runaway detection
  - Dependencies: 5.8.1
  - Max concurrent seeds: 5
  - Max dev iterations: 100
  - No progress threshold: 10 cycles

---

## Phase 6: Multi-Model Routing

### 6.1 Model Routing Configuration

**Dependencies**: None
**Priority**: Medium

- [ ] **6.1.1** Create MODEL_ROUTING_CONFIG schema
  - Dependencies: None
  - Fields: default, routes (per workflow), fallback chain

- [ ] **6.1.2** Implement per-workflow model assignment
  - Dependencies: 6.1.1
  - Route: second-brain → Claude Opus, twitter → Claude Sonnet, etc.
  - Trading: Grok for analysis, Claude for quant

- [ ] **6.1.3** Implement model fallback chain
  - Dependencies: 6.1.2
  - If primary fails, try fallback
  - Log fallback usage

### 6.2 Cost Management

**Dependencies**: 6.1.2
**Priority**: Medium

- [ ] **6.2.1** Implement per-workflow cost tracking
  - Dependencies: 6.1.2
  - Track tokens used per workflow
  - Calculate cost based on model pricing

- [ ] **6.2.2** Implement daily budget per workflow
  - Dependencies: 6.2.1
  - Config: dailyBudgets per workflow
  - Default budgets in MODEL_ROUTING_CONFIG

- [ ] **6.2.3** Implement budget alerts
  - Dependencies: 6.2.2
  - Alert at threshold (80% default)
  - Notify user via preferred channel

- [ ] **6.2.4** Implement hard stop on budget exceeded
  - Dependencies: 6.2.2
  - Config: hardStop (default true)
  - Pause workflow, notify user

### 6.3 Local Model Support

**Dependencies**: 5.6.2
**Priority**: Low

- [ ] **6.3.1** Implement local model loader interface
  - Dependencies: None
  - Support: Qwen3-TTS, Ollama, llama.cpp

- [ ] **6.3.2** Implement model checksum verification
  - Dependencies: 6.3.1
  - Verify SHA256 on first load
  - Warn on mismatch

- [ ] **6.3.3** Implement offline model execution
  - Dependencies: 6.3.1
  - No network required
  - Cache model in memory

---

## Phase 7: Collaboration Security

### 7.1 Signed Commit Verification

**Dependencies**: 5.2.3
**Priority**: High

- [ ] **7.1.1** Implement GPG signature verification for commits
  - Dependencies: None
  - Verify signature against known public keys
  - Reject unsigned commits from shared repos

- [ ] **7.1.2** Implement collaborator public key management
  - Dependencies: 7.1.1
  - Store trusted keys
  - Add/remove collaborator keys

- [ ] **7.1.3** Implement commit signing for OpenClaw-generated commits
  - Dependencies: 7.1.1
  - Sign all commits from local OpenClaw
  - Use dedicated GPG key

### 7.2 Malicious Pattern Detection

**Dependencies**: 5.2.3
**Priority**: High

- [ ] **7.2.1** Implement commit content scanner
  - Dependencies: None
  - Patterns: rm -rf, curl|sh, eval(), etc.
  - Scan diff before apply

- [ ] **7.2.2** Implement quarantine for suspicious commits
  - Dependencies: 7.2.1
  - Don't apply commit
  - Alert user for review

- [ ] **7.2.3** Implement auto-reject for critical patterns
  - Dependencies: 7.2.2
  - Config: rejectPatterns
  - Log rejection reason

### 7.3 ctx Namespace Isolation

**Dependencies**: 5.2.4
**Priority**: Medium

- [ ] **7.3.1** Implement namespace prefix system
  - Dependencies: None
  - Prefixes: 'local:', 'shared:', 'workflow:'
  - Apply prefix on entry creation

- [ ] **7.3.2** Implement namespace filtering in ctx search
  - Dependencies: 7.3.1
  - Filter by namespace
  - Prevent cross-namespace contamination

- [ ] **7.3.3** Implement namespace-aware ctx merge for shared repos
  - Dependencies: 7.3.1
  - Merge shared: entries from collaborators
  - Keep local: entries isolated

---

## Phase 8: Documentation & Migration

### 8.1 Documentation Updates

**Dependencies**: All previous phases
**Priority**: High

- [ ] **8.1.1** Update security documentation at docs.molt.bot/security
  - Dependencies: Phase 1-4
  - Cover: credential storage, gateway auth, sandbox, skill vetting

- [ ] **8.1.2** Create workflow security guide
  - Dependencies: Phase 5
  - Cover: each workflow's security model
  - Include onboarding checklist

- [ ] **8.1.3** Create migration guide for existing users
  - Dependencies: Phase 1-4
  - Step-by-step migration instructions
  - Rollback procedures

- [ ] **8.1.4** Publish security whitepaper
  - Dependencies: All phases
  - Threat model
  - Defense in depth architecture
  - Compliance mapping

### 8.2 CLI Enhancements

**Dependencies**: Phase 1-5
**Priority**: Medium
**Status**: 100% Complete ✅

- [x] **8.2.1** Implement `openclaw security configure` wizard ✅
  - Dependencies: 1.2.2, 2.2.1, 3.1.1
  - **Completed**: 2026-02-02
  - Interactive security setup with use case recommendations
  - Supports --non-interactive for automated setup
  - Customizable gateway, sandbox, and audit settings

- [x] **8.2.2** Implement `openclaw security report` command ✅
  - Dependencies: 1.4.3
  - **Completed**: 2026-02-02
  - Export security report in JSON or HTML format
  - Includes full audit, credential status, configuration, findings
  - Output to file or stdout

- [x] **8.2.3** Implement `openclaw security test` command ✅
  - Dependencies: Phase 3, 4
  - **Completed**: 2026-02-02
  - Scenarios: prompt-injection, credential-exfil, skill-malware
  - Verifies security defenses are properly configured
  - Verbose mode for detailed output

### 8.3 Emergency Procedures

**Dependencies**: Phase 5
**Priority**: High

- [ ] **8.3.1** Document trading agent emergency stop procedure
  - Dependencies: 5.7.4
  - Commands for immediate halt
  - Credential revocation steps

- [ ] **8.3.2** Document autonomous dev runaway recovery
  - Dependencies: 5.5.5
  - Stop command
  - Git revert instructions

- [ ] **8.3.3** Document idea pipeline reset procedure
  - Dependencies: 5.8.6
  - Pause workflow
  - Archive suspicious content
  - Clear contaminated ctx entries

---

## Notes

### Assumptions

- Users have platform-specific keychain/credential manager available
- Docker is available for CLI sandbox (fallback to bubblewrap on Linux)
- Network connectivity for AI API calls (except local model workflows)
- Git installed for collaboration features

### Risks

| Risk | Mitigation |
|------|------------|
| Keychain unavailable on headless servers | Encrypted file fallback with env passphrase |
| Docker not installed | Bubblewrap fallback, clear error message |
| Trading workflow misuse | Paper trading default, mandatory approval, audit trail |
| Runaway autonomous workflows | Iteration limits, timeout, pause on no progress |

### Out of Scope

- Enterprise SSO/SAML integration (separate feature)
- Real-time multi-user collaboration (async only)
- Protection against compromised host OS
- Complete prompt injection prevention (fundamentally unsolvable)

### Critical Security Notes

1. **Trading workflow**: Paper trading is DEFAULT. Live trading requires explicit opt-in AND understanding of risks.
2. **Email workflow**: NO auto-send capability. Drafts only.
3. **Skill installation**: Quarantine period AND human approval for any skill with risks.
4. **Credential storage**: NEVER store plaintext on disk after migration.

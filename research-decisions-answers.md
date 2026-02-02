# OpenClaw Security Hardening - Research Decisions Answers

**Generated**: 2026-01-30
**Source**: Deep Research via GPT-5.2 and Perplexity (Anytype)

This document provides the recommended answers for all open questions in `deep-research-decisions.md` based on comprehensive research across 100+ authoritative sources.

---

## Phase 2.3: Native App Authentication

### Decision 2.3.1: macOS App – Missing Token Handling
**Recommendation**: **(A) Automatically launch the onboarding wizard**

- Auto-launch onboarding when no gateway token found
- Falls back to guided setup for smooth first-time experience
- In multi-user Mac scenarios, each user gets their own token in their Keychain
- If Keychain entry is corrupted, prompt re-onboarding with clear instructions

**Implementation Notes**:
- Detect token absence at app startup
- Invoke existing onboarding workflow programmatically
- Handle edge cases: no internet, Keychain access errors
- Log events for security auditing

### Decision 2.3.2: iOS App – Biometric Protection for Keychain
**Recommendation**: **(B) Optional, user-configurable** combined with **(C) Required for "Paranoid" preset**

- Default: Enable Face ID/Touch ID protection when using higher security presets
- Allow user to disable for convenience in standard mode
- Store token with `kSecAccessControlUserPresence` or `.biometryCurrentSet`
- Always provide passcode fallback via LocalAuthentication

**Implementation Notes**:
- Use `LAContext` for biometric evaluation
- Cache token in memory after successful Face ID to avoid multiple prompts per session
- Handle biometric invalidation (new Face ID enrolled)

### Decision 2.3.3: Android App – Keystore Biometric Requirements
**Recommendation**: **(B) Use `setUserAuthenticationRequired(true)` with timeout**

- For high-security mode: timeout = -1 (require biometric every time)
- For standard mode: timeout = 30 seconds (grace period)
- Fall back to device credential (PIN/pattern) if biometric unavailable
- Use BiometricPrompt API for consistent UX

**Implementation Notes**:
- Use `KeyGenParameterSpec.Builder` with authentication flags
- Set `setInvalidatedByBiometricEnrollment(true)` for security
- Attempt to use StrongBox if available (`setIsStrongBoxBacked(true)`)

### Decision 2.3.4: Native App E2E Test Coverage
**Recommendation**: **(B) Integration tests on simulators/emulators** + **(D) Manual QA checklist**

- Automated integration tests on simulators covering:
  - Missing token triggers onboarding
  - Valid token stores in Keychain
  - Biometric prompt shown when enabled
- Manual QA on real devices before releases
- Use Firebase Test Lab or similar for periodic hardware tests

---

## Phase 3.2: Network Policy for Sandboxed Execution

### Decision 3.2.1: Default Network Allowlist
**Recommendation**: Conservative allowlist of known AI API domains only

**Default Allowlist**:
```
api.anthropic.com
api.openai.com
*.bedrock.*.amazonaws.com
api.cohere.ai
api.ai21.com
generativelanguage.googleapis.com
aiplatform.googleapis.com
api-inference.huggingface.co
api.mistral.ai
api.stability.ai
```

**NOT Included by Default**:
- Package registries (npm, pypi) - require explicit approval
- Code hosting (GitHub, GitLab) - require explicit approval
- General CDNs

### Decision 3.2.2: Default Network Policy Behavior
**Recommendation**: **(B) Deny** combined with **(C) Prompt for each new destination**

- Block all non-allowlisted destinations by default
- Immediately prompt user when unlisted domain accessed
- User can choose "Allow once" or "Always allow"
- Log all denied and allowed requests for audit

### Decision 3.2.3: DNS-Based Allowlist Enforcement
**Recommendation**: **(B) DNS interception/proxy** combined with **(C) eBPF filter**

- Run local DNS resolver inside sandbox that only resolves allowlisted domains
- Return NXDOMAIN for non-allowlisted domains
- Use eBPF or firewall rules as backup to catch direct IP connections
- Block all private IP ranges by default (prevent internal scanning)

---

## Phase 3.3: Dangerous Tool Approval Flow

### Decision 3.3.3a: Approval Prompt Location
**Recommendation**: **(E) All of the above, configurable**

- Primary: Chat/messaging channel where conversation originated
- Secondary: Desktop notification (macOS/Windows/Linux)
- Tertiary: Push notification for mobile
- Dedicated approval UI in native apps for detailed context

### Decision 3.3.3b: Approval Memory/Persistence
**Recommendation**: **(E) User-selectable at approval time**

Offer options:
- "Allow once" (per-invocation only)
- "Always allow" (permanent for this agent/tool combination)

Store approvals in secure config tied to agent ID + tool type.

### Decision 3.3.3c: Approval Timeout Behavior
**Recommendation**: **(A) Auto-deny after X seconds** (default 30 seconds)

- If user doesn't respond in 30 seconds, deny the request
- Agent should handle denial gracefully (error or skip step)
- Never auto-approve (C) - too dangerous
- Allow timeout to be configurable in settings

### Decision 3.3.3d: Dangerous Tool Classification
**Recommendation**: Expand current list

**Require Approval**:
- `browser` - web automation
- `canvas` - image generation
- `cron` - scheduled tasks
- `exec` - shell command execution
- `file_write` outside workspace - dangerous file modification
- `git push` - affects remote repositories
- Non-allowlisted network requests

**Tool Composition**: Ensure approval still triggers regardless of who calls the tool.

---

## Phase 3.4: Platform-Specific Sandboxing

### Decision 3.4.1: macOS XPC Sandbox Architecture
**Recommendation**: **(A) Separate helper binary bundled with app**

- Create XPC service in app bundle (Contents/XPCServices)
- Give XPC service tight entitlements (minimal network, file access)
- Use `NSXPCConnection` with `NSSecureCoding` for IPC
- Main app handles approval prompts, then calls XPC to execute

### Decision 3.4.2: Android Isolated Process Architecture
**Recommendation**: **(A) `android:isolatedProcess="true"` service**

- Service runs with separate UID, no permissions by default
- Communicate via AIDL interface
- Use signature-level permission for binding security
- Handle lifecycle: bind when needed, unbind after workflow

### Decision 3.4.3: Docker Sandbox Security Flags
**Mandatory Flags**:
```bash
--read-only
--cap-drop=ALL
--security-opt=no-new-privileges
--network=none  # or restricted network
--memory=2g
--cpus=1
--pids-limit=100
--tmpfs /tmp
--user 1000:1000  # non-root
```

**Additional Recommendations**:
- Keep default seccomp profile (or use stricter custom)
- Use AppArmor default profile
- Mount only specific workspace directory
- Use `--rm` for ephemeral containers

### Decision 3.4.4: Bubblewrap Fallback Strategy
**Recommendation**: **(A) Auto-detect and fallback silently**

- If Docker unavailable, attempt bubblewrap automatically
- Log message indicating bwrap is being used
- If bwrap fails (no userns), warn user to install Docker or enable userns
- Bwrap fallback = offline tasks only (no network egress)

---

## Phase 4: Skill Vetting Engine

### Decision 4.1.1: Vetting Result Risk Levels
**Recommendation**: **(C) Five-tier: critical/high/medium/low/info**

Maps to installation behavior:
- Critical: Block installation
- High: Block unless manually approved
- Medium: Warn, require confirmation
- Low: Inform user
- Info: Log only

### Decision 4.1.2-4.1.5: Detection Patterns and Severity

| Pattern | Action |
|---------|--------|
| Shell execution (`curl\|sh`, `wget\|bash`, `eval()`) | **Critical - Auto-block** |
| Sensitive file access (`~/.ssh/*`, `~/.aws/*`) | **High - Block/Warn** |
| Obfuscated code (base64 decode + eval) | **High - Warn** |
| Non-allowlisted network connections | **Medium - Prompt** |
| Privilege escalation (`sudo`, `doas`) | **Critical - Auto-block** |
| Crypto operations | **Low - Info** |

### Decision 4.1.6: Cisco Skill Scanner Integration
**Recommendation**: **(B) Yes, as supplementary to our patterns**

- Use as additional detection layer, not primary
- Consider privacy implications of sending code to external service
- Also integrate open-source alternatives (YARA, Semgrep)

### Decision 4.2.1: Skill Allowlist Source
**Recommendation**: **(C) Both official registry and user-defined**

- Official OpenClaw registry as default trusted source
- User can add custom allowlist entries
- Enterprise can define organization-wide allowlists

### Decision 4.2.3: Skill Quarantine Implementation
**Parameters**:
- Default quarantine period: **24 hours** (configurable)
- During quarantine: Restricted network, limited file access
- Notification at quarantine end via preferred channel
- Admin can bypass quarantine with explicit flag

### Decision 4.2.4: Skill Signature Verification
**Recommendation**: **(B) Sigstore/cosign with transparency log**

- Modern, auditable, key rotation friendly
- Fallback to GPG for offline verification
- Require signatures for "official" skills by default

---

## Phase 5: Workflow Security Profiles

### Second Brain Workflow (5.2)
- **Anytype MCP**: Endpoint `localhost:31009`, API key in Keychain, 100 req/min rate limit
- **GitHub Security**: Require GPG or SSH signing, per-repo collaborator lists
- **Context Namespace**: Prefixes `local:`, `shared:`, `workflow:`

### Twitter Intelligence Workflow (5.3)
- **OAuth Scopes**: Read-only by default, write only for bookmarks/lists if needed
- **Content Quarantine**: Detect `[INST]`, `<system>`, similar injection patterns; flag for review
- **Tweet Sanitization**: Max 1000 chars, escape markdown, expand short URLs

### Email Assistant Workflow (5.4)
- **Gmail Scopes**: `gmail.readonly` + `gmail.compose` only (NO `gmail.send`)
- **PII Patterns**: SSN, credit card, phone, email addresses; redact as `[REDACTED:type]`
- **Phishing Detection**: Heuristics + optional external reputation service
- **Draft Disclaimer**: "This draft was generated by AI. Please review before sending."

### Autonomous Dev Workflow (5.5)
- **HEARTBEAT Permissions**:
  - Auto-approved: `create_todo`, `update_todo`, `run_tests`, `read_file`
  - Require approval: `delete_files`, `git_commit`, `git_push`, `modify_outside_project`
- **Iteration Limits**: Max 50 iterations, 15 min per cycle, pause on critical error

### Voice TTS Workflow (5.6)
- **Model Path**: `~/.openclaw/models/qwen3-tts-1.7b`
- **Checksum**: SHA256 verification on first load
- **Redaction**: Replace sensitive content with "sensitive information redacted"
- **Audio Cleanup**: 5-minute retention in `/tmp/openclaw-tts`, secure deletion

### Trading Agent Workflow (5.7) - CRITICAL
- **Paper Trading**: DEFAULT and MANDATORY for first 30 days
- **Live Trading Unlock**: Require explicit toggle + confirmation + understanding acknowledgment
- **Trade Approval**: ALL trades require human approval, no timeout (never auto-approve)
- **Risk Management**: 5% daily loss limit, 2% per-trade max, mandatory stop loss
- **Audit Trail**: JSON format, 365 day retention, include all fields

### Idea Pipeline Workflow (5.8)
- **Max Concurrent Seeds**: 5
- **Maturity Levels**: planted → sprouting → growing → mature
- **Promotion**: Requires human review gate
- **Runaway Detection**: Max 100 iterations, 10 cycles no-progress threshold

---

## Phase 6: Multi-Model Routing

### Decision 6.1.1: Default Model Assignment

| Workflow | Default Model | Rationale |
|----------|---------------|-----------|
| Second Brain | Claude Opus | Complex reasoning |
| Twitter Intelligence | Claude Sonnet | Fast summarization |
| Email Assistant | Claude Sonnet | Balanced |
| Autonomous Dev | Claude Opus | Complex coding |
| Voice TTS | Local Qwen3 | Privacy, latency |
| Trading Agent | Claude Opus + Grok | Accuracy critical |
| Idea Pipeline | Claude Opus | Creative reasoning |

### Decision 6.1.3: Model Fallback Chain
**Recommendation**: Opus → Sonnet → Haiku → Local

- Automatic fallback on failure/rate limit
- Log fallback events
- User notification if falling back multiple levels

### Decision 6.2.2: Daily Budget Defaults

| Workflow | Daily Budget |
|----------|--------------|
| Second Brain | $10 |
| Twitter Intelligence | $5 |
| Email Assistant | $5 |
| Autonomous Dev | $20 |
| Trading Agent | $5 |
| Idea Pipeline | $10 |

### Decision 6.2.3-6.2.4: Budget Behavior
- Alert thresholds: 50%, 80%, 95%
- On budget exceeded: Hard stop, require manual reset (can configure soft stop)

### Decision 6.3.1: Local Model Support
**Recommendation**: **(C) Both Ollama and llama.cpp**

- Ollama for ease of use
- llama.cpp for performance/customization
- Support Metal (macOS) and CUDA (Linux/Windows)

---

## Phase 7: Collaboration Security

### Decision 7.1.1: Commit Signature Verification
**Recommendation**: **(B) Warn on unsigned, allow with confirmation**

- Reject unsigned by default in Paranoid mode
- Allow GPG or SSH signatures
- Trust GitHub's verified badge as supplementary

### Decision 7.1.2: Collaborator Public Key Management
**Recommendation**: **(B) Fetch from GitHub/GitLab profiles** + **(A) Manual import**

- Auto-import from platform profiles
- Manual override for non-platform keys
- Per-repo collaborator lists

### Decision 7.1.3: OpenClaw Signing Key
**Recommendation**: **(A) Dedicated GPG key per installation**

- Generate on first install
- Store in Keychain/Keystore
- Include installation ID in key metadata

### Decision 7.2.1-7.2.3: Malicious Pattern Handling

| Pattern | Action |
|---------|--------|
| `rm -rf /` or similar | Auto-reject |
| `curl \| sh` | Quarantine + prompt |
| `eval()` with dynamic input | Quarantine + warn |
| Encoded/obfuscated code | Quarantine + warn |
| Credential patterns | Quarantine + warn |
| Known CVE patterns | Auto-reject |

### Decision 7.3.1-7.3.3: Context Namespace System
- Prefixes: `local:`, `shared:`, `workflow:`
- Cross-namespace query: Allow with explicit flag
- Merge on pull: Only merge `shared:` entries

---

## Phase 8: Documentation and Migration

### Decision 8.1.3: Rollback Procedures
Document:
- Config file backup/restore
- Credential re-migration process
- Sandbox mode downgrade
- Gateway auth removal (emergency)

### Decision 8.2.1: Security Configure Wizard Recommendations

| Use Case | Recommended Preset |
|----------|-------------------|
| Personal use, single user | Standard |
| Personal use, sensitive data | Hardened |
| Enterprise/compliance | Paranoid |
| Development/testing | Standard |
| Trading/financial | Paranoid |

### Decision 8.2.2: Security Report Formats
**Recommendation**: **(C) JSON + HTML + PDF**

- JSON for machine processing
- HTML for human review
- PDF for compliance documentation

### Decision 8.2.3: Security Test Scenarios
Simulate:
- Prompt injection via channel message
- Credential exfiltration attempt
- Skill with malicious code
- Network exfiltration from sandbox
- Privilege escalation attempt
- Token theft/replay

---

## Remaining GAPs

### GAP-7/8: Platform Credential Backends
**Priority**: Medium
- Linux (libsecret) and Windows (Credential Manager) are important
- Encrypted file fallback is acceptable interim solution

### GAP-11: User Passphrase for Encrypted File
- Set during onboarding or via `openclaw credentials passphrase set`
- Minimum 12 characters
- Recovery via security questions or backup codes
- Migration wizard from machine-derived key

### GAP-12: Hardware Key (YubiKey) Support
**Recommendation**: Support FIDO2/WebAuthn as primary, OpenPGP as secondary

### GAP-13: Credential Category Access Control
- API Keys: Agent only
- Channel Tokens: Gateway only
- OAuth Tokens: Per-workflow
- User Secrets: User-approved access only

### GAP-14: Rotation Reminder System
- Warn at 30, 14, 7 days before expiry
- Notification via CLI + desktop + messaging channel
- Auto-rotation support for OAuth tokens

### GAP-15: Gateway Password Authentication Mode
**Recommendation**: Use **Argon2id** (modern, memory-hard)

### GAP-36: Proxy Trust Warning
- Show at startup when behind proxy without trust config
- Include: detected proxy, risks, documentation link
- One-time dismissable with acknowledgment

### GAP-40: Secure Enclave for Session Keys
- iOS/macOS: Use Secure Enclave
- Android: StrongBox if available, TEE fallback
- Linux/Windows: Software with additional key derivation

---

## Priority Execution Roadmap

### P0 - Critical Path (Months 1-2)
1. Native app auth (2.3.1-2.3.4)
2. Docker sandbox infrastructure (3.4.3)
3. Trading agent safety (5.7)
4. Basic skill vetting (4.1.1-4.1.5)

### P1 - High Priority (Months 2-3)
1. Network policy enforcement (3.2.1-3.2.3)
2. Dangerous tool approval flow (3.3.3a-d)
3. Platform sandboxing (3.4.1-3.4.2, 3.4.4)
4. Skill installation security (4.2)

### P2 - Supporting (Months 3-4)
1. Multi-model routing (6.1-6.3)
2. Collaboration security (7.1-7.3)
3. Workflow profiles (5.2-5.8)
4. Documentation (8.1-8.3)

---

**Document Status**: Complete
**Next Steps**: Update TODO.md to reflect completed research and begin implementation

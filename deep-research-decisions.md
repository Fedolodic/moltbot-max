# OpenClaw Security Hardening - Deep Research Decisions

**Purpose**: This document contains ~80 architectural and implementation decisions needed to complete the OpenClaw security hardening initiative. Use this as a prompt for deep research across multiple AI research platforms.

**Context**: OpenClaw is a multi-platform AI agent orchestration system that connects to messaging channels (Telegram, Discord, Slack, Signal, iMessage, WhatsApp) and executes autonomous workflows. We are implementing security-by-default across all platforms.

**Research Goal**: For each decision, provide industry best practices, security implications, UX tradeoffs, and a recommended approach with justification.

---

## Research Status: COMPLETE

**Completed**: 2026-01-30
**Research Source**: GPT-5.2 + Perplexity deep research (100+ authoritative sources)
**Answers Document**: [research-decisions-answers.md](./research-decisions-answers.md)

All 80+ decisions have been researched and documented with:
- Specific recommendations with rationale
- Industry best practices (2025-2026)
- Security analysis and threat implications
- UX impact assessment
- Implementation complexity estimates
- Dependency mapping

---

## Phase 2.3: Native App Authentication

**Context**: Native apps (macOS, iOS, Android) need to authenticate with the OpenClaw gateway using tokens stored in platform-specific secure storage (Keychain/Keystore).

### Decision 2.3.1: macOS App - Missing Token Handling
**Question**: When the macOS app cannot find a gateway token in Keychain, should it:
- (A) Automatically launch the onboarding wizard
- (B) Show an error dialog with manual instructions
- (C) Attempt to generate a new token automatically
- (D) Fall back to unauthenticated local-only mode

**Considerations**:
- User experience for first-time setup
- Security implications of each approach
- Handling of corrupted/expired tokens
- Multi-user Mac scenarios

### Decision 2.3.2: iOS App - Biometric Protection for Keychain
**Question**: Should iOS Keychain access for gateway tokens require biometric authentication (Face ID/Touch ID)?
- (A) Always require biometric
- (B) Optional, user-configurable
- (C) Only for "paranoid" security preset
- (D) Never require (rely on device unlock)

**Considerations**:
- Balance between security and convenience
- What happens when biometric fails (fallback to passcode?)
- Background refresh scenarios
- Accessibility concerns

### Decision 2.3.3: Android App - Keystore Biometric Requirements
**Question**: Should Android Keystore access require biometric authentication?
- (A) Use BiometricPrompt for every access
- (B) Use setUserAuthenticationRequired with timeout
- (C) Optional based on security preset
- (D) No biometric, rely on device security

**Considerations**:
- Android fragmentation (different biometric capabilities)
- StrongBox vs TEE availability
- Background service access patterns
- User authentication validity period

### Decision 2.3.4: Native App E2E Test Coverage
**Question**: What level of E2E test coverage is required for native app authentication?
- (A) Unit tests only (mock Keychain/Keystore)
- (B) Integration tests on simulators/emulators
- (C) Full E2E on real devices in CI
- (D) Manual QA checklist for releases

**Considerations**:
- CI/CD infrastructure requirements
- Test device availability and management
- Flakiness of device-based tests
- Coverage of edge cases (token expiry, revocation)

---

## Phase 3.2: Network Policy for Sandboxed Execution

**Context**: Sandboxed tool execution needs network restrictions to prevent data exfiltration and unauthorized API calls.

### Decision 3.2.1: Default Network Allowlist
**Question**: Which domains should be allowlisted by default for sandboxed execution?

**Current Proposal**:
```
api.anthropic.com
api.openai.com
*.bedrock.*.amazonaws.com
```

**Research Needed**:
- Complete list of AI provider API endpoints (Google AI, Mistral, Cohere, etc.)
- CDN/asset domains these APIs depend on
- OAuth/auth endpoints needed for token refresh
- Should package registries (npm, pypi) be allowed?
- Should GitHub/GitLab be allowed for code tools?

### Decision 3.2.2: Default Network Policy
**Question**: What should the default network policy be for non-allowlisted destinations?
- (A) `allow` - permit all outbound, log non-allowlisted
- (B) `deny` - block all non-allowlisted
- (C) `prompt` - ask user for each new destination
- (D) Vary by security preset (standard=allow, hardened=deny)

**Considerations**:
- Impact on legitimate tool functionality
- User experience when tools fail due to blocked network
- Logging and alerting requirements
- Enterprise vs personal use cases

### Decision 3.2.3: DNS-Based Allowlist Enforcement
**Question**: How should DNS-based network restrictions be implemented?
- (A) Resolve allowlist domains at sandbox creation, block by IP
- (B) Use DNS interception/proxy inside sandbox
- (C) Use eBPF/network namespace with allowlist
- (D) Rely on firewall rules with domain-to-IP mapping

**Considerations**:
- DNS changes during sandbox lifetime
- CDN and anycast IP ranges
- IPv4 vs IPv6 handling
- Performance impact
- Docker vs Bubblewrap vs native sandbox differences

---

## Phase 3.3.3: Dangerous Tool Approval Flow

**Context**: Certain tools (browser, canvas, cron, exec) are classified as "dangerous" and require user approval before execution.

### Decision 3.3.3a: Approval Prompt Location
**Question**: Where should dangerous tool approval prompts appear?
- (A) Terminal/CLI only
- (B) Desktop notification (macOS/Windows/Linux)
- (C) Messaging channel where conversation originated
- (D) Dedicated approval UI in native apps
- (E) All of the above, configurable

**Considerations**:
- Headless/server deployments
- Mobile app scenarios
- Response latency requirements
- Security of approval channel itself

### Decision 3.3.3b: Approval Memory/Persistence
**Question**: How long should tool approvals be remembered?
- (A) Per-invocation only (ask every time)
- (B) Per-session (until session ends/compacts)
- (C) Per-agent (permanent for that agent)
- (D) Global (approve once for all agents)
- (E) User-selectable at approval time

**Considerations**:
- Security vs convenience tradeoff
- Audit trail requirements
- Revocation mechanism
- Scope of "same tool" (exact params vs tool type)

### Decision 3.3.3c: Approval Timeout Behavior
**Question**: What happens if user doesn't respond to approval prompt?
- (A) Auto-deny after X seconds (configurable)
- (B) Wait indefinitely
- (C) Auto-approve after X seconds (dangerous!)
- (D) Escalate to secondary contact
- (E) Pause agent execution, resume when approved

**Considerations**:
- Autonomous workflow continuity
- User availability assumptions
- Default timeout duration if applicable
- Notification/reminder for pending approvals

### Decision 3.3.3d: Dangerous Tool Classification
**Question**: Which tools should require approval? Current list:
- `browser` - web automation
- `canvas` - image generation
- `cron` - scheduled tasks
- `exec` - shell command execution

**Research Needed**:
- Should `file_write` outside workspace require approval?
- Should `git push` require approval?
- Should network requests to non-allowlisted domains require approval?
- Should MCP tool calls require approval?
- How to handle tool composition (approved tool calls dangerous tool)?

---

## Phase 3.4: Platform-Specific Sandboxing

**Context**: Different platforms require different sandboxing implementations for secure tool execution.

### Decision 3.4.1: macOS XPC Sandbox Architecture
**Question**: How should the macOS XPC sandbox service be structured?
- (A) Separate helper binary bundled with app
- (B) Embedded XPC service in main app bundle
- (C) Privileged helper tool (requires admin install)
- (D) Login item with XPC interface

**Considerations**:
- App Store requirements and sandboxing entitlements
- Code signing and notarization
- Privilege separation model
- IPC protocol design (Codable vs NSSecureCoding)
- Resource limits enforcement

### Decision 3.4.2: Android Isolated Process Architecture
**Question**: How should Android sandboxed execution be implemented?
- (A) `android:isolatedProcess="true"` service
- (B) Separate APK with restricted permissions
- (C) WebView-based isolation
- (D) Native code with seccomp filters

**Considerations**:
- Android version compatibility (API levels)
- IPC mechanism (Binder, AIDL, Messenger)
- File system isolation
- Network namespace support
- Memory and CPU limits

### Decision 3.4.3: Docker Sandbox Security Flags
**Question**: Which Docker security flags should be mandatory for sandboxed execution?

**Current Proposal**:
```bash
--read-only
--cap-drop=ALL
--security-opt=no-new-privileges
--network=none (or restricted)
--memory=2g
--cpus=1
--pids-limit=100
```

**Research Needed**:
- Which capabilities might be needed for legitimate tools?
- seccomp profile recommendations
- AppArmor/SELinux profile recommendations
- User namespace configuration
- `/tmp` and working directory handling with `--read-only`

### Decision 3.4.4: Bubblewrap Fallback Strategy
**Question**: How should Bubblewrap (bwrap) be used as a Docker fallback on Linux?
- (A) Auto-detect and fallback silently
- (B) Require explicit opt-in via config
- (C) Warn user and request confirmation
- (D) Different security presets for bwrap vs Docker

**Considerations**:
- Feature parity with Docker sandboxing
- User namespace requirements (may need root or sysctl)
- Distribution-specific quirks
- Flatpak/Snap compatibility
- WSL2 considerations

---

## Phase 4: Skill Vetting Engine

**Context**: Third-party skills (plugins) need security vetting before installation to prevent malicious code execution.

### Decision 4.1.1: Vetting Result Risk Levels
**Question**: What risk classification levels should the vetting engine use?
- (A) Binary: safe/unsafe
- (B) Three-tier: safe/warning/blocked
- (C) Five-tier: critical/high/medium/low/info
- (D) Numeric score (0-100)

**Considerations**:
- User comprehension
- Actionability of each level
- Mapping to installation behavior
- Aggregation of multiple findings

### Decision 4.1.2-4.1.5: Detection Patterns and Severity
**Question**: For each pattern type, should it auto-block or warn?

| Pattern | Examples | Proposed Action |
|---------|----------|-----------------|
| Shell execution | `curl\|sh`, `wget\|bash`, `eval()` | ? |
| Sensitive file access | `~/.ssh/*`, `~/.aws/*`, `/etc/passwd` | ? |
| Obfuscated code | base64 decode + eval, hex strings | ? |
| Network connections | Non-allowlisted domains | ? |
| Privilege escalation | `sudo`, `doas`, setuid | ? |
| Crypto operations | Key generation, encryption calls | ? |

**Research Needed**:
- False positive rates for each pattern
- Legitimate use cases that match patterns
- Industry standards (npm audit, Snyk, etc.)
- YARA rule equivalents for JavaScript/TypeScript

### Decision 4.1.6: Cisco Skill Scanner Integration
**Question**: Should we integrate Cisco's skill scanning signatures?
- (A) Yes, as primary detection engine
- (B) Yes, as supplementary to our patterns
- (C) No, build our own signature database
- (D) Use open-source alternatives (ClamAV, YARA)

**Considerations**:
- Licensing requirements and costs
- API availability and rate limits
- Signature update frequency
- Privacy implications of sending code to external service

### Decision 4.2.1: Skill Allowlist Source
**Question**: Where should the trusted skill allowlist come from?
- (A) Official OpenClaw registry only
- (B) User-defined allowlist only
- (C) Both, with official as default
- (D) Community-curated list with voting

**Considerations**:
- Centralization vs decentralization
- Update mechanism
- Revocation process
- Enterprise custom allowlists

### Decision 4.2.2: Skill Permission Prompt Design
**Question**: When a skill requests risky permissions, how should the prompt be designed?
- (A) Block installation entirely
- (B) Show detailed permissions, require explicit approval
- (C) Install but disable risky capabilities
- (D) Sandbox skill with restricted permissions

**Research Needed**:
- Best practices from mobile app stores
- Browser extension permission models
- User comprehension studies on permission prompts
- Principle of least privilege application

### Decision 4.2.3: Skill Quarantine Implementation
**Question**: How should skill quarantine work?

**Parameters to decide**:
- Default quarantine period: 24 hours? 7 days? Configurable?
- What's restricted during quarantine? (network, file system, other tools)
- How is quarantine end communicated to user?
- Can user bypass quarantine? Under what conditions?

### Decision 4.2.4: Skill Signature Verification
**Question**: What signature verification system should be used for official skills?
- (A) GPG signatures with OpenClaw public key
- (B) Sigstore/cosign with transparency log
- (C) Code signing certificates (like macOS/Windows)
- (D) Content hash verification only (no cryptographic signature)

**Considerations**:
- Key management and rotation
- Transparency and auditability
- Tooling availability
- Offline verification capability

---

## Phase 5: Workflow Security Profiles

**Context**: Each autonomous workflow (Second Brain, Twitter Intelligence, etc.) has unique security requirements.

### Decision 5.2: Second Brain Workflow

#### 5.2.1: Anytype MCP Integration
**Questions**:
- Confirm endpoint: `localhost:31009`?
- API key storage: Keychain or config file?
- Rate limiting: requests per minute?
- Offline behavior: queue or fail?

#### 5.2.2: GitHub Collaboration Security
**Questions**:
- Signed commits: Require GPG, allow SSH signing, or both?
- Trusted collaborator list: Per-repo or global?
- Malicious pattern scanning: Same patterns as skill vetting?

#### 5.2.3: Context Namespace Isolation
**Questions**:
- Namespace prefixes: `local:`, `shared:`, `workflow:`?
- Cross-namespace query: Allow with flag or block entirely?
- Namespace in file paths or metadata only?

### Decision 5.3: Twitter Intelligence Workflow

#### 5.3.1: OAuth Scope Restrictions
**Questions**:
- Read-only scopes sufficient? Or need write for bookmarks/lists?
- Token storage: Keychain with what metadata?
- Auto-refresh: Background or on-demand?

#### 5.3.2: Content Quarantine
**Questions**:
- Injection pattern detection: Which patterns? `[INST]`, `<system>`, etc.?
- Suspicious content handling: Flag, redact, or block?
- Human review queue: Where does it live?

#### 5.3.3: Tweet Sanitization
**Questions**:
- Max content length for context injection?
- Markdown escaping: Which characters?
- URL handling: Expand, truncate, or remove?

### Decision 5.4: Email Assistant Workflow

#### 5.4.1: Gmail OAuth Scopes
**Questions**:
- Confirm scopes: `gmail.readonly` + `gmail.compose` (NO `gmail.send`)?
- Scope validation: Reject tokens with send permission?
- Multi-account support?

#### 5.4.2: PII Detection and Redaction
**Questions**:
- PII patterns to detect: SSN, credit card, phone, email, address?
- Redaction format: `[REDACTED]`, `***`, or category label?
- Redaction in logs vs user-visible content?

#### 5.4.3: Phishing Detection
**Questions**:
- Sender reputation: Use external service or heuristics?
- Suspicious patterns: Urgency language, mismatched links?
- User notification: Inline warning or separate alert?

#### 5.4.4: Draft Generation
**Questions**:
- Disclaimer text: What should it say?
- Disclaimer position: Top, bottom, or signature?
- Verify no-send: Runtime check on Gmail API calls?

### Decision 5.5: Autonomous Dev Workflow

#### 5.5.1: HEARTBEAT Permission Model
**Questions**:
- Auto-approved actions: `create_todo`, `update_todo`, `run_tests`, `read_file`?
- Require approval: `delete_files`, `git_commit`, `git_push`, `modify_outside_project`?
- Approval escalation: After N auto-actions, require human check-in?

#### 5.5.2: Iteration Limits
**Questions**:
- Max iterations per cycle: 50?
- Max duration per cycle: 15 minutes?
- Max total runtime per day?
- Pause behavior: Save state or reset?

#### 5.5.3: Gap Analysis Validation
**Questions**:
- Design doc alignment: Strict matching or fuzzy?
- Deficiency reporting: Inline or separate report?
- Auto-fix suggestions: Generate or just flag?

### Decision 5.6: Voice TTS Workflow

#### 5.6.1: Model Configuration
**Questions**:
- Model path: `~/.openclaw/models/qwen3-tts-1.7b`?
- Checksum verification: SHA256? On every load or first load?
- Model download: Auto-download or require manual?

#### 5.6.2: Content Redaction Before TTS
**Questions**:
- Redaction patterns: API keys, passwords, credit cards, SSN?
- Replacement text: "sensitive information redacted" or silence?
- Redaction logging: Log what was redacted (without content)?

#### 5.6.3: Audio File Cleanup
**Questions**:
- Temp directory: `/tmp/openclaw-tts` or XDG-compliant?
- Retention period: 5 minutes?
- Cleanup trigger: Timer, on-exit, or both?
- Secure deletion: Overwrite or just unlink?

### Decision 5.7: Trading Agent Workflow (CRITICAL)

#### 5.7.1: Paper Trading Default
**Questions**:
- Default mode: Paper trading ALWAYS?
- Live trading unlock: What verification required?
- Mode switching: Require restart or hot-switch?
- Visual indicator: How to clearly show paper vs live?

#### 5.7.2: Broker Integration
**Questions**:
- Supported brokers: Alpaca only? Interactive Brokers? Others?
- API key storage: Keychain with what metadata?
- Rate limiting: Per broker requirements?

#### 5.7.3: Trade Approval Flow
**Questions**:
- Approval required for: All trades? Only above threshold?
- Approval display: Symbol, amount, risk %, confidence, stop loss?
- Timeout: Never auto-approve? Or auto-cancel after X minutes?
- Mobile approval: Push notification with action buttons?

#### 5.7.4: Risk Management
**Questions**:
- Daily loss limit: Percentage or absolute? Default value?
- Position size limit: Per-trade and total?
- Drawdown protection: Threshold and action?
- Stop loss: Required on all positions? Default percentage?

#### 5.7.5: Trading Audit Trail
**Questions**:
- Log format: JSON, CSV, or structured database?
- Fields: timestamp, action, symbol, amount, price, reasoning, approval, result?
- Retention: 365 days? Configurable?
- Export: On-demand or automatic backup?

#### 5.7.6: Workflow Isolation
**Questions**:
- Dedicated sandbox: Separate container/process?
- Credential namespace: Isolated from other workflows?
- Network restrictions: Only broker API endpoints?
- File system: Separate working directory?

### Decision 5.8: Idea Pipeline Workflow

#### 5.8.1: Seed Management
**Questions**:
- Max concurrent seeds: 5?
- Seed maturity levels: planted/sprouting/growing/mature?
- Promotion criteria: Manual only or auto with review gate?

#### 5.8.2: Pattern Detection
**Questions**:
- Connection types: Similar, contrasting, sequential, causal?
- Source weights: How to prioritize workflow inputs?
- Novelty scoring: How to detect truly new connections?

#### 5.8.3: Runaway Detection
**Questions**:
- Max development iterations: 100?
- No-progress threshold: 10 cycles without advancement?
- Intervention: Pause, alert, or auto-archive?

---

## Phase 6: Multi-Model Routing

**Context**: Different workflows benefit from different AI models. Need routing, fallback, and cost management.

### Decision 6.1.1: Default Model Assignment
**Question**: What should be the default model for each workflow?

| Workflow | Proposed Default | Reasoning |
|----------|------------------|-----------|
| Second Brain | Claude Opus | Complex reasoning |
| Twitter Intelligence | Claude Sonnet | Fast, good summarization |
| Email Assistant | Claude Sonnet | Balanced |
| Autonomous Dev | Claude Opus | Complex coding |
| Voice TTS | Local Qwen3 | Privacy, latency |
| Trading Agent | ? | Speed vs accuracy? |
| Idea Pipeline | Claude Opus | Creative reasoning |

**Research Needed**:
- Cost comparison across models
- Latency requirements per workflow
- Quality benchmarks for each task type

### Decision 6.1.3: Model Fallback Chain
**Question**: When primary model fails, what's the fallback order?
- Example: Opus -> Sonnet -> Haiku -> Local?
- Should fallback be automatic or require confirmation?
- How to handle capability differences in fallback?

### Decision 6.2.2: Daily Budget Defaults
**Question**: What should default daily budgets be per workflow?

| Workflow | Proposed Daily Budget |
|----------|----------------------|
| Second Brain | $10? |
| Twitter Intelligence | $5? |
| Email Assistant | $5? |
| Autonomous Dev | $20? |
| Trading Agent | $5? |
| Idea Pipeline | $10? |

### Decision 6.2.3: Budget Alert Threshold
**Question**: At what percentage should budget alerts trigger?
- (A) 50%, 80%, 95%
- (B) 80% only
- (C) Configurable per workflow
- (D) Based on burn rate prediction

### Decision 6.2.4: Budget Exceeded Behavior
**Question**: What happens when daily budget is exceeded?
- (A) Hard stop, require manual reset
- (B) Soft stop, continue with user approval
- (C) Switch to cheaper model automatically
- (D) Borrow from next day's budget

### Decision 6.3.1: Local Model Support
**Question**: Which local model runtimes should be supported?
- (A) Ollama only
- (B) llama.cpp only
- (C) Both Ollama and llama.cpp
- (D) Also support vLLM, text-generation-inference

**Considerations**:
- Installation complexity
- Performance characteristics
- Model format compatibility
- GPU/Metal/CUDA support

---

## Phase 7: Collaboration Security

**Context**: When multiple users or agents collaborate on shared repositories, security measures prevent malicious contributions.

### Decision 7.1.1: Commit Signature Verification
**Question**: How strictly should commit signatures be verified?
- (A) Reject all unsigned commits from shared repos
- (B) Warn on unsigned, allow with confirmation
- (C) Only verify commits that modify sensitive files
- (D) Trust GitHub's verified badge

**Considerations**:
- Contributor onboarding friction
- Key management complexity
- GitHub vs self-hosted Git
- Revoked key handling

### Decision 7.1.2: Collaborator Public Key Management
**Question**: How should trusted collaborator keys be managed?
- (A) Manual import per collaborator
- (B) Fetch from GitHub/GitLab profiles
- (C) Keybase integration
- (D) Custom key server

### Decision 7.1.3: OpenClaw Signing Key
**Question**: How should OpenClaw sign its own commits?
- (A) Dedicated GPG key per installation
- (B) Shared OpenClaw organization key
- (C) Use user's existing GPG key
- (D) SSH signing with deployment key

### Decision 7.2.1-7.2.3: Malicious Pattern Handling
**Question**: For each pattern type, what action?

| Pattern | Action |
|---------|--------|
| `rm -rf /` or similar | Auto-reject |
| `curl \| sh` | ? |
| `eval()` with dynamic input | ? |
| Encoded/obfuscated code | ? |
| Credential patterns | ? |
| Known CVE patterns | ? |

### Decision 7.3.1-7.3.3: Context Namespace System
**Questions**:
- Namespace prefixes: `local:`, `shared:`, `workflow:`?
- Cross-namespace query policy?
- Merge behavior for shared namespace on pull?
- Conflict resolution for same key in different namespaces?

---

## Phase 8: Documentation and Migration

**Context**: Users need clear documentation and migration paths for security changes.

### Decision 8.1.3: Migration Guide Rollback Procedures
**Question**: What rollback procedures should be documented?
- Config file backup/restore
- Credential re-migration to plaintext (if needed)
- Sandbox mode downgrade
- Gateway auth removal

### Decision 8.2.1: Security Configure Wizard Recommendations
**Question**: How should the wizard recommend security presets?

| Use Case | Recommended Preset |
|----------|-------------------|
| Personal use, single user | Standard |
| Personal use, sensitive data | Hardened |
| Enterprise/compliance | Paranoid |
| Development/testing | Standard |
| Trading/financial | Paranoid |

### Decision 8.2.2: Security Report Formats
**Question**: Which export formats for security reports?
- (A) JSON only (machine-readable)
- (B) JSON + HTML (human-readable)
- (C) JSON + HTML + PDF (printable)
- (D) All above plus CSV for spreadsheets

### Decision 8.2.3: Security Test Scenarios
**Question**: Which attack scenarios should `openclaw security test` simulate?
- Prompt injection via channel message
- Credential exfiltration attempt
- Skill with malicious code
- Network exfiltration from sandbox
- Privilege escalation attempt
- Token theft/replay

### Decision 8.3.1-8.3.3: Emergency Procedures
**Question**: What are the "big red button" procedures for each critical workflow?

| Workflow | Emergency Stop | Recovery |
|----------|---------------|----------|
| Trading Agent | Kill process, revoke API keys | Review audit log, manual position close |
| Autonomous Dev | `git reset --hard`, pause agent | Review commits, selective revert |
| Idea Pipeline | Archive all seeds, clear context | Manual review, selective restore |

---

## Remaining GAPs (Not Phase-Blocked)

### GAP-7/8: Platform Credential Backends
**Question**: What priority for Linux (libsecret) and Windows (Credential Manager) backends?
- High: Many users on these platforms
- Medium: Encrypted file fallback works
- Low: Focus on mobile first

### GAP-11: User Passphrase for Encrypted File
**Question**: UX flow for user-provided passphrase?
- Set during onboarding or separate command?
- Passphrase strength requirements?
- Recovery mechanism if forgotten?
- Migration from machine-derived key?

### GAP-12: Hardware Key (YubiKey) Support
**Question**: Which protocols to support?
- FIDO2/WebAuthn
- PIV (smart card)
- OpenPGP
- All of the above?

### GAP-13: Credential Category Access Control
**Question**: Which credential categories need isolation?
- API Keys: Agent only
- Channel Tokens: Gateway only
- OAuth Tokens: Per-workflow
- User Secrets: User-approved access only

### GAP-14: Rotation Reminder System
**Question**: How to remind users about credential rotation?
- Days before expiry to warn: 30? 14? 7?
- Notification channel: CLI, desktop, messaging?
- Auto-rotation support for which credentials?

### GAP-15: Gateway Password Authentication Mode
**Question**: Password hashing algorithm for gateway auth?
- bcrypt (proven, widely supported)
- Argon2id (modern, memory-hard)
- scrypt (memory-hard, used elsewhere in codebase)

### GAP-36: Proxy Trust Warning
**Question**: What warning message when behind proxy without trust config?
- When to show: Startup, first request, or both?
- What information to include?
- Link to documentation?

### GAP-40: Secure Enclave for Session Keys
**Question**: How to handle Secure Enclave on different platforms?
- iOS/macOS: Use Secure Enclave
- Android: Use StrongBox if available, TEE fallback
- Linux/Windows: Software fallback with what protection?

---

## Research Output Format

For each decision, please provide:

1. **Recommendation**: Clear choice with rationale
2. **Industry Precedent**: How do similar systems handle this?
3. **Security Analysis**: Threat model implications
4. **UX Impact**: User experience considerations
5. **Implementation Complexity**: Rough effort estimate
6. **Dependencies**: What else this decision affects
7. **Open Questions**: Anything requiring further investigation

---

## Priority Ranking Request

After analyzing all decisions, please provide a priority ranking:

1. **Critical Path**: Decisions that block the most downstream work
2. **High Security Impact**: Decisions with greatest security implications
3. **Quick Wins**: Low-effort decisions with clear best practices
4. **Needs User Research**: Decisions requiring user preference input
5. **Defer**: Decisions that can be made later without blocking progress

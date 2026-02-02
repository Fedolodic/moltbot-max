# SecureClaw — Security-Hardened OpenClaw

<p align="center">
  <strong>Secure by Default AI Agent Platform</strong>
</p>

<p align="center">
  <a href="design-docs/2-security-hardening-by-default.md"><img src="https://img.shields.io/badge/Security-Hardened-green?style=for-the-badge" alt="Security Hardened"></a>
  <a href="TODO.md"><img src="https://img.shields.io/badge/Status-Active%20Development-blue?style=for-the-badge" alt="Active Development"></a>
</p>

**SecureClaw** is a security-hardened fork of [OpenClaw](https://github.com/openclaw/openclaw) that implements defense-in-depth security by default. No configuration required — fresh installs are secure out of the box.

## Why SecureClaw?

Recent security research identified vulnerabilities in default AI agent configurations:

- **900+ exposed gateways** discovered with weak or no authentication
- **Plaintext credentials** vulnerable to exfiltration
- **Prompt injection attacks** leading to arbitrary code execution
- **Unvetted skills** enabling supply chain attacks
- **Open DM policies** allowing strangers to interact with bots

SecureClaw shifts from "security requires configuration" to **secure by default**.

## Key Security Features

### Implemented

| Feature | Status | Description |
|---------|--------|-------------|
| **Encrypted Credential Storage** | ✅ | macOS Keychain + AES-256-GCM encrypted file fallback |
| **Security Presets** | ✅ | Three levels: `standard`, `hardened` (default), `paranoid` |
| **Gateway Auto-Token** | ✅ | 256-bit secure token generated on first onboard |
| **Loopback Authentication** | ✅ | Auth required even for localhost (hardened/paranoid) |
| **Security CLI** | ✅ | `openclaw security status/audit/configure/report/test` |
| **Credential Migration** | ✅ | `openclaw credentials migrate` with secure deletion |

### In Progress

| Feature | Status | Description |
|---------|--------|-------------|
| **Sandboxed Execution** | 30% | All tool execution sandboxed by default |
| **Dangerous Tools Approval** | 30% | Browser, exec, canvas, cron require opt-in |
| **Network Policy** | 0% | Configurable allowlist (default: AI providers only) |
| **Skill Vetting** | 0% | Signature verification, quarantine, trust levels |
| **Workflow Security Profiles** | 0% | Per-workflow isolation and permissions |

## Security Levels

```bash
# Check current security posture
openclaw security status

# Full security audit
openclaw security audit --deep

# Auto-fix common issues
openclaw security audit --fix

# Interactive security setup
openclaw security configure
```

### Preset Comparison

| Setting | Standard | Hardened (Default) | Paranoid |
|---------|----------|-------------------|----------|
| Gateway Auth | Remote only | Always | Always |
| DM Policy | `pairing` | `allowlist` | `allowlist` |
| Sandbox Mode | `non-main` | `all` | `all` |
| Dangerous Tools | Enabled | Approval required | Disabled |
| Credential Storage | Encrypted | Encrypted | Encrypted |
| Log Redaction | Tools only | Full | Full |

## Quick Start

```bash
# Install globally
npm install -g openclaw@latest

# Run onboarding (auto-generates secure token)
openclaw onboard

# Verify security posture
openclaw security audit --deep
```

## Documentation

- [Security Hardening Design Doc](design-docs/2-security-hardening-by-default.md) — Full architecture and implementation details
- [Current Working Design](design-docs/1-openclaw-current-working-design.md) — System overview
- [Implementation TODO](TODO.md) — Detailed work breakdown structure

## Workflow Security Profiles

SecureClaw supports workflow-specific security zones:

- **Second Brain** — Anytype MCP + encrypted local storage
- **Twitter Intelligence** — Content quarantine, read-only by default
- **Email Assistant** — Draft-only mode, never auto-send
- **Autonomous Dev** — Sandboxed execution, HEARTBEAT monitoring
- **Voice TTS** — Local Qwen3-TTS for privacy-preserving voice
- **Trading Agent** — Paper trading default, ALL trades require approval
- **Idea Pipeline** — Isolated observation with content filtering

## Contributing

SecureClaw welcomes security-focused contributions:

1. Review [Security Hardening Design Doc](design-docs/2-security-hardening-by-default.md)
2. Check [TODO.md](TODO.md) for implementation gaps
3. Run `openclaw security audit --deep` on your changes
4. Ensure no regressions in security posture

## License

MIT — Same as OpenClaw

---

<p align="center">
  <strong>Defense in Depth for AI Agents</strong><br>
  <em>Because security shouldn't be an afterthought</em>
</p>

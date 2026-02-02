import type { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { resolveSecurityConfig, validateSecurityConfig } from "../config/security-presets.js";
import { defaultRuntime } from "../runtime.js";
import { getCredentialStorageStatus } from "../security/audit-credentials.js";
import { runSecurityAudit } from "../security/audit.js";
import { fixSecurityFootguns } from "../security/fix.js";
import { formatDocsLink } from "../terminal/links.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomeInString, shortenHomePath } from "../utils.js";
import { formatCliCommand } from "./command-format.js";

type SecurityAuditOptions = {
  json?: boolean;
  deep?: boolean;
  fix?: boolean;
};

function formatSummary(summary: { critical: number; warn: number; info: number }): string {
  const rich = isRich();
  const c = summary.critical;
  const w = summary.warn;
  const i = summary.info;
  const parts: string[] = [];
  parts.push(rich ? theme.error(`${c} critical`) : `${c} critical`);
  parts.push(rich ? theme.warn(`${w} warn`) : `${w} warn`);
  parts.push(rich ? theme.muted(`${i} info`) : `${i} info`);
  return parts.join(" · ");
}

export function registerSecurityCli(program: Command) {
  const security = program
    .command("security")
    .description("Security tools (audit, status)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/security", "docs.openclaw.ai/cli/security")}\n`,
    );

  // moltbot security status
  security
    .command("status")
    .description("Show security posture summary")
    .option("--json", "Print JSON", false)
    .action(async (opts: { json?: boolean }) => {
      const cfg = loadConfig();
      const securityConfig = resolveSecurityConfig(cfg.security);
      const credStatus = await getCredentialStorageStatus();

      // Run a quick audit to get summary
      const auditReport = await runSecurityAudit({
        config: cfg,
        deep: false,
        includeFilesystem: true,
        includeChannelSecurity: false, // Skip channel checks for status
      });

      // Validate config against current level
      const validationIssues = validateSecurityConfig(securityConfig, securityConfig.level);

      const status = {
        level: securityConfig.level,
        credentials: {
          backend: credStatus.backend,
          available: credStatus.backendAvailable,
          count: credStatus.credentialCount,
          plaintextDetected: credStatus.plaintextCount,
          oldestDays: credStatus.oldestCredentialDays,
        },
        sandbox: {
          mode: securityConfig.sandbox.defaultMode,
          networkPolicy: securityConfig.sandbox.networkPolicy,
        },
        gateway: {
          requireAuthForLoopback: securityConfig.gateway.requireAuthForLoopback,
          minTokenLength: securityConfig.gateway.minTokenLength,
        },
        audit: {
          runOnStart: securityConfig.audit.runOnStart,
          blockOnCritical: securityConfig.audit.blockOnCritical,
          findings: auditReport.summary,
        },
        skills: {
          requireAllowlist: securityConfig.skills.requireAllowlist,
          blockCriticalRisks: securityConfig.skills.blockCriticalRisks,
          quarantinePeriodMs: securityConfig.skills.quarantinePeriodMs,
        },
        validationIssues,
      };

      if (opts.json) {
        defaultRuntime.log(JSON.stringify(status, null, 2));
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);
      const ok = (text: string) => (rich ? theme.success(text) : text);
      const warn = (text: string) => (rich ? theme.warn(text) : text);
      const error = (text: string) => (rich ? theme.error(text) : text);

      const statusIcon = (isGood: boolean) => (isGood ? ok("✓") : warn("○"));
      const criticalIcon = (isBad: boolean) => (isBad ? error("✗") : ok("✓"));

      const lines: string[] = [];
      lines.push(heading("Moltbot Security Status"));
      lines.push("");

      // Security Level
      const levelColor = status.level === "paranoid" ? ok : status.level === "hardened" ? ok : warn;
      lines.push(`${muted("Security Level:")} ${levelColor(status.level.toUpperCase())}`);
      lines.push("");

      // Credentials
      lines.push(heading("Credentials"));
      lines.push(
        `  ${statusIcon(status.credentials.backend !== "plaintext")} Backend: ${status.credentials.backend}`,
      );
      lines.push(
        `  ${statusIcon(status.credentials.count > 0)} Stored: ${status.credentials.count}`,
      );
      lines.push(
        `  ${criticalIcon(status.credentials.plaintextDetected > 0)} Plaintext detected: ${status.credentials.plaintextDetected}`,
      );
      if (status.credentials.oldestDays !== null) {
        lines.push(`  ${muted("Oldest credential:")} ${status.credentials.oldestDays} days`);
      }
      lines.push("");

      // Gateway
      lines.push(heading("Gateway"));
      lines.push(
        `  ${statusIcon(status.gateway.requireAuthForLoopback)} Auth for loopback: ${status.gateway.requireAuthForLoopback ? "required" : "not required"}`,
      );
      lines.push(`  ${muted("Min token length:")} ${status.gateway.minTokenLength}`);
      lines.push("");

      // Sandbox
      lines.push(heading("Sandbox"));
      lines.push(`  ${statusIcon(status.sandbox.mode === "all")} Mode: ${status.sandbox.mode}`);
      lines.push(
        `  ${statusIcon(status.sandbox.networkPolicy === "deny")} Network policy: ${status.sandbox.networkPolicy}`,
      );
      lines.push("");

      // Audit Findings
      lines.push(heading("Audit Summary"));
      lines.push(
        `  ${criticalIcon(status.audit.findings.critical > 0)} Critical: ${status.audit.findings.critical}`,
      );
      lines.push(`  ${warn(`○`)} Warnings: ${status.audit.findings.warn}`);
      lines.push(`  ${muted("○")} Info: ${status.audit.findings.info}`);
      lines.push("");

      // Validation Issues
      if (status.validationIssues.length > 0) {
        lines.push(heading("Configuration Issues"));
        for (const issue of status.validationIssues) {
          lines.push(`  ${error("✗")} ${issue}`);
        }
        lines.push("");
      }

      // Next Steps
      lines.push(muted("Commands:"));
      lines.push(muted(`  ${formatCliCommand("moltbot security audit")} - Full security audit`));
      lines.push(muted(`  ${formatCliCommand("moltbot security audit --fix")} - Auto-fix issues`));
      if (status.credentials.plaintextDetected > 0) {
        lines.push(
          muted(`  ${formatCliCommand("moltbot credentials migrate")} - Migrate credentials`),
        );
      }

      defaultRuntime.log(lines.join("\n"));
    });

  security
    .command("audit")
    .description("Audit config + local state for common security foot-guns")
    .option("--deep", "Attempt live Gateway probe (best-effort)", false)
    .option("--fix", "Apply safe fixes (tighten defaults + chmod state/config)", false)
    .option("--json", "Print JSON", false)
    .action(async (opts: SecurityAuditOptions) => {
      const fixResult = opts.fix ? await fixSecurityFootguns().catch((_err) => null) : null;

      const cfg = loadConfig();
      const report = await runSecurityAudit({
        config: cfg,
        deep: Boolean(opts.deep),
        includeFilesystem: true,
        includeChannelSecurity: true,
      });

      if (opts.json) {
        defaultRuntime.log(
          JSON.stringify(fixResult ? { fix: fixResult, report } : report, null, 2),
        );
        return;
      }

      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);
      const ok = (text: string) => (rich ? theme.success(text) : text);
      const error = (text: string) => (rich ? theme.error(text) : text);

      const lines: string[] = [];
      lines.push(heading("OpenClaw security audit"));
      lines.push(muted(`Summary: ${formatSummary(report.summary)}`));
      lines.push(muted(`Run deeper: ${formatCliCommand("openclaw security audit --deep")}`));

      if (opts.fix) {
        lines.push(muted(`Fix: ${formatCliCommand("openclaw security audit --fix")}`));
        if (!fixResult) {
          lines.push(muted("Fixes: failed to apply (unexpected error)"));
        } else if (
          fixResult.errors.length === 0 &&
          fixResult.changes.length === 0 &&
          fixResult.actions.every((a) => !a.ok)
        ) {
          lines.push(muted("Fixes: no changes applied"));
        } else {
          lines.push("");
          lines.push(heading("FIX"));
          for (const change of fixResult.changes) {
            lines.push(muted(`  ${shortenHomeInString(change)}`));
          }
          for (const action of fixResult.actions) {
            if (action.kind === "chmod") {
              const mode = action.mode.toString(8).padStart(3, "0");
              if (action.ok) {
                lines.push(muted(`  chmod ${mode} ${shortenHomePath(action.path)}`));
              } else if (action.skipped) {
                lines.push(
                  muted(`  skip chmod ${mode} ${shortenHomePath(action.path)} (${action.skipped})`),
                );
              } else if (action.error) {
                lines.push(
                  muted(`  chmod ${mode} ${shortenHomePath(action.path)} failed: ${action.error}`),
                );
              }
              continue;
            }
            if (action.kind === "credential-migration") {
              if (action.migrated > 0) {
                lines.push(ok(`  ✓ Migrated ${action.migrated} credential(s) to secure storage`));
              }
              if (action.failed > 0) {
                lines.push(error(`  ✗ ${action.failed} credential(s) failed to migrate`));
              }
              if (action.skipped > 0) {
                lines.push(
                  muted(`  ○ Skipped ${action.skipped} file(s) (manual migration needed)`),
                );
              }
              if (action.filesDeleted.length > 0) {
                lines.push(
                  ok(`  ✓ Securely deleted ${action.filesDeleted.length} plaintext file(s)`),
                );
              }
              continue;
            }
            // icacls or other action types
            const command = shortenHomeInString(action.command);
            if (action.ok) {
              lines.push(muted(`  ${command}`));
            } else if (action.skipped) {
              lines.push(muted(`  skip ${command} (${action.skipped})`));
            } else if (action.error) {
              lines.push(muted(`  ${command} failed: ${action.error}`));
            }
          }
          if (fixResult.errors.length > 0) {
            for (const err of fixResult.errors) {
              lines.push(muted(`  error: ${shortenHomeInString(err)}`));
            }
          }
        }
      }

      const bySeverity = (sev: "critical" | "warn" | "info") =>
        report.findings.filter((f) => f.severity === sev);

      const render = (sev: "critical" | "warn" | "info") => {
        const list = bySeverity(sev);
        if (list.length === 0) {
          return;
        }
        const label =
          sev === "critical"
            ? rich
              ? theme.error("CRITICAL")
              : "CRITICAL"
            : sev === "warn"
              ? rich
                ? theme.warn("WARN")
                : "WARN"
              : rich
                ? theme.muted("INFO")
                : "INFO";
        lines.push("");
        lines.push(heading(label));
        for (const f of list) {
          lines.push(`${theme.muted(f.checkId)} ${f.title}`);
          lines.push(`  ${f.detail}`);
          if (f.remediation?.trim()) {
            lines.push(`  ${muted(`Fix: ${f.remediation.trim()}`)}`);
          }
        }
      };

      render("critical");
      render("warn");
      render("info");

      defaultRuntime.log(lines.join("\n"));
    });
}

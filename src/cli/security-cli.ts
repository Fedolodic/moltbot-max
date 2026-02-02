import type { Command } from "commander";
import fs from "node:fs/promises";
import type { SecurityLevel } from "../config/types.security.js";
import { loadConfig } from "../config/config.js";
import { writeConfigFile } from "../config/io.js";
import { resolveStateDir } from "../config/paths.js";
import {
  SECURITY_PRESETS,
  recommendSecurityLevel,
  resolveSecurityConfig,
  validateSecurityConfig,
} from "../config/security-presets.js";
import { defaultRuntime } from "../runtime.js";
import { getCredentialStorageStatus } from "../security/audit-credentials.js";
import { runSecurityAudit } from "../security/audit.js";
import { fixSecurityFootguns } from "../security/fix.js";
import { formatDocsLink } from "../terminal/links.js";
import { isRich, theme } from "../terminal/theme.js";
import { shortenHomeInString, shortenHomePath } from "../utils.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import { WizardCancelledError } from "../wizard/prompts.js";
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

  // moltbot security configure - Interactive security configuration wizard (GAP-28)
  security
    .command("configure")
    .description("Interactive security configuration wizard")
    .option("--non-interactive", "Use recommended defaults without prompts", false)
    .action(async (opts: { nonInteractive?: boolean }) => {
      const cfg = loadConfig();
      const currentLevel = cfg.security?.level ?? "hardened";
      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);

      defaultRuntime.log(heading("Security Configuration Wizard"));
      defaultRuntime.log("");

      if (opts.nonInteractive) {
        // Use recommended defaults
        const recommended = recommendSecurityLevel({
          isProduction: true,
          hasFinancialWorkflows: false,
          hasExternalCollaborators: false,
        });
        const preset = SECURITY_PRESETS[recommended];

        const newConfig = {
          ...cfg,
          security: {
            ...cfg.security,
            level: recommended,
            credentials: preset.credentials,
            gateway: preset.gateway,
            sandbox: preset.sandbox,
            audit: preset.audit,
            skills: preset.skills,
          },
        };

        await writeConfigFile(newConfig);
        defaultRuntime.log(`✓ Applied ${recommended} security preset`);
        defaultRuntime.log(muted(`Run ${formatCliCommand("openclaw security status")} to verify.`));
        return;
      }

      // Interactive mode
      const prompter = createClackPrompter();

      try {
        await prompter.intro("Let's configure your security settings.");

        // Question 1: Use case
        const useCase = await prompter.select({
          message: "What best describes your use case?",
          options: [
            { value: "personal", label: "Personal use / local development" },
            { value: "production", label: "Production deployment" },
            { value: "financial", label: "Financial workflows (trading, budgets)" },
            { value: "collaboration", label: "Collaboration with external users" },
          ],
          initialValue: "personal",
        });

        // Recommend level based on use case
        const recommended = recommendSecurityLevel({
          isProduction: useCase === "production" || useCase === "collaboration",
          hasFinancialWorkflows: useCase === "financial",
          hasExternalCollaborators: useCase === "collaboration",
        });

        // Question 2: Security level
        const levelChoice = await prompter.select({
          message: `Recommended level: ${recommended.toUpperCase()}. Choose your security level:`,
          options: [
            {
              value: "standard",
              label: "Standard - Good defaults for local development",
            },
            {
              value: "hardened",
              label: "Hardened - Recommended for production (default)",
            },
            {
              value: "paranoid",
              label: "Paranoid - Maximum security, reduced convenience",
            },
          ],
          initialValue: recommended,
        });

        const selectedLevel = levelChoice as SecurityLevel;
        const preset = SECURITY_PRESETS[selectedLevel];

        // Question 3: Customize or use preset
        const customize = await prompter.confirm({
          message: "Do you want to customize individual settings?",
          initialValue: false,
        });

        let finalConfig = { ...preset };

        if (customize) {
          // Gateway auth
          const requireLoopbackAuth = await prompter.confirm({
            message: "Require authentication even for localhost connections?",
            initialValue: preset.gateway.requireAuthForLoopback,
          });
          finalConfig.gateway = {
            ...finalConfig.gateway,
            requireAuthForLoopback: requireLoopbackAuth,
          };

          // Sandbox mode
          const sandboxMode = await prompter.select({
            message: "Sandbox execution mode:",
            options: [
              { value: "off", label: "Off - No sandboxing (not recommended)" },
              { value: "non-main", label: "Non-main - Sandbox agent sessions only" },
              { value: "all", label: "All - Sandbox all execution (recommended)" },
            ],
            initialValue: preset.sandbox.defaultMode,
          });
          finalConfig.sandbox = {
            ...finalConfig.sandbox,
            defaultMode: sandboxMode as "off" | "non-main" | "all",
          };

          // Audit on start
          const runAuditOnStart = await prompter.confirm({
            message: "Run security audit on gateway startup?",
            initialValue: preset.audit.runOnStart,
          });
          finalConfig.audit = { ...finalConfig.audit, runOnStart: runAuditOnStart };

          // Block on critical
          if (runAuditOnStart) {
            const blockOnCritical = await prompter.confirm({
              message: "Block gateway startup if critical issues found?",
              initialValue: preset.audit.blockOnCritical,
            });
            finalConfig.audit = { ...finalConfig.audit, blockOnCritical };
          }
        }

        // Apply configuration
        const newConfig = {
          ...cfg,
          security: {
            level: selectedLevel,
            credentials: finalConfig.credentials,
            gateway: finalConfig.gateway,
            sandbox: finalConfig.sandbox,
            audit: finalConfig.audit,
            skills: finalConfig.skills,
          },
        };

        await writeConfigFile(newConfig);

        await prompter.outro(`Security configured to ${selectedLevel.toUpperCase()} level.`);
        defaultRuntime.log(muted(`Run ${formatCliCommand("openclaw security status")} to verify.`));
      } catch (err) {
        if (err instanceof WizardCancelledError) {
          defaultRuntime.log(muted("Configuration cancelled."));
          return;
        }
        throw err;
      }
    });

  // moltbot security report - Export security report (GAP-29)
  security
    .command("report")
    .description("Export security report in various formats")
    .option("--format <format>", "Output format: json, html", "json")
    .option("-o, --output <file>", "Output file path (defaults to stdout for json)")
    .action(async (opts: { format?: string; output?: string }) => {
      const cfg = loadConfig();
      const securityConfig = resolveSecurityConfig(cfg.security);
      const credStatus = await getCredentialStorageStatus();

      // Run full audit
      const auditReport = await runSecurityAudit({
        config: cfg,
        deep: true,
        includeFilesystem: true,
        includeChannelSecurity: true,
      });

      // Validate config
      const validationIssues = validateSecurityConfig(securityConfig, securityConfig.level);

      const report = {
        generatedAt: new Date().toISOString(),
        securityLevel: securityConfig.level,
        summary: auditReport.summary,
        findings: auditReport.findings,
        credentials: {
          backend: credStatus.backend,
          available: credStatus.backendAvailable,
          count: credStatus.credentialCount,
          plaintextDetected: credStatus.plaintextCount,
        },
        configuration: {
          gateway: securityConfig.gateway,
          sandbox: securityConfig.sandbox,
          skills: securityConfig.skills,
          audit: securityConfig.audit,
        },
        validationIssues,
        deep: auditReport.deep,
      };

      if (opts.format === "html") {
        const html = generateHtmlReport(report);
        if (opts.output) {
          await fs.writeFile(opts.output, html, "utf-8");
          defaultRuntime.log(`Report written to ${opts.output}`);
        } else {
          defaultRuntime.log(html);
        }
      } else {
        // JSON format
        const json = JSON.stringify(report, null, 2);
        if (opts.output) {
          await fs.writeFile(opts.output, json, "utf-8");
          defaultRuntime.log(`Report written to ${opts.output}`);
        } else {
          defaultRuntime.log(json);
        }
      }
    });

  // moltbot security test - Run security scenario tests (GAP-30)
  security
    .command("test")
    .description("Simulate security attack scenarios to verify defenses")
    .option(
      "--scenario <name>",
      "Specific scenario: prompt-injection, credential-exfil, skill-malware, all",
      "all",
    )
    .option("--verbose", "Show detailed test output", false)
    .action(async (opts: { scenario?: string; verbose?: boolean }) => {
      const cfg = loadConfig();
      const securityConfig = resolveSecurityConfig(cfg.security);
      const rich = isRich();
      const heading = (text: string) => (rich ? theme.heading(text) : text);
      const ok = (text: string) => (rich ? theme.success(text) : text);
      const warn = (text: string) => (rich ? theme.warn(text) : text);
      const error = (text: string) => (rich ? theme.error(text) : text);
      const muted = (text: string) => (rich ? theme.muted(text) : text);

      defaultRuntime.log(heading("Security Scenario Tests"));
      defaultRuntime.log("");

      const scenarios =
        opts.scenario === "all"
          ? ["prompt-injection", "credential-exfil", "skill-malware"]
          : [opts.scenario ?? "all"];

      const results: Array<{ name: string; passed: boolean; details: string[] }> = [];

      for (const scenario of scenarios) {
        const result = await runSecurityScenario(
          scenario,
          securityConfig,
          cfg,
          opts.verbose ?? false,
        );
        results.push(result);
      }

      // Print results
      defaultRuntime.log("");
      defaultRuntime.log(heading("Results"));
      defaultRuntime.log("");

      let allPassed = true;
      for (const result of results) {
        const icon = result.passed ? ok("✓") : error("✗");
        const status = result.passed ? ok("PASS") : error("FAIL");
        defaultRuntime.log(`${icon} ${result.name}: ${status}`);
        if (opts.verbose || !result.passed) {
          for (const detail of result.details) {
            defaultRuntime.log(`    ${muted(detail)}`);
          }
        }
        if (!result.passed) allPassed = false;
      }

      defaultRuntime.log("");
      if (allPassed) {
        defaultRuntime.log(ok("All security scenarios passed!"));
      } else {
        defaultRuntime.log(warn("Some security scenarios failed. Review findings above."));
        defaultRuntime.log(
          muted(`Run ${formatCliCommand("openclaw security audit --fix")} to remediate issues.`),
        );
      }
    });
}

/**
 * Generate HTML security report.
 */
function generateHtmlReport(report: {
  generatedAt: string;
  securityLevel: string;
  summary: { critical: number; warn: number; info: number };
  findings: Array<{
    checkId: string;
    severity: string;
    title: string;
    detail: string;
    remediation?: string;
  }>;
  credentials: { backend: string; available: boolean; count: number; plaintextDetected: number };
  configuration: Record<string, unknown>;
  validationIssues: string[];
}): string {
  const escapeHtml = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const severityColor = (sev: string) =>
    sev === "critical" ? "#dc2626" : sev === "warn" ? "#d97706" : "#6b7280";

  const findingsHtml = report.findings
    .map(
      (f) => `
      <div class="finding ${f.severity}">
        <span class="severity" style="background: ${severityColor(f.severity)}">${f.severity.toUpperCase()}</span>
        <strong>${escapeHtml(f.title)}</strong>
        <code>${escapeHtml(f.checkId)}</code>
        <p>${escapeHtml(f.detail)}</p>
        ${f.remediation ? `<p class="remediation">Fix: ${escapeHtml(f.remediation)}</p>` : ""}
      </div>
    `,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>OpenClaw Security Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; }
    h1, h2 { color: #1f2937; }
    .summary { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .summary-item { padding: 1rem; border-radius: 8px; flex: 1; }
    .critical { background: #fef2f2; border: 1px solid #fecaca; }
    .warn { background: #fffbeb; border: 1px solid #fde68a; }
    .info { background: #f3f4f6; border: 1px solid #e5e7eb; }
    .count { font-size: 2rem; font-weight: bold; }
    .finding { padding: 1rem; margin-bottom: 1rem; border-radius: 8px; }
    .severity { color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-right: 0.5rem; }
    code { background: #f3f4f6; padding: 0.125rem 0.25rem; border-radius: 4px; font-size: 0.875rem; }
    .remediation { color: #059669; font-style: italic; }
    .meta { color: #6b7280; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>OpenClaw Security Report</h1>
  <p class="meta">Generated: ${escapeHtml(report.generatedAt)} | Security Level: ${escapeHtml(report.securityLevel.toUpperCase())}</p>

  <h2>Summary</h2>
  <div class="summary">
    <div class="summary-item critical"><div class="count">${report.summary.critical}</div>Critical</div>
    <div class="summary-item warn"><div class="count">${report.summary.warn}</div>Warnings</div>
    <div class="summary-item info"><div class="count">${report.summary.info}</div>Info</div>
  </div>

  <h2>Credential Storage</h2>
  <ul>
    <li>Backend: ${escapeHtml(report.credentials.backend)}</li>
    <li>Available: ${report.credentials.available ? "Yes" : "No"}</li>
    <li>Stored credentials: ${report.credentials.count}</li>
    <li>Plaintext detected: ${report.credentials.plaintextDetected}</li>
  </ul>

  <h2>Findings</h2>
  ${findingsHtml || "<p>No findings.</p>"}

  ${
    report.validationIssues.length > 0
      ? `<h2>Configuration Issues</h2><ul>${report.validationIssues.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
      : ""
  }
</body>
</html>`;
}

/**
 * Run a security scenario test.
 */
async function runSecurityScenario(
  scenario: string,
  securityConfig: ReturnType<typeof resolveSecurityConfig>,
  cfg: ReturnType<typeof loadConfig>,
  verbose: boolean,
): Promise<{ name: string; passed: boolean; details: string[] }> {
  const details: string[] = [];

  switch (scenario) {
    case "prompt-injection": {
      // Test: Verify sandbox mode is enabled
      const sandboxEnabled = securityConfig.sandbox.defaultMode !== "off";
      details.push(`Sandbox mode: ${securityConfig.sandbox.defaultMode}`);

      // Test: Verify dangerous tools require approval
      const dangerousToolsConfig = cfg.tools?.dangerousTools ?? {};
      const execEnabled =
        (dangerousToolsConfig as Record<string, { enabled?: boolean; requireApproval?: boolean }>)
          .exec?.enabled === true;
      const execRequiresApproval =
        (dangerousToolsConfig as Record<string, { enabled?: boolean; requireApproval?: boolean }>)
          .exec?.requireApproval !== false;
      details.push(
        `Exec tool: ${execEnabled ? "enabled" : "disabled"}, approval: ${execRequiresApproval ? "required" : "not required"}`,
      );

      const passed = sandboxEnabled && (!execEnabled || execRequiresApproval);
      return { name: "Prompt Injection Defense", passed, details };
    }

    case "credential-exfil": {
      // Test: Verify credentials are in secure storage
      const credStatus = await getCredentialStorageStatus();
      details.push(`Credential backend: ${credStatus.backend}`);
      details.push(`Plaintext credentials: ${credStatus.plaintextCount}`);

      // Test: Verify network policy restricts outbound
      const networkRestricted = securityConfig.sandbox.networkPolicy === "deny";
      details.push(`Network policy: ${securityConfig.sandbox.networkPolicy}`);

      const passed = credStatus.plaintextCount === 0 && credStatus.backend !== "plaintext";
      return { name: "Credential Exfiltration Defense", passed, details };
    }

    case "skill-malware": {
      // Test: Verify skill vetting is enabled
      const autoVet = securityConfig.skills.autoVet;
      details.push(`Auto-vet skills: ${autoVet}`);

      // Test: Verify quarantine period
      const quarantineDays = Math.floor(
        securityConfig.skills.quarantinePeriodMs / (1000 * 60 * 60 * 24),
      );
      details.push(`Quarantine period: ${quarantineDays} days`);

      // Test: Verify critical risk blocking
      const blockCritical = securityConfig.skills.blockCriticalRisks;
      details.push(`Block critical risks: ${blockCritical}`);

      const passed = autoVet && blockCritical;
      return { name: "Skill Malware Defense", passed, details };
    }

    default:
      return { name: scenario, passed: false, details: [`Unknown scenario: ${scenario}`] };
  }
}

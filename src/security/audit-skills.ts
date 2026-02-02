/**
 * Skill Security Audit Checks
 *
 * Part of Phase 4.3: Skill Audit.
 * Implements GAP-24 (skills.unvetted) and GAP-25 (skills.quarantined) audit checks.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { SecurityAuditFinding } from "./audit.js";
import { resolveSecurityConfig } from "../config/security-presets.js";

// MARK: - Types

/**
 * Vetting status stored for each skill.
 */
export type SkillVettingStatus = {
  /** Whether the skill has been vetted */
  vetted: boolean;
  /** When the skill was vetted (ISO timestamp) */
  vettedAt?: string;
  /** Vetting engine version used */
  engineVersion?: string;
  /** Overall risk level from vetting */
  overallRisk?: "critical" | "high" | "medium" | "low" | "info";
  /** Whether the skill passed vetting (no critical/high risks) */
  safe?: boolean;
  /** Whether the user explicitly approved despite risks */
  userApproved?: boolean;
  /** When user approved (ISO timestamp) */
  approvedAt?: string;
};

/**
 * Quarantine status stored for each skill.
 */
export type SkillQuarantineStatus = {
  /** When the skill was installed (ISO timestamp) */
  installedAt: string;
  /** When quarantine ends (ISO timestamp) */
  quarantineEndsAt?: string;
  /** Whether quarantine has ended */
  quarantineComplete: boolean;
  /** User notified when quarantine ended */
  notified?: boolean;
};

/**
 * Combined security state for a skill.
 */
export type SkillSecurityState = {
  /** Skill name/key */
  skillKey: string;
  /** Vetting status */
  vetting?: SkillVettingStatus;
  /** Quarantine status */
  quarantine?: SkillQuarantineStatus;
};

/**
 * Storage file for skill security state.
 */
export type SkillSecurityStore = {
  /** Version of the store format */
  version: number;
  /** Last updated timestamp */
  updatedAt: string;
  /** Map of skill key to security state */
  skills: Record<string, SkillSecurityState>;
};

// MARK: - Store Operations

const STORE_VERSION = 1;
const STORE_FILENAME = "skill-security-state.json";

/**
 * Get the path to the skill security store.
 */
export function getSkillSecurityStorePath(stateDir: string): string {
  return path.join(stateDir, STORE_FILENAME);
}

/**
 * Load the skill security store from disk.
 */
export function loadSkillSecurityStore(stateDir: string): SkillSecurityStore {
  const storePath = getSkillSecurityStorePath(stateDir);
  try {
    const content = fs.readFileSync(storePath, "utf-8");
    const data = JSON.parse(content) as SkillSecurityStore;
    // Validate version
    if (typeof data.version !== "number" || data.version > STORE_VERSION) {
      // Unknown version, return empty store
      return createEmptyStore();
    }
    return data;
  } catch {
    // File doesn't exist or is invalid
    return createEmptyStore();
  }
}

/**
 * Save the skill security store to disk.
 */
export function saveSkillSecurityStore(stateDir: string, store: SkillSecurityStore): void {
  const storePath = getSkillSecurityStorePath(stateDir);
  const content = JSON.stringify(
    {
      ...store,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, content, "utf-8");
}

/**
 * Create an empty store.
 */
function createEmptyStore(): SkillSecurityStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    skills: {},
  };
}

/**
 * Get security state for a specific skill.
 */
export function getSkillSecurityState(
  store: SkillSecurityStore,
  skillKey: string,
): SkillSecurityState | undefined {
  return store.skills[skillKey];
}

/**
 * Update security state for a skill.
 */
export function updateSkillSecurityState(
  store: SkillSecurityStore,
  skillKey: string,
  update: Partial<SkillSecurityState>,
): SkillSecurityStore {
  const existing = store.skills[skillKey] ?? { skillKey };
  return {
    ...store,
    skills: {
      ...store.skills,
      [skillKey]: {
        ...existing,
        ...update,
        skillKey,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mark a skill as vetted.
 */
export function markSkillVetted(
  store: SkillSecurityStore,
  skillKey: string,
  result: {
    safe: boolean;
    overallRisk: SkillVettingStatus["overallRisk"];
    engineVersion: string;
  },
): SkillSecurityStore {
  return updateSkillSecurityState(store, skillKey, {
    vetting: {
      vetted: true,
      vettedAt: new Date().toISOString(),
      safe: result.safe,
      overallRisk: result.overallRisk,
      engineVersion: result.engineVersion,
    },
  });
}

/**
 * Mark a skill as user-approved despite risks.
 */
export function markSkillApproved(store: SkillSecurityStore, skillKey: string): SkillSecurityStore {
  const existing = store.skills[skillKey];
  if (!existing?.vetting) {
    return store;
  }
  return updateSkillSecurityState(store, skillKey, {
    vetting: {
      ...existing.vetting,
      userApproved: true,
      approvedAt: new Date().toISOString(),
    },
  });
}

/**
 * Set quarantine status for a skill.
 */
export function setSkillQuarantine(
  store: SkillSecurityStore,
  skillKey: string,
  quarantinePeriodMs: number,
): SkillSecurityStore {
  const now = new Date();
  const quarantineComplete = quarantinePeriodMs <= 0;
  const quarantineEndsAt = quarantineComplete
    ? undefined
    : new Date(now.getTime() + quarantinePeriodMs).toISOString();

  return updateSkillSecurityState(store, skillKey, {
    quarantine: {
      installedAt: now.toISOString(),
      quarantineEndsAt,
      quarantineComplete,
      notified: quarantineComplete,
    },
  });
}

/**
 * Check and update quarantine completion status.
 */
export function updateQuarantineCompletion(store: SkillSecurityStore): {
  store: SkillSecurityStore;
  completed: string[];
} {
  const now = new Date();
  const completed: string[] = [];
  let updated = store;

  for (const [skillKey, state] of Object.entries(store.skills)) {
    if (!state.quarantine) continue;
    if (state.quarantine.quarantineComplete) continue;
    if (!state.quarantine.quarantineEndsAt) continue;

    const endsAt = new Date(state.quarantine.quarantineEndsAt);
    if (now >= endsAt) {
      completed.push(skillKey);
      updated = updateSkillSecurityState(updated, skillKey, {
        quarantine: {
          ...state.quarantine,
          quarantineComplete: true,
        },
      });
    }
  }

  return { store: updated, completed };
}

// MARK: - Audit Checks

/**
 * Installed skill info for audit purposes.
 */
export type InstalledSkillInfo = {
  skillKey: string;
  name: string;
  source: "bundled" | "workspace" | "managed";
  filePath?: string;
};

/**
 * Collect skill security audit findings.
 *
 * Implements:
 * - GAP-24: skills.unvetted - Report installed skills not vetted
 * - GAP-25: skills.quarantined - Report skills in quarantine period
 */
export function collectSkillSecurityFindings(params: {
  stateDir: string;
  installedSkills: InstalledSkillInfo[];
  config?: OpenClawConfig;
}): SecurityAuditFinding[] {
  const findings: SecurityAuditFinding[] = [];
  const store = loadSkillSecurityStore(params.stateDir);
  const securityConfig = params.config ? resolveSecurityConfig(params.config.security) : undefined;
  const autoVet = securityConfig?.skills.autoVet ?? true;

  // Track counts for summary
  const unvettedSkills: string[] = [];
  const quarantinedSkills: Array<{ name: string; endsAt: string; remaining: string }> = [];
  const riskyApprovedSkills: Array<{ name: string; risk: string }> = [];

  for (const skill of params.installedSkills) {
    const state = getSkillSecurityState(store, skill.skillKey);

    // GAP-24: Check for unvetted skills
    if (!state?.vetting?.vetted) {
      unvettedSkills.push(skill.name);
    } else if (state.vetting.overallRisk === "critical" || state.vetting.overallRisk === "high") {
      // Track risky skills that were approved
      if (state.vetting.userApproved) {
        riskyApprovedSkills.push({
          name: skill.name,
          risk: state.vetting.overallRisk,
        });
      }
    }

    // GAP-25: Check for quarantined skills
    if (state?.quarantine && !state.quarantine.quarantineComplete) {
      const endsAt = state.quarantine.quarantineEndsAt;
      if (endsAt) {
        const endsDate = new Date(endsAt);
        const now = new Date();
        if (endsDate > now) {
          const remainingMs = endsDate.getTime() - now.getTime();
          const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
          const remainingStr =
            remainingHours >= 24
              ? `${Math.ceil(remainingHours / 24)} day(s)`
              : `${remainingHours} hour(s)`;
          quarantinedSkills.push({
            name: skill.name,
            endsAt: endsDate.toISOString(),
            remaining: remainingStr,
          });
        }
      }
    }
  }

  // Generate findings

  // GAP-24: Unvetted skills
  if (unvettedSkills.length > 0) {
    const severity = autoVet ? "warn" : "info";
    findings.push({
      checkId: "skills.unvetted",
      severity,
      title: `${unvettedSkills.length} installed skill(s) not vetted`,
      detail:
        `The following skills have not been vetted for security risks: ${unvettedSkills.slice(0, 5).join(", ")}` +
        (unvettedSkills.length > 5 ? ` (and ${unvettedSkills.length - 5} more)` : "") +
        ".",
      remediation: autoVet
        ? 'Run "moltbot skills audit" to vet all installed skills.'
        : 'Enable security.skills.autoVet or run "moltbot skills audit" manually.',
    });
  }

  // GAP-25: Quarantined skills
  if (quarantinedSkills.length > 0) {
    const skillList = quarantinedSkills
      .slice(0, 3)
      .map((s) => `${s.name} (${s.remaining} remaining)`)
      .join(", ");
    findings.push({
      checkId: "skills.quarantined",
      severity: "info",
      title: `${quarantinedSkills.length} skill(s) in quarantine`,
      detail:
        `The following skills are in quarantine period: ${skillList}` +
        (quarantinedSkills.length > 3 ? ` (and ${quarantinedSkills.length - 3} more)` : "") +
        ". Skills in quarantine are active but under observation.",
    });
  }

  // Risky approved skills (additional check)
  if (riskyApprovedSkills.length > 0) {
    const skillList = riskyApprovedSkills
      .slice(0, 3)
      .map((s) => `${s.name} (${s.risk})`)
      .join(", ");
    findings.push({
      checkId: "skills.risky_approved",
      severity: "warn",
      title: `${riskyApprovedSkills.length} risky skill(s) manually approved`,
      detail:
        `The following skills have ${riskyApprovedSkills.some((s) => s.risk === "critical") ? "critical" : "high"} risk findings but were manually approved: ${skillList}` +
        (riskyApprovedSkills.length > 3 ? ` (and ${riskyApprovedSkills.length - 3} more)` : "") +
        ".",
      remediation: "Review these skills periodically. Consider removing if no longer needed.",
    });
  }

  return findings;
}

/**
 * Get a summary of skill security state for status display.
 */
export function getSkillSecuritySummary(params: {
  stateDir: string;
  installedSkills: InstalledSkillInfo[];
}): {
  total: number;
  vetted: number;
  unvetted: number;
  quarantined: number;
  riskyApproved: number;
} {
  const store = loadSkillSecurityStore(params.stateDir);
  let vetted = 0;
  let unvetted = 0;
  let quarantined = 0;
  let riskyApproved = 0;

  for (const skill of params.installedSkills) {
    const state = getSkillSecurityState(store, skill.skillKey);

    if (!state?.vetting?.vetted) {
      unvetted++;
    } else {
      vetted++;
      if (
        state.vetting.userApproved &&
        (state.vetting.overallRisk === "critical" || state.vetting.overallRisk === "high")
      ) {
        riskyApproved++;
      }
    }

    if (state?.quarantine && !state.quarantine.quarantineComplete) {
      const endsAt = state.quarantine.quarantineEndsAt;
      if (endsAt && new Date(endsAt) > new Date()) {
        quarantined++;
      }
    }
  }

  return {
    total: params.installedSkills.length,
    vetted,
    unvetted,
    quarantined,
    riskyApproved,
  };
}

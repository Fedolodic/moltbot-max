/**
 * Zod schema for security configuration.
 * Part of Phase 1: Security Hardening by Default.
 */

import { z } from "zod";

export const SecurityCredentialsSchema = z
  .object({
    store: z.enum(["keychain", "encrypted-file", "plaintext"]).optional(),
    rotationReminderDays: z.number().int().positive().optional(),
    backupBeforeMigration: z.boolean().optional(),
  })
  .strict()
  .optional();

export const SecurityAuditSchema = z
  .object({
    runOnStart: z.boolean().optional(),
    blockOnCritical: z.boolean().optional(),
    logFindings: z.boolean().optional(),
    alertWebhook: z.string().url().optional(),
  })
  .strict()
  .optional();

export const SecurityGatewaySchema = z
  .object({
    requireAuthForLoopback: z.boolean().optional(),
    minTokenLength: z.number().int().min(16).max(128).optional(),
    autoGenerateToken: z.boolean().optional(),
    warnOnInsecureBind: z.boolean().optional(),
  })
  .strict()
  .optional();

export const SecuritySandboxSchema = z
  .object({
    defaultMode: z.enum(["off", "non-main", "all"]).optional(),
    networkPolicy: z.enum(["allow", "deny"]).optional(),
    networkAllowlist: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export const SecuritySkillsSchema = z
  .object({
    requireAllowlist: z.boolean().optional(),
    autoVet: z.boolean().optional(),
    blockCriticalRisks: z.boolean().optional(),
    quarantinePeriodMs: z.number().int().nonnegative().optional(),
    requireSignature: z.enum(["none", "official", "any"]).optional(),
  })
  .strict()
  .optional();

export const SecuritySchema = z
  .object({
    level: z.enum(["standard", "hardened", "paranoid"]).optional(),
    credentials: SecurityCredentialsSchema,
    audit: SecurityAuditSchema,
    gateway: SecurityGatewaySchema,
    sandbox: SecuritySandboxSchema,
    skills: SecuritySkillsSchema,
  })
  .strict()
  .optional();

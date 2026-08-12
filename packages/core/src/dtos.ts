import { z } from 'zod';

import { AppSettingsSchema } from './settings';

export const WorkerModeSchema = z.enum(['DESKTOP_SPAWNED', 'SCHEDULED', 'DIRECT']);

export const WorkerHealthSchema = z
  .object({
    status: z.literal('READY'),
    instanceId: z.string().uuid(),
    mode: WorkerModeSchema,
    startedAt: z.string().datetime(),
    uptimeMs: z.number().int().nonnegative(),
  })
  .strict();

export const ApplicationInfoSchema = z
  .object({
    name: z.literal('YouTube Backup Manager'),
    version: z.string().min(1),
    environment: z.enum(['development', 'production', 'test']),
    platform: z.string().min(1),
    arch: z.string().min(1),
  })
  .strict();

export const DatabaseHealthSchema = z
  .object({
    status: z.literal('READY'),
    schemaVersion: z.number().int().nonnegative(),
    foreignKeysEnabled: z.literal(true),
    journalMode: z.string().min(1),
  })
  .strict();

export const FoundationStatusSchema = z
  .object({
    worker: WorkerHealthSchema,
    application: ApplicationInfoSchema,
    database: DatabaseHealthSchema,
    settings: AppSettingsSchema,
  })
  .strict();

export type WorkerMode = z.infer<typeof WorkerModeSchema>;
export type WorkerHealth = z.infer<typeof WorkerHealthSchema>;
export type ApplicationInfo = z.infer<typeof ApplicationInfoSchema>;
export type DatabaseHealth = z.infer<typeof DatabaseHealthSchema>;
export type FoundationStatus = z.infer<typeof FoundationStatusSchema>;

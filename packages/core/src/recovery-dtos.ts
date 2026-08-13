import { z } from 'zod';

import {
  RecoverySessionStatusSchema,
  RecoverySourceStatusSchema,
  RecoverySourceTypeSchema,
  RecoveryWarningCodeSchema,
} from './enums';

const EpochMillisecondsSchema = z.number().int().nonnegative();

export const RecoveryCountsSchema = z
  .object({
    channels: z.number().int().nonnegative(),
    media: z.number().int().nonnegative(),
    playlists: z.number().int().nonnegative(),
    copies: z.number().int().nonnegative(),
    localCopies: z.number().int().nonnegative(),
    driveCopies: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  })
  .strict();

export const RecoverySourceDtoSchema = z
  .object({
    id: z.string().uuid(),
    sourceType: RecoverySourceTypeSchema,
    status: RecoverySourceStatusSchema,
    label: z.string().min(1).max(1_024),
    rootPath: z.string().min(1).max(1_024).nullable(),
    accountId: z.string().uuid().nullable(),
    accountEmail: z.string().email().nullable(),
    discoveredRootCount: z.number().int().nonnegative(),
    driveRoots: z.array(
      z
        .object({
          providerRootId: z.string().min(3).max(500),
          name: z.string().min(1).max(1_024),
          selected: z.boolean(),
        })
        .strict(),
    ),
    safeMessage: z.string().min(1).max(500).nullable(),
  })
  .strict();

export const RecoveryWarningDtoSchema = z
  .object({
    id: z.string().uuid(),
    code: RecoveryWarningCodeSchema,
    sourceId: z.string().uuid().nullable(),
    entityKey: z.string().max(500).nullable(),
    safeMessage: z.string().min(1).max(500),
    createdAt: EpochMillisecondsSchema,
  })
  .strict();

export const RecoveryProgressSchema = z
  .object({
    phase: z.enum(['SOURCES', 'LOCAL_SCAN', 'DRIVE_LIST', 'DRIVE_SIDECARS', 'IMPORT', 'FTS']),
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const RecoverySessionDtoSchema = z
  .object({
    id: z.string().uuid(),
    status: RecoverySessionStatusSchema,
    sources: z.array(RecoverySourceDtoSchema),
    counts: RecoveryCountsSchema,
    warnings: z.array(RecoveryWarningDtoSchema).max(200),
    progress: RecoveryProgressSchema.nullable(),
    safeMessage: z.string().min(1).max(500).nullable(),
    createdAt: EpochMillisecondsSchema,
    updatedAt: EpochMillisecondsSchema,
    completedAt: EpochMillisecondsSchema.nullable(),
  })
  .strict();

export const RecoverySessionResultSchema = z.object({ session: RecoverySessionDtoSchema }).strict();

export type RecoveryCounts = z.infer<typeof RecoveryCountsSchema>;
export type RecoverySourceDto = z.infer<typeof RecoverySourceDtoSchema>;
export type RecoveryWarningDto = z.infer<typeof RecoveryWarningDtoSchema>;
export type RecoveryProgress = z.infer<typeof RecoveryProgressSchema>;
export type RecoverySessionDto = z.infer<typeof RecoverySessionDtoSchema>;

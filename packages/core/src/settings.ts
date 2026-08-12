import { z } from 'zod';

import { QualityProfileSchema } from './enums';

export const NotificationSettingsSchema = z
  .object({
    backupComplete: z.boolean(),
    backupErrors: z.boolean(),
    destinationDisconnected: z.boolean(),
    authenticationRequired: z.boolean(),
    integrityProblems: z.boolean(),
  })
  .strict();

export const AppSettingsSchema = z
  .object({
    startWithWindows: z.boolean(),
    startMinimized: z.boolean(),
    checkForUpdates: z.boolean(),
    defaultQualityProfile: QualityProfileSchema,
    concurrentDownloads: z.number().int().min(1).max(8),
    concurrentLocalCopies: z.number().int().min(1).max(8),
    concurrentDriveUploads: z.number().int().min(1).max(8),
    notifications: NotificationSettingsSchema,
  })
  .strict();

export const SettingsPatchSchema = AppSettingsSchema.partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required');

export const RendererSettingsPatchSchema = z
  .object({
    startMinimized: z.boolean().optional(),
    defaultQualityProfile: QualityProfileSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required');

export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export type RendererSettingsPatch = z.infer<typeof RendererSettingsPatchSchema>;

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  startWithWindows: false,
  startMinimized: false,
  checkForUpdates: true,
  defaultQualityProfile: 'MAX_1080P',
  concurrentDownloads: 2,
  concurrentLocalCopies: 2,
  concurrentDriveUploads: 2,
  notifications: Object.freeze({
    backupComplete: true,
    backupErrors: true,
    destinationDisconnected: true,
    authenticationRequired: true,
    integrityProblems: true,
  }),
});

export interface SettingsRepository {
  readApplicationSettings(): Promise<unknown | null>;
  writeApplicationSettings(value: AppSettings, updatedAt: number): Promise<void>;
}

function normalizeLegacyQualityProfile(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const settings = { ...value } as Record<string, unknown>;
  const legacyProfiles: Readonly<Record<string, string>> = {
    UP_TO_4K: 'MAX_4K',
    UP_TO_1080P: 'MAX_1080P',
    UP_TO_720P: 'MAX_720P',
  };
  const profile = settings.defaultQualityProfile;
  if (typeof profile === 'string' && legacyProfiles[profile] !== undefined) {
    settings.defaultQualityProfile = legacyProfiles[profile];
  }
  return settings;
}

export class SettingsService {
  public constructor(
    private readonly repository: SettingsRepository,
    private readonly now: () => number = Date.now,
  ) {}

  public async get(): Promise<AppSettings> {
    const stored = await this.repository.readApplicationSettings();
    if (stored === null) {
      return AppSettingsSchema.parse(DEFAULT_APP_SETTINGS);
    }

    return AppSettingsSchema.parse(normalizeLegacyQualityProfile(stored));
  }

  public async update(patchInput: unknown): Promise<AppSettings> {
    const patch = SettingsPatchSchema.parse(patchInput);
    const current = await this.get();
    const updated = AppSettingsSchema.parse({
      ...current,
      ...patch,
      notifications: patch.notifications ?? current.notifications,
    });

    await this.repository.writeApplicationSettings(updated, this.now());
    return updated;
  }
}

import { randomUUID } from 'node:crypto';

import {
  AccountDtoSchema,
  SourceErrorCodeSchema,
  type AccountConnectionState,
  type AccountDto,
  type DriveCapabilityState,
  type SourceErrorCode,
} from '@ytbm/core';

import type {
  ConnectedGoogleAccountInput,
  GoogleAccountPersistence,
  GoogleAccountRecord,
} from '@ytbm/source-youtube';

import type { WorkerDatabase } from '../database';

interface AccountRow {
  id: string;
  provider: string;
  provider_account_id: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  credential_ref: string;
  drive_credential_ref: string | null;
  capabilities_json: string;
  connection_state: string;
  connected_at: number;
  last_auth_at: number | null;
  last_error_code: string | null;
}

function parseErrorCode(value: string | null): SourceErrorCode | null {
  if (value === null) return null;
  const parsed = SourceErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'INTERNAL_ERROR';
}

function toDto(row: AccountRow): AccountDto {
  const stored = JSON.parse(row.capabilities_json) as Record<string, unknown>;
  const driveFile = stored.driveFile === true;
  const capabilities = {
    youtubeReadonly: stored.youtubeReadonly === true,
    driveFile,
    driveConnectionState:
      stored.driveConnectionState === 'REAUTH_REQUIRED'
        ? 'REAUTH_REQUIRED'
        : driveFile
          ? 'CONNECTED'
          : 'AUTHORIZATION_REQUIRED',
    grantedScopes: Array.isArray(stored.grantedScopes) ? stored.grantedScopes : [],
  };
  return AccountDtoSchema.parse({
    id: row.id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    connectionState: row.connection_state,
    capabilities,
    connectedAt: row.connected_at,
    lastAuthAt: row.last_auth_at,
    lastErrorCode: parseErrorCode(row.last_error_code),
  });
}

const SELECT_COLUMNS = `
  id, provider, provider_account_id, email, display_name, avatar_url, credential_ref,
  drive_credential_ref,
  capabilities_json, connection_state, connected_at, last_auth_at, last_error_code
`;

export class DrizzleGoogleAccountRepository implements GoogleAccountPersistence {
  public constructor(private readonly database: WorkerDatabase) {}

  public async listAccounts(): Promise<AccountDto[]> {
    const rows = this.database.sqlite
      .prepare(`select ${SELECT_COLUMNS} from accounts order by connected_at asc, id asc`)
      .all() as AccountRow[];
    return rows.map(toDto);
  }

  public async findByProviderAccountId(
    providerAccountId: string,
  ): Promise<GoogleAccountRecord | null> {
    const row = this.database.sqlite
      .prepare(
        `select id, provider_account_id, credential_ref, drive_credential_ref,
          connection_state, capabilities_json
         from accounts where provider = 'GOOGLE' and provider_account_id = ?`,
      )
      .get(providerAccountId) as
      | {
          id: string;
          provider_account_id: string;
          credential_ref: string;
          drive_credential_ref: string | null;
          connection_state: AccountConnectionState;
          capabilities_json: string;
        }
      | undefined;
    return row === undefined
      ? null
      : {
          id: row.id,
          providerAccountId: row.provider_account_id,
          credentialRef: row.credential_ref,
          driveCredentialRef: row.drive_credential_ref,
          connectionState: row.connection_state,
          driveConnectionState: this.driveState(row.capabilities_json),
        };
  }

  public async getAccountRecord(accountId: string): Promise<GoogleAccountRecord | null> {
    const row = this.database.sqlite
      .prepare(
        `select id, provider_account_id, credential_ref, drive_credential_ref,
          connection_state, capabilities_json
         from accounts where id = ? and provider = 'GOOGLE'`,
      )
      .get(accountId) as
      | {
          id: string;
          provider_account_id: string | null;
          credential_ref: string;
          drive_credential_ref: string | null;
          connection_state: AccountConnectionState;
          capabilities_json: string;
        }
      | undefined;
    if (row === undefined || row.provider_account_id === null) return null;
    return {
      id: row.id,
      providerAccountId: row.provider_account_id,
      credentialRef: row.credential_ref,
      driveCredentialRef: row.drive_credential_ref,
      connectionState: row.connection_state,
      driveConnectionState: this.driveState(row.capabilities_json),
    };
  }

  public async upsertConnectedAccount(input: ConnectedGoogleAccountInput): Promise<AccountDto> {
    const existing = await this.findByProviderAccountId(input.providerAccountId);
    if (input.capability === 'GOOGLE_DRIVE' && existing === null) {
      throw new Error('Drive authorization must match an existing Google account');
    }
    const id = existing?.id ?? randomUUID();
    const previousCapabilities =
      existing === null
        ? null
        : (JSON.parse(
            (
              this.database.sqlite
                .prepare('select capabilities_json from accounts where id = ?')
                .get(id) as { capabilities_json: string }
            ).capabilities_json,
          ) as Record<string, unknown>);
    const capabilitiesJson = JSON.stringify({
      youtubeReadonly:
        input.grantedScopes.includes('https://www.googleapis.com/auth/youtube.readonly') ||
        previousCapabilities?.youtubeReadonly === true,
      driveFile:
        input.grantedScopes.includes('https://www.googleapis.com/auth/drive.file') ||
        previousCapabilities?.driveFile === true,
      driveConnectionState:
        input.capability === 'GOOGLE_DRIVE'
          ? 'CONNECTED'
          : (previousCapabilities?.driveConnectionState ?? 'AUTHORIZATION_REQUIRED'),
      driveLastErrorCode:
        input.capability === 'GOOGLE_DRIVE'
          ? null
          : (previousCapabilities?.driveLastErrorCode ?? null),
      grantedScopes: [
        ...new Set([
          ...(Array.isArray(previousCapabilities?.grantedScopes)
            ? previousCapabilities.grantedScopes.filter(
                (scope): scope is string => typeof scope === 'string',
              )
            : []),
          ...input.grantedScopes,
        ]),
      ].sort(),
    });
    const transaction = this.database.sqlite.transaction(() => {
      if (existing === null) {
        this.database.sqlite
          .prepare(
            `insert into accounts (
              id, provider, provider_account_id, email, display_name, avatar_url,
              credential_ref, drive_credential_ref, capabilities_json, connection_state, connected_at, last_auth_at,
              last_error_code, last_error_at, created_at, updated_at
            ) values (?, 'GOOGLE', ?, ?, ?, ?, ?, null, ?, 'CONNECTED', ?, ?, null, null, ?, ?)`,
          )
          .run(
            id,
            input.providerAccountId,
            input.email,
            input.displayName,
            input.avatarUrl,
            input.credentialRef,
            capabilitiesJson,
            input.connectedAt,
            input.connectedAt,
            input.connectedAt,
            input.connectedAt,
          );
      } else {
        this.database.sqlite
          .prepare(
            `update accounts set
              email = ?, display_name = ?, avatar_url = ?,
              credential_ref = case when ? = 'YOUTUBE' then ? else credential_ref end,
              drive_credential_ref = case when ? = 'GOOGLE_DRIVE' then ? else drive_credential_ref end,
              capabilities_json = ?,
              connection_state = case when ? = 'YOUTUBE' then 'CONNECTED' else connection_state end,
              last_auth_at = ?,
              last_error_code = case when ? = 'YOUTUBE' then null else last_error_code end,
              last_error_at = case when ? = 'YOUTUBE' then null else last_error_at end,
              updated_at = ?
             where id = ?`,
          )
          .run(
            input.email,
            input.displayName,
            input.avatarUrl,
            input.capability,
            input.credentialRef,
            input.capability,
            input.credentialRef,
            capabilitiesJson,
            input.capability,
            input.connectedAt,
            input.capability,
            input.capability,
            input.connectedAt,
            id,
          );
      }
    });
    transaction();
    return this.getDto(id);
  }

  public async setAccountConnectionState(
    accountId: string,
    state: AccountConnectionState,
    errorCode: SourceErrorCode | null,
    changedAt: number,
  ): Promise<AccountDto> {
    const result = this.database.sqlite
      .prepare(
        `update accounts set connection_state = ?, last_error_code = ?, last_error_at = ?,
          last_auth_at = case when ? = 'CONNECTED' then ? else last_auth_at end,
          updated_at = ? where id = ? and provider = 'GOOGLE'`,
      )
      .run(
        state,
        errorCode,
        errorCode === null ? null : changedAt,
        state,
        changedAt,
        changedAt,
        accountId,
      );
    if (result.changes !== 1) throw new Error('Google account was not found');
    return this.getDto(accountId);
  }

  public async setDriveCapabilityState(
    accountId: string,
    state: DriveCapabilityState,
    errorCode: SourceErrorCode | null,
    changedAt: number,
  ): Promise<AccountDto> {
    const row = this.database.sqlite
      .prepare("select capabilities_json from accounts where id = ? and provider = 'GOOGLE'")
      .get(accountId) as { capabilities_json: string } | undefined;
    if (row === undefined) throw new Error('Google account was not found');
    const capabilities = JSON.parse(row.capabilities_json) as Record<string, unknown>;
    capabilities.driveConnectionState = state;
    capabilities.driveFile = state !== 'AUTHORIZATION_REQUIRED';
    capabilities.driveLastErrorCode = errorCode;
    capabilities.driveLastErrorAt = errorCode === null ? null : changedAt;
    this.database.sqlite
      .prepare(
        `update accounts set capabilities_json = ?, updated_at = ?
         where id = ? and provider = 'GOOGLE'`,
      )
      .run(JSON.stringify(capabilities), changedAt, accountId);
    return this.getDto(accountId);
  }

  private async getDto(accountId: string): Promise<AccountDto> {
    const row = this.database.sqlite
      .prepare(`select ${SELECT_COLUMNS} from accounts where id = ?`)
      .get(accountId) as AccountRow | undefined;
    if (row === undefined) throw new Error('Google account was not found');
    return toDto(row);
  }

  private driveState(capabilitiesJson: string): DriveCapabilityState {
    const capabilities = JSON.parse(capabilitiesJson) as Record<string, unknown>;
    if (capabilities.driveConnectionState === 'REAUTH_REQUIRED') return 'REAUTH_REQUIRED';
    return capabilities.driveFile === true ? 'CONNECTED' : 'AUTHORIZATION_REQUIRED';
  }
}

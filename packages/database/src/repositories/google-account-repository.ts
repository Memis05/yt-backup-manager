import { randomUUID } from 'node:crypto';

import {
  AccountDtoSchema,
  SourceErrorCodeSchema,
  type AccountConnectionState,
  type AccountDto,
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
  const capabilities = JSON.parse(row.capabilities_json) as unknown;
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
        `select id, provider_account_id, credential_ref, connection_state
         from accounts where provider = 'GOOGLE' and provider_account_id = ?`,
      )
      .get(providerAccountId) as
      | {
          id: string;
          provider_account_id: string;
          credential_ref: string;
          connection_state: AccountConnectionState;
        }
      | undefined;
    return row === undefined
      ? null
      : {
          id: row.id,
          providerAccountId: row.provider_account_id,
          credentialRef: row.credential_ref,
          connectionState: row.connection_state,
        };
  }

  public async getAccountRecord(accountId: string): Promise<GoogleAccountRecord | null> {
    const row = this.database.sqlite
      .prepare(
        `select id, provider_account_id, credential_ref, connection_state
         from accounts where id = ? and provider = 'GOOGLE'`,
      )
      .get(accountId) as
      | {
          id: string;
          provider_account_id: string | null;
          credential_ref: string;
          connection_state: AccountConnectionState;
        }
      | undefined;
    if (row === undefined || row.provider_account_id === null) return null;
    return {
      id: row.id,
      providerAccountId: row.provider_account_id,
      credentialRef: row.credential_ref,
      connectionState: row.connection_state,
    };
  }

  public async upsertConnectedAccount(input: ConnectedGoogleAccountInput): Promise<AccountDto> {
    const existing = await this.findByProviderAccountId(input.providerAccountId);
    const id = existing?.id ?? randomUUID();
    const capabilitiesJson = JSON.stringify({
      youtubeReadonly: input.grantedScopes.includes(
        'https://www.googleapis.com/auth/youtube.readonly',
      ),
      grantedScopes: [...new Set(input.grantedScopes)].sort(),
    });
    const transaction = this.database.sqlite.transaction(() => {
      if (existing === null) {
        this.database.sqlite
          .prepare(
            `insert into accounts (
              id, provider, provider_account_id, email, display_name, avatar_url,
              credential_ref, capabilities_json, connection_state, connected_at, last_auth_at,
              last_error_code, last_error_at, created_at, updated_at
            ) values (?, 'GOOGLE', ?, ?, ?, ?, ?, ?, 'CONNECTED', ?, ?, null, null, ?, ?)`,
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
              email = ?, display_name = ?, avatar_url = ?, credential_ref = ?,
              capabilities_json = ?, connection_state = 'CONNECTED', last_auth_at = ?,
              last_error_code = null, last_error_at = null, updated_at = ?
             where id = ?`,
          )
          .run(
            input.email,
            input.displayName,
            input.avatarUrl,
            input.credentialRef,
            capabilitiesJson,
            input.connectedAt,
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

  private async getDto(accountId: string): Promise<AccountDto> {
    const row = this.database.sqlite
      .prepare(`select ${SELECT_COLUMNS} from accounts where id = ?`)
      .get(accountId) as AccountRow | undefined;
    if (row === undefined) throw new Error('Google account was not found');
    return toDto(row);
  }
}

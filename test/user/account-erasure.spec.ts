import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { AccountErasureService } from '../../src/user/providers/account-erasure.service.js';

interface FakeMetadata {
  tableName: string;
  columns: { databaseName: string }[];
}

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function table(tableName: string, columnNames: string[]): FakeMetadata {
  return { tableName, columns: columnNames.map((databaseName) => ({ databaseName })) };
}

function buildService(metadata: FakeMetadata[], queries: RecordedQuery[]) {
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    queries.push({ sql, params });
  });
  const dataSource = {
    entityMetadatas: metadata,
    transaction: async (run: (manager: { query: typeof query }) => Promise<void>) => run({ query }),
  } as unknown as DataSource;
  return new AccountErasureService(dataSource);
}

describe('AF-587 账号硬擦除归属列覆盖', () => {
  it('uid / user_id / *_uid 都删除，保留表与 users 跳过，用户表最后删', async () => {
    const queries: RecordedQuery[] = [];
    const service = buildService(
      [
        table('users', ['uid']),
        table('audit_logs', ['user_id']),
        table('user_profiles', ['uid']),
        table('sessions', ['user_id']),
        table('companion_bindings', ['owner_uid', 'companion_uid']),
        table('feature_flags', ['name']),
        table('payments', ['uid', 'user_id']),
        table('companion_records', ['companion_uid', 'companion_to_uid']),
        table('tree_water_logs', ['actor_user_id']),
        table('companion_trees', ['owner_a_id', 'owner_b_id']),
        table('drift_bottle_entries', ['picked_by_user_id']),
      ],
      queries,
    );

    const deletedTables = await service.erase('uid-1');

    expect(deletedTables).toBe(8);
    expect(queries.map((query) => query.sql)).toEqual([
      'DELETE FROM `user_profiles` WHERE `uid` = ?',
      'DELETE FROM `sessions` WHERE `user_id` = ?',
      'DELETE FROM `companion_bindings` WHERE `owner_uid` = ?',
      'DELETE FROM `companion_bindings` WHERE `companion_uid` = ?',
      'DELETE FROM `payments` WHERE `uid` = ?',
      'DELETE FROM `payments` WHERE `user_id` = ?',
      'DELETE FROM `companion_records` WHERE `companion_uid` = ?',
      'DELETE FROM `companion_records` WHERE `companion_to_uid` = ?',
      'DELETE FROM `tree_water_logs` WHERE `actor_user_id` = ?',
      'DELETE FROM `companion_trees` WHERE `owner_a_id` = ?',
      'DELETE FROM `companion_trees` WHERE `owner_b_id` = ?',
      'DELETE FROM `drift_bottle_entries` WHERE `picked_by_user_id` = ?',
      'DELETE FROM `users` WHERE `uid` = ?',
    ]);
    expect(queries.every((query) => query.params.length === 1 && query.params[0] === 'uid-1')).toBe(true);
  });

  it('同一列重复出现只删一次，不重复计表', async () => {
    const queries: RecordedQuery[] = [];
    const service = buildService([table('duplicate_uid_table', ['uid', 'uid'])], queries);

    const deletedTables = await service.erase('uid-2');

    expect(deletedTables).toBe(1);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.sql).toBe('DELETE FROM `duplicate_uid_table` WHERE `uid` = ?');
    expect(queries[1]?.sql).toBe('DELETE FROM `users` WHERE `uid` = ?');
  });

  it('provider_user_id 是第三方用户 id，不按本站 uid 删除', async () => {
    const queries: RecordedQuery[] = [];
    const service = buildService(
      [table('oauth_identities', ['user_id', 'provider_user_id']), table('provider_only', ['provider_user_id'])],
      queries,
    );

    const deletedTables = await service.erase('uid-2');

    expect(deletedTables).toBe(1);
    expect(queries.map((query) => query.sql)).toEqual([
      'DELETE FROM `oauth_identities` WHERE `user_id` = ?',
      'DELETE FROM `users` WHERE `uid` = ?',
    ]);
  });

  it('无归属列的表不产生删除，仍会删 users', async () => {
    const queries: RecordedQuery[] = [];
    const service = buildService([table('feature_flags', ['name'])], queries);

    const deletedTables = await service.erase('uid-3');

    expect(deletedTables).toBe(0);
    expect(queries).toEqual([{ sql: 'DELETE FROM `users` WHERE `uid` = ?', params: ['uid-3'] }]);
  });

  it('单表删除失败时异常向上抛出，不吞错', async () => {
    const dataSource = {
      entityMetadatas: [table('user_profiles', ['uid'])],
      transaction: async (run: (manager: { query: () => Promise<void> }) => Promise<void>) =>
        run({
          query: async () => {
            throw new Error('deadlock');
          },
        }),
    } as unknown as DataSource;

    await expect(new AccountErasureService(dataSource).erase('uid-4')).rejects.toThrow('deadlock');
  });
});

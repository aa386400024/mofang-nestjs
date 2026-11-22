// V2026-11-22 (AF-313 · 隐私护栏):
//   `admin_debug_sessions.record_json` 含双方对话原文. TypeORM 的慢查询 / query 日志
//   会把 SQL 参数原样打出来 —— 200KB 的 upsert 在远程库上超过 1s 就会触发.
//   本护栏把该表的日志参数替换为固定占位, 其余 SQL 日志原样委托.
//
//   适用: 应用进程的共享 DataSource (import CLI 自己用 logging:false + maxQueryExecutionTime:0).

import type { DataSource, Logger as TypeOrmLogger, QueryRunner } from 'typeorm';

const PROTECTED_TABLE = 'admin_debug_sessions';
const REDACTED = '[redacted:admin_debug_sessions]';
/** TypeORM 查询参数类型. */
type QueryParameters = Parameters<TypeOrmLogger['logQuery']>[1];

/** 已包裹过的 DataSource (避免重复套娃). */
const GUARDED = new WeakSet<DataSource>();

/**
 * SQL 是否触碰受保护表.
 *
 * @param query SQL 文本
 * @returns 是否触碰
 */
function touchesProtectedTable(query: string): boolean {
  return query.toLowerCase().includes(PROTECTED_TABLE);
}

/**
 * 参数脱敏.
 *
 * @returns 固定占位
 */
function redactedParameters(): QueryParameters {
  return [REDACTED];
}

/**
 * 给共享 DataSource 的 logger 套一层脱敏护栏.
 *
 * 只替换参数, 不改 SQL 结构与日志级别; 非受保护表的行为逐字不变.
 *
 * @param dataSource 应用共享数据源
 */
export function guardSensitiveDebugQueryLogging(dataSource: DataSource): void {
  if (GUARDED.has(dataSource)) return;
  // 测试替身可能没有 logger; 运行时 DataSource 一定有.
  const inner = (dataSource as unknown as { logger?: TypeOrmLogger }).logger;
  if (!inner) return;
  GUARDED.add(dataSource);

  const guarded: TypeOrmLogger = {
    logQuery(query: string, parameters?: QueryParameters, queryRunner?: QueryRunner) {
      return inner.logQuery(query, touchesProtectedTable(query) ? redactedParameters() : parameters, queryRunner);
    },
    logQueryError(error: string | Error, query: string, parameters?: QueryParameters, queryRunner?: QueryRunner) {
      return inner.logQueryError(error, query, touchesProtectedTable(query) ? redactedParameters() : parameters, queryRunner);
    },
    logQuerySlow(time: number, query: string, parameters?: QueryParameters, queryRunner?: QueryRunner) {
      return inner.logQuerySlow(time, query, touchesProtectedTable(query) ? redactedParameters() : parameters, queryRunner);
    },
    logSchemaBuild(message: string, queryRunner?: QueryRunner) {
      return inner.logSchemaBuild(message, queryRunner);
    },
    logMigration(message: string, queryRunner?: QueryRunner) {
      return inner.logMigration(message, queryRunner);
    },
    log(level: 'log' | 'info' | 'warn', message: unknown, queryRunner?: QueryRunner) {
      return inner.log(level, message, queryRunner);
    },
  };

  dataSource.logger = guarded;
}

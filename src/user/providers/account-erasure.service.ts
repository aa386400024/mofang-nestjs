import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 账号数据擦除服务（AF-537 P0-9）。
 *
 * 设计：
 *   - 从 TypeORM metadata 枚举所有带 `uid` / `user_id` 列的实体表，按当前 uid 删除。
 *   - 避免手写 40+ 张表清单漏表；新增实体只要列名符合约定就自动纳入。
 *   - `audit_logs` 保留（合规审计留痕），其余心理 / 业务数据全部擦除。
 *   - 在单事务内先删子表、最后删 `users`，失败整体回滚，不允许“删一半”。
 */
const RETAINED_TABLES = new Set(['audit_logs']);

@Injectable()
export class AccountErasureService {
  private readonly logger = new Logger(AccountErasureService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 硬擦除一个账号的全部个人数据。
   *
   * @param uid 用户 uid
   * @returns 被删除的表数量（不含 users）
   */
  async erase(uid: string): Promise<number> {
    let deletedTables = 0;
    await this.dataSource.transaction(async (manager) => {
      for (const metadata of this.dataSource.entityMetadatas) {
        if (metadata.tableName === 'users' || RETAINED_TABLES.has(metadata.tableName)) {
          continue;
        }
        const column = metadata.columns.find((c) => c.databaseName === 'uid' || c.databaseName === 'user_id');
        if (!column) {
          continue;
        }
        await manager.query(`DELETE FROM \`${metadata.tableName}\` WHERE \`${column.databaseName}\` = ?`, [uid]);
        deletedTables += 1;
      }
      await manager.query('DELETE FROM `users` WHERE `uid` = ?', [uid]);
    });
    this.logger.log(`account erased: uid=${uid}, tables=${deletedTables}`);
    return deletedTables;
  }
}

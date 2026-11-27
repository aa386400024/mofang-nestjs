import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 账号数据擦除服务（AF-537 P0-9）。
 *
 * 设计：
 *   - 从 TypeORM metadata 枚举所有带用户归属列的实体表，按当前 uid 删除。
 *   - 避免手写 40+ 张表清单漏表；新增实体只要列名符合约定就自动纳入。
 *   - `audit_logs` 保留（合规审计留痕），其余心理 / 业务数据全部擦除。
 *   - 在单事务内逐表删除、最后删 `users`，失败整体回滚，不允许“删一半”。
 */
const RETAINED_TABLES = new Set(['audit_logs']);

/** 直接以用户 id 命名的归属列. */
const DIRECT_OWNER_COLUMNS = new Set(['uid', 'user_id']);

/** 不以 `_uid` / `_user_id` 结尾、但明确指向本站用户的关系列. */
const RELATION_OWNER_COLUMNS = new Set(['owner_a_id', 'owner_b_id']);

/** 名字像用户 id、实际是第三方用户的列；不能拿本站 uid 去匹配. */
const EXTERNAL_USER_COLUMNS = new Set(['provider_user_id']);

/**
 * 判断某列是否是"这条记录属于谁"的用户归属列.
 *
 * 为什么不能只认 uid / user_id: 陪伴域用 owner_uid / companion_uid /
 * companion_to_uid、舒缓卡用 from_uid / to_uid、康复项用 owner_uid +
 * companion_uid、双人树用 owner_a_id / owner_b_id、行为日志用
 * actor_user_id / picked_by_user_id —— 这些表在账号硬擦除时同样必须清空，
 * 否则用户删除账号后关系型心理数据仍留在库里（GDPR / 个保法口径的漏删）.
 *
 * 为什么排除 provider_user_id: 它是 OAuth 第三方的用户 id，不是本站 uid；
 * 泛化匹配会制造错误的删除语义.
 *
 * @param columnName 数据库列名（来自 TypeORM metadata，不可由外部输入）
 * @returns 是用户归属列
 */
function isUserOwnershipColumn(columnName: string): boolean {
  if (EXTERNAL_USER_COLUMNS.has(columnName)) return false;
  return (
    DIRECT_OWNER_COLUMNS.has(columnName) ||
    RELATION_OWNER_COLUMNS.has(columnName) ||
    columnName.endsWith('_uid') ||
    columnName.endsWith('_user_id')
  );
}

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
   * 归属列识别为 uid / user_id / 任意 `*_uid`（多用户关系表按列逐一删除）.
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
        const ownershipColumns = [
          ...new Set(metadata.columns.map((column) => column.databaseName).filter((columnName) => isUserOwnershipColumn(columnName))),
        ];
        if (ownershipColumns.length === 0) {
          continue;
        }
        for (const columnName of ownershipColumns) {
          await manager.query(`DELETE FROM \`${metadata.tableName}\` WHERE \`${columnName}\` = ?`, [uid]);
        }
        deletedTables += 1;
      }
      await manager.query('DELETE FROM `users` WHERE `uid` = ?', [uid]);
    });
    this.logger.log(`account erased: uid=${uid}, tables=${deletedTables}`);
    return deletedTables;
  }
}

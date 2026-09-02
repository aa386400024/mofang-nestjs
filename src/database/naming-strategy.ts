import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

/**
 * 全局命名策略 — 治本: 让 TypeORM 默认 join 列名稳定为 snake_case,
 * 避免驼峰(userUid)污染数据库.
 *
 * 默认行为:
 *   @ManyToOne(() => User) 关联 User.uid
 *   → joinColumnName = "User" + "uid" = "Useruid" → mysql "userUid" ❌
 *
 * 我们的期望:
 *   → joinColumnName = snake_case("User_uid") = "user_uid"
 *
 * ⚠️ 注意: 这个策略只兜底默认行为. 已有实体必须显式 @JoinColumn({ name: 'user_id' })
 * 来锁定列名, 跟数据库实际 schema 对齐 (列名是 user_id, 不是 user_uid).
 */
export class AppNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return `${relationName}_${referencedColumnName}`.toLowerCase();
  }

  override joinTableColumnName(relationName: string, referencedColumnName: string): string {
    return `${relationName}_${referencedColumnName}`.toLowerCase();
  }
}

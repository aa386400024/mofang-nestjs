// V2026-10-22 治本 (首页金句 · 收藏 — user_quote_favorites entity):
//   原因: spec `home-quote-backend-api.md` §2.3 定义了收藏的两个端点
//     (POST /counselor/quotes/:id/favorite / DELETE 同路径), 并明确:
//       - 「本期不上报; 远端就绪后替换本地 `_liked` 集合」
//       - 「**不下发、不展示全站 likeCount** (零压, 避免攀比)」
//     也就是说: 收藏是**纯个人行为**, 服务端只负责"记下我收藏了哪些",
//     任何"有多少人收藏了这条"的信息都不存在.
//
//   修法 (跟 V1.3 §2.2 practice-attempt.entity.ts 风格一致):
//     - UUID PK + char(36) id (内部标识, 与对外契约无关)
//     - tenant_id / user_id char(36) (A9 一人一租户)
//     - quote_id varchar(64) (指向 quotes.id; 应用层校验, 不写 DB FK)
//     - created_at / deleted_at (软删)
//     - 2 索引: PRIMARY + UNIQUE (user_id, quote_id) + (user_id, created_at)
//
//   反双胞胎:
//     - 不加 quote_id 的 DB 外键: 跟 ADR-0003 一致
//     - 不用"硬删": 收藏是个人数据, 软删留痕便于"取消收藏后再次收藏"的历史一致性
//     - 不加 like_count 冗余列: 本表是"谁收藏了"的关系表, 计数是聚合出来的,
//       且零压红线要求根本不下发 —— 冗余一个计数字段就等于把"排行榜"的原料存进库
//     - 不用 (user_id, quote_id) 的**软删**唯一索引: MySQL 唯一索引不含 deleted_at,
//       软删后再收藏同一句会撞唯一键. 故取消收藏走**硬删**该行, 保证
//       "再收藏"永远能插入成功 —— 这是本表与项目其他软删表的一处**故意不同**.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'user_quote_favorites'; # 1 张表
//     2. SHOW INDEX FROM user_quote_favorites; # 3 索引
//     3. 同一用户重复收藏同一句 → 不产生第二行 (UNIQUE 约束)
//     4. 取消收藏后再收藏 → 能成功 (硬删让出唯一键)
//
//   时间戳: 2026-10-22
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * user_quote_favorites 表 —— 用户与金句的收藏关系.
 *
 * 零压红线: 只记"本人收藏了什么", 没有任何全站计数字段.
 */
@Entity('user_quote_favorites')
@Index('uniq_uqf_user_quote', ['userId', 'quoteId'], { unique: true })
@Index('idx_uqf_user_created', ['userId', 'createdAt'])
export class UserQuoteFavorite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9).
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 指向 quotes.id (稳定 slug); 应用层校验, 不写 DB FK.
  @Column({ type: 'varchar', length: 64, name: 'quote_id' })
  quoteId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

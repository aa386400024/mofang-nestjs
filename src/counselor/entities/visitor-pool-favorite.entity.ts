// V2026-10-23 治本 (AI 模拟来访池 — visitor_pool_favorites 收藏关系表):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §3.4 要求收藏关系独立小表
//     `visitor_pool_favorites(template_id, user_id, created_at)`, 唯一键
//     `(template_id, user_id)`, 且明确「**不返回、不统计全站收藏数**」(零压红线).
//
//   修法 (跟 V2026-10-22 `user_quote_favorites` entity 严格同范式):
//     - UUID PK + char(36) id
//     - tenant_id / user_id char(36) (A9 一人一租户)
//     - template_id char(36) (指向 visitor_pool_templates.id; 应用层校验, 不写 DB FK)
//     - created_at
//     - 2 索引: PRIMARY + UNIQUE (user_id, template_id) + (user_id, created_at)
//
//   反双胞胎:
//     - 不加 favorite_count / use_count 列: 零压红线要求根本不下发. 列都不存在 =
//       物理上不可能下发. 有计数就有排行榜, 排行榜会把"人物供给层"变成攀比位.
//     - 不加 DB-level FK: 跟 ADR-0003 一致
//     - **不做软删** (与本仓绝大多数表不同, 刻意为之): MySQL 唯一索引不含 deleted_at,
//       软删后再收藏同一模板会撞唯一键, 导致"取消收藏 → 再收藏"失败. 本表走**硬删**
//       让出唯一键, 再收藏必然成功. 跟 user_quote_favorites 是同一处刻意的例外.
//     - 不用 (template_id, user_id) 的复合主键: 仓库统一 UUID PK (跨表引用方便),
//       唯一性用唯一索引保证即可.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'visitor_pool_favorites'; # 1 张表
//     2. SHOW INDEX FROM visitor_pool_favorites; # 3 索引 (含 uniq_vpf_user_template)
//     3. 同一用户重复收藏同一模板 → 不产生第二行
//     4. 取消收藏后再收藏 → 能成功 (硬删让出唯一键)
//
//   时间戳: 2026-10-23
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH } from '../config/visitor-pool.config';

/**
 * visitor_pool_favorites 表 —— 用户与公共来访模板的收藏关系.
 *
 * 零压红线: 只记「本人收藏了什么」, 没有任何全站计数字段.
 */
@Entity('visitor_pool_favorites')
@Index('uniq_vpf_user_template', ['userId', 'templateId'], { unique: true })
@Index('idx_vpf_user_created', ['userId', 'createdAt'])
export class VisitorPoolFavorite {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9).
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 指向 visitor_pool_templates.id; 应用层校验, 不写 DB FK.
  // 列宽与被引用主键一致 (VARCHAR(64)): 模板 id 是内容 slug, 不是 36 字符的 UUID.
  @Column({ type: 'varchar', length: VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH, name: 'template_id' })
  templateId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

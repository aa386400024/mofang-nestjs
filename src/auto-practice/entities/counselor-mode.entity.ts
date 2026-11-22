// V2026-11-08 治本 (Phase2.5 WP-D · 自动对练 — 咨询师模式表):
//   原因: 自动对练要让 AI 扮演不同水平 / 风格的咨询师 (专家 / 中级 / 新手 / 聊家常 /
//     冷漠 / 说教 / 胡说八道), 用来批量跑对练、观察引擎在不同咨询师输入下的反应.
//     这些模式的 system prompt 不能写死在代码里 —— 大炮要能在 admin 后台增删改,
//     不用发版. 所以落表.
//
//   表结构: id (稳定 slug) / name / system_prompt / description / enabled / sort_order
//     + created_at / updated_at (无软删: 模式是配置, 删了就是删了, 不该留僵尸行)
//
//   反双胞胎:
//     - **不落 tenant_id**: 咨询师模式是引擎验证用的全局配置, 不属于任何租户.
//     - **不加 DB FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//     - **不用 @DeleteDateColumn**: 配置表直接物理删 (软删查询手写 deletedAt: IsNull()
//       是业务数据的范式, 配置表没这个必要 —— 留着软删反而让人以为模式还在).
//     - **system_prompt 用 text 列**: 7 种模式的 prompt 都在 200~800 字之间,
//       varchar(512) 会截断长的, text 列无压力.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'ap_counselor_modes';
//     2. DESCRIBE ap_counselor_modes;
//     3. npm run seed:counselor-modes → 7 行, 连跑两次行数不变
//
//   时间戳: 2026-11-08

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * ap_counselor_modes 表 —— AI 咨询师模式配置.
 *
 * 每一行 = 一种"AI 咨询师人设": 它的 system prompt 决定了 AI 咨询师说什么话、
 * 用什么水平、犯什么典型错误. 自动对练时选一种模式, AI 就按那个风格跟 AI 来访者聊.
 */
@Entity('ap_counselor_modes')
// 按 enabled + sort_order 列模式清单 (admin 后台下拉框主查询路径).
@Index('idx_ap_modes_enabled_sort', ['enabled', 'sortOrder'])
export class CounselorMode {
  /**
   * 模式 id (稳定 slug, 兼对外契约).
   *
   * 例: 'expert' / 'novice' / 'chatty' / 'cold' / 'preachy' / 'nonsense'.
   * seed 按这个 slug 幂等 upsert; admin 后台改 prompt 不改 id.
   */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  /** 展示名 (admin 后台下拉框显示), 例「专家咨询师」. */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /**
   * 咨询师 system prompt.
   *
   * 内容是"你是一个XX风格的咨询师, 你会...", 决定 AI 咨询师的说话方式.
   * 运行时作为 chat 请求的 system 消息注入.
   */
  @Column({ type: 'text', name: 'system_prompt' })
  systemPrompt!: string;

  /** 描述 (admin 后台说明这个模式用来测什么), 例「测引擎在专家共情下的同盟增长」. */
  @Column({ type: 'varchar', length: 512, default: '' })
  description!: string;

  /** 是否启用 (false = 批量跑时不选它, 但历史场次还能查到). */
  @Column({ type: 'tinyint', default: 1 })
  enabled!: number;

  /** 排序 (admin 后台下拉框从上到下). */
  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder!: number;

  /** 创建时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  /** 更新时刻. */
  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}

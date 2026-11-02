// V2026-10-21 治本 (V1.2 VS-B1 — M1 动态解锁档案: case_profile_entries 表):
//   原因: v1.2 spec §4.2 视图 B 要求"卷宗 · 动态解锁档案" —— 会谈中逐轮收集来访者主动披露的
//     底层人设信息, **未提及的信息保持空白, 绝不提前显示**; 咨询师可随时补 layer=therapist_note
//     的观察/假设, 两者分区展示. 现状无任何存储承载"已解锁了什么".
//   修法: 新建 case_profile_entries 表, 每行 = 1 条被披露/记录的人设事实.
//   反双胞胎:
//     - 不在 long_term_cases 加 "已解锁 json 列": 条目是**持续追加**的列表, 不是整体覆盖的快照;
//       塞 json 列每次追加都要读-改-写整个 json (并发写会丢数据), 且无法按 sessionId 索引
//     - 不加 DB-level FK 到 long_term_cases: 跟仓库既有 pattern 一致 (knowledge_chunks.itemId /
//       long_term_case_sessions.caseId 都是应用层校验)
//     - 不存"人设字段值"本身: 本表只存 anchor_key (指向 VisitorFullPersona 的 JSON path) +
//       content (披露时说的原话/摘要), 真相值仍在 visitor_full_personas, 避免两处副本漂移
//     - 不加"是否已解锁"的布尔位: 存在即已解锁 (未提及的信息没有行 = 空白), 天然满足 spec
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 migration:run 后 SHOW CREATE TABLE case_profile_entries → 3 索引
//     3. GET /counselor/long-term-cases/:id/profile-entries → 按 createdAt 升序, 两 layer 分区
//   时间戳: 2026-10-21

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { CaseProfileEntryLayer } from '../domain/visitor-persona/visitor-persona.types';

/**
 * 卷宗动态解锁档案条目.
 *
 * 1 条 = 1 个被披露 (self_disclosed) 或被记录 (therapist_note) 的人设事实.
 */
@Entity('case_profile_entries')
@Index('idx_cpe_case', ['caseId'])
@Index('idx_cpe_case_session', ['caseId', 'sessionId'])
@Index('idx_cpe_user', ['userId'])
export class CaseProfileEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 归属长程个案 id (long_term_cases.id), 应用层校验 (不加 DB FK).
  @Column({ type: 'char', length: 36, name: 'case_id' })
  caseId!: string;

  /**
   * 在第几次会谈中披露 (long_term_case_sessions.id), **可空**.
   *
   * 可空的 2 种场景: (1) 咨询师在两次会谈之间手写补充的观察; (2) 会谈还没挂上 sessionId
   * 就先记录了 (前端先落库后关联). 两者都属合理业务态, 不强制非空.
   */
  @Column({ type: 'char', length: 36, name: 'session_id', nullable: true })
  sessionId!: string | null;

  /**
   * 条目层级: self_disclosed (来访主动披露) / therapist_note (咨询师手写).
   *
   * 两层分区展示 (spec §4.2): AI 只能写 self_disclosed; therapist_note 只允许咨询师写.
   */
  @Column({ type: 'varchar', length: 20 })
  layer!: CaseProfileEntryLayer;

  /**
   * 锚点 — 对应 VisitorFullPersona 的 JSON path.
   *
   * 例: "innerWorkingModel.attachmentType" / "basics.psychHistory" / "coping.emotionTriggers[0]".
   * 前端可按锚点高亮人设图谱的对应节点; AI 抽取器用它标注"披露的是哪一块".
   */
  @Column({ type: 'varchar', length: 100, name: 'anchor_key' })
  anchorKey!: string;

  /** 条目正文 (披露原话 / 咨询师观察). */
  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 counselor 其它 entity 一致, 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}

// V2026-09-04 治本 (V6.0 §11.2 + audit P0-1):
//   危机事件审计表 — §11.2 三级风险响应机制.
//   原因: LLM 三级风险信号 (low / medium / high) 触发前端弹层 + 公益热线,
//         服务端必须留痕做 §11.3「合规审计 / 公平性审计」.
//   修复: level / source enum 4 + 3; keywords JSON 数组; context TEXT 存
//         会话上下文摘要 (脱敏); suggested_resource 公益热线链接; 索引
//         覆盖 (uid, detected_at) + (level, detected_at) 两个审计维度.
//   如何验证:
//     1. POST /v1/chat/completions 触发 crisis_level=high → 异步写
//        crisis_events 表 (fire-and-forget, 不阻塞流).
//     2. SELECT * FROM crisis_events WHERE level IN ('medium','high') AND
//        detected_at >= NOW() - INTERVAL 30 DAY → 审计报告 (§11.3).
//     3. uid nullable 支持匿名游客模式 (审计 UID 缺失时仍记录).

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { CrisisLevel, CrisisSignalSource } from '../enums/ai-crisis.enums';

/**
 * 危机事件审计 — V6.0 §11.2 / §11.3.
 *
 * 隐私:
 *   - context 字段存 LLM 输入摘要 (前后各 200 字 + 中间截断), 不存原始全文.
 *   - keywords 仅存命中的危机关键词, 不存非危机上下文.
 *   - 90 天后 cron 清理 (可配置, 默认保留 90 天用于审计).
 */
@Entity('crisis_events')
@Index('idx_crisis_uid_detected', ['uid', 'detectedAt'])
@Index('idx_crisis_level_detected', ['level', 'detectedAt'])
@Index('idx_crisis_source', ['source'])
export class CrisisEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * 用户 uid — nullable 支持匿名游客模式 (§11.2 危机响应不依赖登录).
   * 已登录用户写入真实 uid, 匿名模式写 null (审计时按 IP / device 关联).
   */
  @Column({ type: 'char', length: 36, name: 'uid', nullable: true })
  uid!: string | null;

  @Column({ type: 'enum', enum: CrisisLevel, name: 'level' })
  level!: CrisisLevel;

  @Column({ type: 'enum', enum: CrisisSignalSource, name: 'source' })
  source!: CrisisSignalSource;

  /** 命中的关键词数组 — 仅危机相关 (自杀 / 自伤 / 想死 / 绝望 / 没意义 等). */
  @Column({ type: 'json', name: 'keywords' })
  keywords!: string[];

  /** 会话上下文摘要 — 脱敏 (前后各 200 字 + 中间截断). */
  @Column({ type: 'text', name: 'context', nullable: true })
  context!: string | null;

  /** 推荐资源 — 二级及以上响应携带 (公益热线 / 危机机构 URL). */
  @Column({ type: 'varchar', length: 500, name: 'suggested_resource', nullable: true })
  suggestedResource!: string | null;

  /** LLM conversation_id — 关联 llm_conversations 表. */
  @Column({ type: 'char', length: 36, name: 'conversation_id', nullable: true })
  conversationId!: string | null;

  @CreateDateColumn({ type: 'datetime', precision: 6, name: 'detected_at' })
  detectedAt!: Date;
}

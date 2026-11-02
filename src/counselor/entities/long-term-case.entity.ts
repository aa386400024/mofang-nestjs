// V2026-10-15 治本 (V1.1 — long_term_cases entity):
//   原因: counselor-mode-v1.0 §6.1 设计 long_term_cases 表, V0.3 §13 baseline 0
//     长程, 1:1 wire 0 破坏. 长程 1:N 多次会话语义跟 V0.x TrainingSession (单次模拟)
//     完全不同, 单独建 entity 避免 1:1 wire 污染 V0.x baseline.
//
//   修法 (跟 knowledge-item.entity.ts / knowledge-chunk.entity.ts V0.x 风格一致):
//     - UUID PK + char(36) id (跟 user.uid / knowledge-item.id 1:1 风格)
//     - tenantId + userId 走 V0.x 多租户 pattern (A9: 一人一租户, V0.x tenantId = userId)
//     - caseType varchar(40) 存 LongTermCaseType enum 字符串 (不写 FK, 应用层校验)
//     - config / visitorPersona json 字段 (V0.x pattern, 跟 metadata / snapshot 风格一致)
//     - progressCurve varchar(20) 存 4 段 (好转 / 反复 / 突破 / 稳定), 跟 counselor-mode §4.3 1:1
//     - currentSession / totalSessions int (1-based, totalSessions 4-12 范围校验在 service)
//     - dropoutRiskScore float 0.0-1.0 (脱落风险累积, V1.2 设计: 每次 session 结束 +0.05~0.15)
//     - isTemplate TINYINT(1) (5 预设个案模板 / 用户实例分离, 跟 KB isTemplate 同 pattern)
//     - status varchar(20) 存 LongTermCaseStatus enum 字符串
//     - 3 复合索引: (tenant_id, user_id) / (status) / (is_template, case_type)
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不复用 persona table: long-term visitorPersona 比 V0.x persona 多 progressCurve /
//       nextSessionContext 字段, 强类型 1:1 进 long_term_cases.visitor_persona JSON
//     - 不在 V0.x TrainingSession 加 longTermCaseId 字段 (破坏 1:1 wire + PrivacyGuard 装饰器链)
//     - 不加 DB-level FK (long_term_case_sessions.caseId 应用层校验, 软删兼容, 跟
//       knowledge_chunks.itemId 同 pattern)
//     - 不存 vector 字段 (V1.x JSONB 足够, V2.x RAG 升级再切)
//
//   验证:
//     1. tsc 0 错 (entity 字段 type 严格)
//     2. pnpm migration:run 后 DESCRIBE long_term_cases; 12 列
//     3. SHOW INDEX FROM long_term_cases; 4 索引 (PRIMARY + 3 复合)
//
//   时间戳: 2026-10-15

import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { LongTermCaseSession } from './long-term-case-session.entity';
import { LongTermCaseStatus } from '../enums/long-term-case-status.enum';
import { LongTermCaseType } from '../enums/long-term-case-type.enum';

/**
 * long_term_cases 表.
 *
 * 跟客户端 xin_su_app LongTermCase entity 字段 1:1 wire.
 * 1:N long_term_case_sessions (caseId 应用层校验, 软删兼容).
 */
@Entity('long_term_cases')
@Index('idx_ltc_tenant_user', ['tenantId', 'userId'])
@Index('idx_ltc_status', ['status'])
@Index('idx_ltc_template', ['isTemplate', 'caseType'])
export class LongTermCase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9 多租户治本). V1.x 改 nullable 时迁移 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  // V0.x 风格: 业务用户主键, char(36) UUID. V0.3 §13 拍板 userId 字段名 (跟 user.uid 区分).
  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // V1.x: 5 预设类型 enum 字符串, 走应用层 LongTermCaseType 校验, 不写 DB-level ENUM
  // (跟 V0.x knowledge-items.type varchar 同 pattern, V0.5 V2026-10-12 治本一致).
  @Column({ type: 'varchar', length: 40, name: 'case_type' })
  caseType!: LongTermCaseType;

  // UI 列表 / 详情页用, 跟 long-term-case-presets.ts 5 preset title 1:1 默认值.
  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /**
   * 长程个案配置 json 字段 (V0.2 spec §13.4 style).
   * 结构:
   *   {
   *     progressCurve: 'improve' | 'regress' | 'breakthrough' | 'stable',
   *     description: string,
   *     startedAt: string (ISO 8601)
   *   }
   * 跟 visitorPersona 拆开: config 偏"过程元数据", visitorPersona 偏"角色人设".
   */
  @Column({ type: 'json' })
  config!: {
    progressCurve: 'improve' | 'regress' | 'breakthrough' | 'stable';
    description: string;
    startedAt: string;
  };

  /**
   * 来访者人设 json 字段 (跟 long-term-case-presets.ts 5 preset visitorPersona 1:1).
   * 结构:
   *   {
   *     name: string, age: number, occupation: string,
   *     complaint: string, background: string,
   *     defenseLevel: number,  // 0.0-1.0
   *     emotionBaseline: number,  // 0.0-1.0
   *     keyTopics: string[]
   *   }
   * 跟 V0.x persona table 字段 1:1 风格, 拆出 (不在 persona table FK) 避免
   * 长程人设需要"动态调整"时跨表 update.
   */
  @Column({ type: 'json', name: 'visitor_persona' })
  visitorPersona!: {
    name: string;
    age: number;
    occupation: string;
    complaint: string;
    background: string;
    defenseLevel: number;
    emotionBaseline: number;
    keyTopics: string[];
  };

  // 1-based 当前会话序号, 默认 1 (用户开始第 1 次). V1.2: appendSession 完成时 +1.
  @Column({ type: 'int', name: 'current_session', default: 1 })
  currentSession!: number;

  // 总会话次数, 4-12 范围 (counselor-mode-v1.0 §4.3 拍板), service 层校验.
  @Column({ type: 'int', name: 'total_sessions' })
  totalSessions!: number;

  /**
   * 脱落风险 0.0-1.0 (V1.2 设计).
   * 公式: 每次 session 完成时按 overall_score 累加, 范围 0.0-1.0.
   *   - score < 60  → +0.15 (高脱落风险, 累积快)
   *   - 60 ≤ score < 80 → +0.08 (中脱落风险)
   *   - score ≥ 80 → +0.03 (低脱落风险, 累积慢)
   * 阈值: dropoutRiskScore > 0.7 触发脱落建议 (status 仍 Active, 由用户决定转 Abandoned).
   * 简化 (V0.x 阶段): 不写 ML, 简单线性累加, V2.x 接 LLM 推理累积权重再调.
   */
  @Column({ type: 'float', name: 'dropout_risk_score', default: 0 })
  dropoutRiskScore!: number;

  // 5 预设个案模板 (is_template=1) 跟用户实例 (is_template=0) 分离, 跟 KB isTemplate 同 pattern.
  // 模板由 long-term-case-presets.ts 启动时序列化, 用户实例由 POST /counselor/long-term-cases 创.
  @Column({ type: 'tinyint', name: 'is_template', default: 0 })
  isTemplate!: number;

  // 3 态: active (进行中) / completed (完成) / abandoned (脱落). 走应用层 enum 校验.
  @Column({ type: 'varchar', length: 20, default: LongTermCaseStatus.ACTIVE })
  status!: LongTermCaseStatus;

  // 1:N 关系, caseId 应用层校验, 不写 DB-level FK (软删兼容, 跟 knowledge_chunks 同 pattern).
  @OneToMany(() => LongTermCaseSession, (session) => session.caseRef)
  sessions?: LongTermCaseSession[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删, 跟 V3 其他模块一致. V0.x 简单 (无 TTL), V1.x 加 GC cron.
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}

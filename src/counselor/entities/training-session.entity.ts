// V2026-10-19 治本 (V1.1 §6.5 — training_sessions entity, 跟 xin_su_app V0.5 client TrainingSession 1:1 wire):
//   原因: counselor-mode-v1.1 §6.5 拍板 training_sessions 表 (9 场景单次训练 session
//     持久化, 跟 V0.3 §13 baseline 0 破坏). V0.5 client 用 MockTrainingSessionRepository
//     内存 mock 走 Repository.createMock / appendVisitorResponse, V1.x server 端落库
//     后客户端通过 POST /training/sessions API 创建, GET 拉取, PATCH 5 状态机流转,
//     POST /:id/finish 关闭 + 异步派发 BullMQ 督导生成.
//
//   跟 V0.3 §13 baseline 关系: V0.3 TrainingSession 4 态 (active/paused/completed/
//     abandoned) 是 server 端会话生命周期, V0.5 stage 5 状态机 (idle/listening/
//     thinking/speaking/finished) 是 client UI 对话状态, 两个正交概念. V1.x server
//     API 双轨支持 (V0.3 4 态保留, V1.1 新增 5 态走 training_sessions.status).
//
//   跟 W1-2 long_term_case_session 关系: 1:1 wire (transcript ChatMessage shape 复用
//     W1-2 SessionTranscriptTurn 3 字段 + V1.5 V0.5 client 2 字段 {id, isTyping} 增量).
//
//   修法 (跟 long-term-case-session.entity.ts V1.1 风格一致):
//     - UUID PK + char(36) id
//     - tenantId + userId char(36) 双索引 (V0.x 多租户, A9 一人一租户)
//     - scenarioId varchar(50) (11 场景: skill_listening/skill_questioning/skill_voice/
//       workplace/anxiety/grief/parenting/relationship/script_polish/case_concept/case_ethics)
//     - 5 状态机: TrainingSessionStatus enum (Idle/Listening/Thinking/Speaking/Finished,
//       跟 V0.5 client 1:1 wire)
//     - 6 字段 persona (personaName/personaAge/personaOccupation/personaComplaint/
//       personaBackground + difficulty 1 字段 共 5+1 字段, 跟 V0.5 client TrainingSession
//       1:1 wire)
//     - 9 字段 VisitorPreset: visitorStyle(enum 5) + emotionBaseline(float) +
//       defenseLevel(float) + randomSeed(varchar) + mode(enum 3) +
//       styleVariance/emotionVariance/defenseVariance(enum 3 each) = 9 字段
//     - transcript json (ChatMessage[] 数组, 跟 long_term_case_session.transcript
//       SessionTranscriptTurn 1:1 wire shape + isTyping 增量)
//     - supervisionReportId char(36) nullable (V1.x W3-4 多流派督导接通后填,
//       V0.5 mock 跳固定 3 条限制解除)
//     - startedAt/endedAt datetime nullable (V0.5 stage 2 Timer.periodic 1s tick 计时,
//       V1.x server 端真接)
//     - 5 索引: PRIMARY + idx_ts_tenant_user + idx_ts_scenario + idx_ts_status +
//       idx_ts_user_started
//     - 软删 deletedAt (跟 V3 其他模块一致)
//
//   反双胞胎:
//     - 不复用 V0.3 §13 TrainingSession entity 字段: V0.3 4 态 (active/paused/completed/
//       abandoned) 跟 V1.1 5 状态机 (idle/listening/thinking/speaking/finished) 正交,
//       新建表避免 1:1 wire 破坏
//     - 不用 type: 'enum' 列类型: V0.x pattern 风格走 varchar + 应用层 enum 校验,
//       V0.5 V2026-10-12 治本一致, 避免 DB schema 跟 enum 字符串 drift
//     - 不在 transcript 字段加 emotion_score: 跟 V0.5 client ChatMessage 1:1 wire
//     - 不加 DB-level FK (supervisionReportId → supervision_feedback.id): V0.5 mock
//       跳固定 3 条, V1.x W3-4 接后改应用层校验 (跟 knowledge_chunks.itemId V0.x
//       pattern 一致)
//     - 不存 vector 字段: V1.x JSON 足够 (transcript 数组), V2.x RAG 升级再切
//     - 不加 polymorphic sessionType 字段: V0.5 阶段只接 V0.5 client 一种, 跟 W1-2
//       long_term_case_session 区分 (不同表 + 不同 enum, 不走 polymorphic 1 表多 type)
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'training_sessions'; # 1 张表
//     2. SHOW INDEX FROM training_sessions; # 5 索引 (PRIMARY + 4 复合)
//     3. DESCRIBE training_sessions; # 25 列
//     4. SELECT * FROM training_sessions LIMIT 0; # 空表
//
//   时间戳: 2026-10-19

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ChatRole } from '../enums/chat-role.enum';
import { DimensionVariance } from '../enums/dimension-variance.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingSessionStatus } from '../enums/training-session-status.enum';
import { VisitorMode } from '../enums/visitor-mode.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

/**
 * 单次对话消息 (transcript json 数组元素, 跟 xin_su_app V0.5 client ChatMessage 1:1 wire).
 *
 * 5 字段结构: id + role (ChatRole 3 档) + text (含 (sighs)/(sniffs)/<#X.X#> 语气词
 * 标签的原始文本) + timestamp (毫秒级) + isTyping (UI 层 typing indicator 标记,
 * V0.5 stage 简化不落 transcript).
 */
export interface TrainingTranscriptTurn {
  /** 消息 ID (UUID, V0.5 mock 用 DateTime.now().microsecondsSinceEpoch) */
  id: string;
  /** 角色 (counselor / visitor / system) */
  role: ChatRole;
  /** 原始文本, 含 (sighs) / (sniffs) / <#1.5#> 等语气词标签 */
  text: string;
  /** 毫秒级时间戳, 跟录音对齐 */
  timestamp: number;
  /** Typing indicator 标记 (UI 层用, V0.5 stage 简化不落 transcript) */
  isTyping?: boolean;
}

/**
 * training_sessions 表.
 *
 * 跟 xin_su_app V0.5 client `TrainingSession` 1:1 wire (Repository.createMock
 * 返回字段跟本表 schema 1:1), 跟 V1.1 §6.5 1:1.
 *
 * 9 场景单次训练 session 持久化: workplace / anxiety / grief / parenting / relationship
 * (5 场景 V0.5 实装) + skill_listening / skill_questioning / skill_voice /
 * script_polish / case_concept / case_ethics (6 场景 V0.5 占位入口, V1.x W7-8 续做).
 */
@Entity('training_sessions')
@Index('idx_ts_tenant_user', ['tenantId', 'userId'])
@Index('idx_ts_scenario', ['scenarioId'])
@Index('idx_ts_status', ['status'])
@Index('idx_ts_user_started', ['userId', 'startedAt'])
export class TrainingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  // 场景 id (11 值, 跟 V0.5 client TrainingScenario.id 1:1 wire)
  // - skill_listening / skill_questioning / skill_voice (专项技能)
  // - workplace / anxiety / grief / parenting / relationship (全流程模拟, V0.5 5 实装)
  // - script_polish (话术工坊, V0.5 P0-2 已实装)
  // - case_concept / case_ethics (个案训练)
  @Column({ type: 'varchar', length: 50, name: 'scenario_id' })
  scenarioId!: string;

  // 难度 (varchar 存 enum 字符串 'L1' / 'L2' / 'L3', 跟 V0.5 client TrainingDifficulty
  // enum 1:1 wire, V0.5 client L1=10min / L2=15min / L3=20min)
  @Column({ type: 'varchar', length: 20 })
  difficulty!: TrainingDifficulty;

  // 时长 (分钟): L1=10 / L2=15 / L3=20
  @Column({ type: 'int', name: 'duration_minutes' })
  durationMinutes!: number;

  // 5 状态机 (V0.5 client TrainingSessionStatus enum 1:1 wire)
  @Column({ type: 'varchar', length: 20, default: TrainingSessionStatus.IDLE })
  status!: TrainingSessionStatus;

  // ─── 来访者 persona 5 字段 (跟 V0.5 client TrainingSession 1:1 wire) ───
  @Column({ type: 'varchar', length: 100, name: 'persona_name' })
  personaName!: string;

  @Column({ type: 'int', name: 'persona_age' })
  personaAge!: number;

  @Column({ type: 'varchar', length: 200, name: 'persona_occupation' })
  personaOccupation!: string;

  @Column({ type: 'text', name: 'persona_complaint' })
  personaComplaint!: string;

  @Column({ type: 'text', name: 'persona_background' })
  personaBackground!: string;

  // ─── VisitorPreset 9 字段 (V0.5 client 1:1 wire, V1.x server 端持久化) ───
  @Column({ type: 'varchar', length: 20, name: 'visitor_style' })
  visitorStyle!: VisitorStyle;

  @Column({ type: 'float', name: 'emotion_baseline' })
  emotionBaseline!: number;

  @Column({ type: 'float', name: 'defense_level' })
  defenseLevel!: number;

  // YYYY-MM-DD-HH-mm-ss-{0-99} 格式, V0.5 client 自动生成, server 不强校验
  @Column({ type: 'varchar', length: 50, name: 'random_seed' })
  randomSeed!: string;

  // 训练模式 3 档 (V0.5 stage 2 A1 大炮 2026-10-16 17:10 拍板)
  @Column({ type: 'varchar', length: 20 })
  mode!: VisitorMode;

  // 3 维度 variance (V0.5 stage 2 B1 大炮 2026-10-16 17:10 拍板)
  @Column({ type: 'varchar', length: 10, name: 'style_variance' })
  styleVariance!: DimensionVariance;

  @Column({ type: 'varchar', length: 10, name: 'emotion_variance' })
  emotionVariance!: DimensionVariance;

  @Column({ type: 'varchar', length: 10, name: 'defense_variance' })
  defenseVariance!: DimensionVariance;

  // 对话 transcript (跟 W1-2 long_term_case_session.transcript 1:1 wire shape,
  // ChatMessage[] 数组, 跟 V0.5 client 1:1 wire)
  @Column({ type: 'json' })
  transcript!: TrainingTranscriptTurn[];

  // 督导报告关联 (V1.x W3-4 多流派督导接通后填, V0.5 mock 跳固定 3 条限制解除)
  @Column({ type: 'char', length: 36, name: 'supervision_report_id', nullable: true })
  supervisionReportId!: string | null;

  // V0.5 stage 2 Timer.periodic 1s tick 计时 (V1.x server 端)
  @Column({ type: 'datetime', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'datetime', name: 'ended_at', nullable: true })
  endedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 V3 其他模块一致)
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}

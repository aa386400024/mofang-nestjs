// V2026-10-09 治本 (Persona 实体 — SPEC §11.1 V1.0):
//   角色: 来访者人格画像, 心理咨询师训练场景核心数据
//   多租户: tenantId 隔离, V0.x 兜底 'default', V1.x 接 Tenant 实体
//   难度分层: difficulty (L1=入门 / L2=进阶 / L3=专家) 控制 prompt 行为模式
//   防御等级: defenseLevel (1=开放 .. 5=高度防御) 独立维度, V1.x 评分用
//   知识引用: knowledgeRefs (uuid 数组), V0.x 留空, V1.x 接 Qdrant 向量检索
//   语音: voiceId 走 MiniMax TTS 音色库, 配合 emotion 控制语气
//
//   反双胞胎:
//     - 不用 MongoDB schema — 项目统一 MySQL + TypeORM, V0.x 内存 mock 兜底
//     - 不用 JSONB 存整个 persona 快照 — 字段化便于 §11.1 prompt 模板直接插值
//     - 不存"对话历史"在本表 — 那是 VisitorSessionMemory 的职责 (§11.1 Visitor Service)
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 启动后注入 3 个种子 persona (l1 / l2 / l3) 可被 resolvePersona 命中
//     3. 切 V1.x TypeORM: 字段一一对应 (id/tenant_id/name/...) 无需大改

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** 训练难度分层 — 控制 prompt 行为模式. */
export type PersonaDifficulty = 'L1' | 'L2' | 'L3';

/** 情绪基线枚举 — persona 加载时初始化, V0.x 简化, V1.x 可扩. */
export type PersonaEmotionBaseline =
  | 'anxious_open' // 焦虑但愿意倾诉 (L1 默认)
  | 'suppressed_fatigue' // 疲惫压抑 (L2 默认)
  | 'detached_defensive' // 冷漠疏离 (L3 默认)
  | 'fragile_reserved' // 脆弱克制
  | 'angry_volatile' // 易怒波动
  | 'numb_flat'; // 情感麻木

@Entity('personas')
@Index('idx_personas_tenant_active', ['tenantId', 'isActive'])
@Index('idx_personas_difficulty', ['difficulty'])
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 64, name: 'tenant_id', default: 'default' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 80, name: 'name' })
  name!: string;

  /** 年龄, 仅展示用, 不参与 prompt 逻辑. */
  @Column({ type: 'int', name: 'age' })
  age!: number;

  /** 性格描述, 自由文本, prompt 插值. */
  @Column({ type: 'varchar', length: 500, name: 'personality' })
  personality!: string;

  /** 主诉, 1-2 句, prompt 关键变量. */
  @Column({ type: 'varchar', length: 500, name: 'complaint' })
  complaint!: string;

  /** 背景信息, 3-5 句, prompt 插值. */
  @Column({ type: 'text', name: 'background' })
  background!: string;

  /** 情绪基线, 初始化 emotion state 用. */
  @Column({ type: 'varchar', length: 32, name: 'emotion_baseline' })
  emotionBaseline!: PersonaEmotionBaseline;

  /** 防御等级 1-5, 跟 difficulty 相关但独立. */
  @Column({ type: 'int', name: 'defense_level' })
  defenseLevel!: number;

  /** 训练难度, 控制 prompt 行为模式. */
  @Column({ type: 'varchar', length: 8, name: 'difficulty' })
  difficulty!: PersonaDifficulty;

  /** MiniMax TTS 音色 ID, 启动 TTS session 时传入. */
  @Column({ type: 'varchar', length: 64, name: 'voice_id' })
  voiceId!: string;

  /**
   * 知识引用 ID 列表 (uuid 数组).
   * V0.x: 留空, prompt 模板不引用此字段
   * V1.x: RAG 检索时按 persona 找相关知识, 注入 LLM context
   */
  @Column({ type: 'json', name: 'knowledge_refs', nullable: true })
  knowledgeRefs!: readonly string[] | null;

  /** 软删除标志, 列表查询过滤. */
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

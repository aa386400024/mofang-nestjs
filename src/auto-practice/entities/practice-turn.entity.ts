// V2026-11-10 治本 (WP-J P1e Phase2 — 自动对练 · 来访者语义落库表):
//   职责: 一轮 = 一行 —— 承载"来访者这一轮说了什么"的**三份拆解**:
//     visitor_display_text   纯文本 (无任何标记) —— 标注台 / 日志 / 检索
//     visitor_tts_text       带 MiniMax 标记的文本 —— 喂 TTS
//     visitor_semantic_json  语义中间表示 (SemanticTurn 的 JSON) —— 调试回放
//     visitor_semantic_level 解析降级级别 (0/1/2) —— 事后能区分
//                                       "本来是纯文本" vs "解析失败了"
//     visitor_semantic_version 语义层版本 (semantic-v1) —— parser 升级后区分新旧数据
//
// ── 为什么是**独立的 turn 表**, 不是给 ap_practice_sessions 加列 ──────────────
//   ① **落点事实**: 自动对练的逐字稿在 `data/debug-sessions/{debugSessionId}.json`
//      (文件), DB 里的 `ap_practice_sessions` 是**场次级元数据**表 (一场一行).
//      今天**根本没有 turn 表** —— 一轮一轮的文本只在 JSON 文件里.
//   ② **粒度**: 一场 12~25 轮. 把 5 列加在场次表上, 每一列就得存"按 turnIndex 排的
//      JSON 数组" → 每轮都要读-改-写整行 (O(n²) 写放大), 且行体积随轮数线性膨胀.
//      任务单明确警告过这一点 ("不要直接在 session 表上加列").
//   ③ **可查**: turn 表能直接问"第 7 轮有没有停顿标记 / 哪几轮降级了",
//      session 级 JSON 数组查这些只能全量取回再在应用层过滤.
//   ④ **幂等**: 唯一键 (practice_session_id, turn_index) → upsert 天然幂等,
//      重跑同一轮不产生重复行.
//
//   反双胞胎 (与 quality_annotation / gate_decisions 同款纪律):
//     - **手写 DDL**: schema 只走 migration (ADR-0003), 禁用 synchronize;
//     - **不加 DB-level FK**: 跨表引用应用层校验 (ADR-0003);
//     - **不做软删**: 语义落库是"当时那轮长什么样"的证据, 删了就查不到了;
//     - **visitor_ 前缀**: 明确是"来访者"那半边 —— 咨询师那半边本批不落语义列.
//
//   隐私: 本表**存来访者台词原文** (displayText / ttsText) —— 这是本批的交付目标
//   (任务单 §1 明确要求三份拆解落库). ⚠️ 因此本表内容**禁止进日志 / crash report**;
//   诊断侧只出码与计数 (沿用 P1e 规矩).
//
//   时间戳: 2026-11-10 GMT+8

import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * ap_practice_turns 表 —— 自动对练**轮次级**的来访者语义落库.
 *
 * 一行 = 一场里的一轮 (咨询师说一句 → 来访者回一句).
 */
@Entity('ap_practice_turns')
// 幂等 upsert 的依据: 同一场的同一轮只可能有一行.
@Index('uk_ap_turns_session_turn', ['practiceSessionId', 'turnIndex'], { unique: true })
export class PracticeTurn {
  /**
   * 主键 (UUID v4, 由应用层用 `node:crypto` 的 randomUUID 生成).
   *
   * 为什么不用 `@PrimaryGeneratedColumn('uuid')`: 那条路走 TypeORM 的 uuid 生成器,
   * 它在运行时 `require('uuid')` —— 本仓库没有 uuid 依赖, 启动即炸.
   */
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  /** 所属场次 id (ap_practice_sessions.id; 应用层校验, 不加 DB FK). */
  @Column({ type: 'varchar', length: 64, name: 'practice_session_id' })
  practiceSessionId!: string;

  /** 轮次序号 (从 1 起, 与逐字稿轮次同口径). */
  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  /**
   * 来访者这一轮的**纯文本** (不含任何标记).
   *
   * NULL = 这一轮没落 (老场次 / 解析前就失败) —— 不回填, 不伪造.
   */
  @Column({ type: 'text', nullable: true, name: 'visitor_display_text' })
  visitorDisplayText!: string | null;

  /**
   * 来访者这一轮的 **TTS 文本** (带 MiniMax 标记: `(sighs)` / `<#0.5#>`).
   *
   * 情绪**不在这里** —— 情绪走 TTS 请求的 voice_setting.emotion 参数, 不是文本.
   */
  @Column({ type: 'text', nullable: true, name: 'visitor_tts_text' })
  visitorTtsText!: string | null;

  /**
   * 语义中间表示 (SemanticTurn 的 JSON).
   *
   * ⚠️ 用 LONGTEXT 而不是 MySQL 的 JSON 类型:
   *   JSON 列会在**写入时**校验合法性并做内部规范化 —— 一旦 parser 产出畸形结构,
   *   整行直接写不进去 (语义落库失败 = 这一轮的数据丢了). LONGTEXT 只存字符串,
   *   写进去什么就是什么, 解析留给读侧.
   */
  @Column({ type: 'longtext', nullable: true, name: 'visitor_semantic_json' })
  visitorSemanticJson!: string | null;

  /**
   * 解析降级级别 (0 干净 / 1 轻度 / 2 重度).
   *
   * NULL = 这一轮没走过语义解析 (老场次). **别把 NULL 当 0** ——
   * 0 是"解析过且干净", NULL 是"没解析过", 两件事.
   */
  @Column({ type: 'tinyint', nullable: true, name: 'visitor_semantic_level' })
  visitorSemanticLevel!: number | null;

  /**
   * 语义层版本 (当前恒为 'semantic-v1').
   *
   * 用途: parser 的解析口径升级后 (比如标签表变了), 老行与新行靠这列区分 ——
   * 否则事后拿两批数据对比时, 分不清"数据不同"还是"解析口径不同".
   */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'visitor_semantic_version' })
  visitorSemanticVersion!: string | null;

  /** 落库时刻. */
  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  /** 最后一次写入时刻 (upsert 命中时刷新). */
  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}

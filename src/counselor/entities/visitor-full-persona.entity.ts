// V2026-10-21 治本 (V1.2 VS-B1 — M1 分层人设: visitor_full_personas 表):
//   原因: v1.2 spec §4.1 要求 AI 持有一套"底层全量人生剧本" (7 大块: 基础信息 / 成长时间线 /
//     内在工作模型 / 社会关系图谱 / 应对模式 / 咨询预设 / 当前主诉), 作为所有情绪 / 反应 /
//     用词的推导基准, 保证来访者行为自洽. 现状 (2026-10-21 扫描) 是:
//       - long_term_cases.visitor_persona: 8 字段浅层 json (name/age/occupation/complaint/
//         background/defenseLevel/emotionBaseline/keyTopics), **不含** 成长时间线 / 内在工作模型
//       - training_sessions.persona*: 5 字段浅层 (单次训练用)
//       - agent 侧 Persona 实体 (src/agent/persona/): 另一套体系, 走内存 Repository, 与 counselor 0 交集
//     即: 咨询师端的来访者"内心戏"目前无处存放 → v1.2 §4.2 的"信息暴露节奏"无从谈起.
//   修法: 新建 visitor_full_personas 表, 7 大块各占 1 个 json 列.
//   反双胞胎:
//     - 不用 1 个 json 列塞 7 大块: 无法对单块做 SQL 过滤/统计; 拆 7 列, 未来要按
//       "防御水平"筛人设时可直接加索引
//     - 不加 DB-level FK 到 long_term_cases: 跟仓库既有 pattern 一致 (soft delete 兼容,
//       见 knowledge_chunks.itemId / long_term_case_sessions.caseId)
//     - 不落"信任度"在 7 大块里: 信任度是**关系演进状态** (随会谈加深而上升), 独立成列
//     - 不删 long_term_cases.visitor_persona: v1.2 §4.3 明确保留它做 L1 冷启动 (浅 → 深两层)
//     - 不在本表存"已解锁档案": 那是会话演进产物, 走独立表 case_profile_entries
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 migration:run 后 SHOW CREATE TABLE visitor_full_personas → 7 个 JSON 列 + 3 索引
//     3. 长程个案创建时同步生成 1 份 → SELECT COUNT(*) = 1
//   时间戳: 2026-10-21

import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH } from '../config/visitor-pool.config';
import type {
  VisitorPersonaBasics,
  VisitorPersonaCoping,
  VisitorPersonaDevelopmentalStage,
  VisitorPersonaInnerWorkingModel,
  VisitorPersonaPresentingIssue,
  VisitorPersonaSocialRelation,
  VisitorPersonaTherapyExpectation,
} from '../domain/visitor-persona/visitor-persona.types';

/**
 * AI 底层全量人设 (AI 独享, 用户默认不可见).
 *
 * 跟 `long_term_cases.visitor_persona` (8 字段浅层) 是**深 / 浅**关系, 不是替代:
 * 浅层 = 冷启动 + 列表展示; 本表 = AI 行为基准 + 动态解锁的锚点来源.
 */
@Entity('visitor_full_personas')
@Index('idx_vfp_tenant_user', ['tenantId', 'userId'])
@Index('uniq_vfp_case', ['caseId'], { unique: true })
export class VisitorFullPersona {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
  @Column({ type: 'char', length: 36, name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'char', length: 36, name: 'user_id' })
  userId!: string;

  /**
   * 归属长程个案 id (long_term_cases.id), **可空**.
   *
   * 为可空: 全量人设在"个案配置页"阶段生成 (v1.2 §3 链路: 配置页 → 初访 → 分流),
   * 那时还不知道这一个个案最终会不会转长程; 转长程时回填本列.
   *
   * UNIQUE 索引保证"1 个长程个案 ↔ 1 份全量人设" (MySQL unique 索引视多个 NULL 为互不相同,
   * 所以未归属的草稿可以有任意多份).
   */
  @Column({ type: 'char', length: 36, name: 'case_id', nullable: true })
  caseId!: string | null;

  /**
   * 来源公共模板 id (visitor_pool_templates.id), **可空**.
   *
   * V2026-10-23 治本 (AI 模拟来访池 §2.2 — 公共模板 + 克隆实例化):
   *   原因: 公共人物供给层上线后, 一条全量人设有两种来源:
   *     ① 用户自建 / 随机生成 (老路径) → 本列为 null
   *     ② 从公共模板**克隆**的私有副本 (新路径) → 本列 = 模板 id
   *   没有这一列就分不清副本的出处, 「我到底是从哪个官方人物起步的」无从追溯,
   *   公共库下架某个模板时也无法定位其衍生副本.
   *   修法: 加独立可空列 source_template_id; **不加 DB-level FK** (跟仓库既有
   *     pattern 一致: long_term_case_sessions.caseId 等均为应用层校验, 软删兼容).
   *   反双胞胎:
   *     - 不把模板 id 塞进 display_name / basics: 那会让"人设内容"与"人设来源"两个
   *       正交维度纠缠, 换库时无法追源
   *     - 不加 UNIQUE: 同一个人应当能多次实例化同一模板 (spec §3.3 幂等语义),
   *       每次得到独立副本, 所以这里**不能**加唯一约束
   *   验证: 1. tsc 0 错  2. 实例化后 SELECT source_template_id = 模板 id
   *   时间戳: 2026-10-23
   */
  @Column({ type: 'varchar', length: VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH, name: 'source_template_id', nullable: true })
  sourceTemplateId!: string | null;

  /**
   * 来访者代号 (视图 A 的可编辑字段之一).
   *
   * V2026-10-21 治本 (V1.2 VS-B1 — 补 spec §4.2 的字段缺口):
   *   原因: spec §4.2 视图 A 表格把「代号 / 年龄 / 性别 / 职业」映射到 `basics.{age,gender,occupation}`
   *     —— **代号没有落点** (spec 的 7 大块 basics 里确实没有 name 字段). 但代号在本产品里是
   *     必需项: visitor prompt 渲染成 "你叫 XXX", 且视图 A 明确要求它可编辑.
   *   修法: 本表加独立 display_name 列, 不塞进 basics (basics 严格对齐 spec 的 7 大块契约,
   *     将来若与前端/上游对齐时 basics 结构有出入, 只需改 1 处 json 映射, 不动本列).
   *   反双胞胎:
   *     - 不复用 long_term_cases.visitor_persona.name: 全量人设在"个案配置页"阶段就生成,
   *       那时还没关联长程个案, 且本表必须自包含 (AI 的锚点)
   *     - 不把它合进 basics json: basics 是 spec 拍板的 7 大块契约, 私自加字段会破坏 1:1 wire
   *   验证: 1. tsc 0 错  2. 建个案时代号可读写
   *   时间戳: 2026-10-21
   */
  @Column({ type: 'varchar', length: 100, name: 'display_name' })
  displayName!: string;

  // ─── 1. 基础信息 ───
  @Column({ type: 'json' })
  basics!: VisitorPersonaBasics;

  // ─── 2. 成长时间线 (5 段) ───
  @Column({ type: 'json', name: 'developmental_timeline' })
  developmentalTimeline!: VisitorPersonaDevelopmentalStage[];

  // ─── 3. 内在工作模型 ───
  @Column({ type: 'json', name: 'inner_working_model' })
  innerWorkingModel!: VisitorPersonaInnerWorkingModel;

  // ─── 4. 社会关系图谱 ───
  @Column({ type: 'json', name: 'social_map' })
  socialMap!: VisitorPersonaSocialRelation[];

  // ─── 5. 应对模式 ───
  @Column({ type: 'json' })
  coping!: VisitorPersonaCoping;

  // ─── 6. 咨询预设 ───
  @Column({ type: 'json', name: 'therapy_expectation' })
  therapyExpectation!: VisitorPersonaTherapyExpectation;

  // ─── 7. 当前主诉 ───
  @Column({ type: 'json', name: 'presenting_issue' })
  presentingIssue!: VisitorPersonaPresentingIssue;

  /**
   * 当前咨访信任度 0-1 (信息暴露节奏的驱动值, v1.2 §4.1).
   *
   * 分级阈值见 domain/visitor-persona/visitor-persona.types.ts 的 TRUST_LEVEL_THRESHOLDS:
   *   0.0-0.3 只答表层 / 0.3-0.6 谈关系 / 0.6-0.8 谈情绪 / 0.8+ 才允许碰禁忌话题.
   *
   * 为什么是**长程级**而不是"每场会谈一个值": 信任度随咨访关系加深而累积上升,
   * 下一场会谈的暴露节奏取决于"到目前为止建立了多少信任" → 存当前值, 会谈结束回写.
   * (历史轨迹由 case_profile_entries.sessionId 承载, 不另存时间序列.)
   */
  @Column({ type: 'float', name: 'trust_level', default: 0.2 })
  trustLevel!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 counselor 其它 10 个 entity 一致, 非 @DeleteDateColumn → 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}

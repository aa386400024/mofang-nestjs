// V2026-10-23 治本 (AI 模拟来访池 — visitor_pool_templates 公共模板表):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §2.1 要求一张**公共只读**模板表,
//     承载"人物内容层"的供给: 表层卡片字段 + 7 大块全量剧本快照. 现状 (2026-10-23 扫描):
//       - `visitor_full_personas` 虽有 7 大块, 但它是**用户私有副本**表 (tenant_id/user_id
//         必填, 带 trust_level / case_id), 无法表达"全局共享的官方人物"
//       - `practice_scenarios` 是技能场景, 不是人物 (无 7 大块剧本, 无防御机制)
//       - 全仓 grep 'visitor_pool|visitorPool|人物池|来访池' → 0 命中, 本表无孪生
//     ⇒ 公共供给层确实缺一张表.
//
//   修法: 新建 `visitor_pool_templates` (system 级, 全局只读), 落 spec §2.1 的 17 列.
//
//   反双胞胎:
//     - **不落 tenant_id / user_id**: spec §2.1 明确「system 级, 无个人 userId」.
//       公共模板不属于任何租户/用户, 隔离靠「只读 + 无个人数据」而不是靠 tenant 过滤.
//       (若将来要按租户定制官方库, 应另开一张「租户可见性」关系表, 而不是给内容表
//        加 owner 字段 —— 内容与可见性是两件事.)
//     - **script 存 1 个 json 列, 不拆 7 列**: 与 `visitor_full_personas` 拆 7 列的理由
//       (那边要按单块做 SQL 过滤/统计) 不同 —— 模板的 7 大块**永远整体读写**
//       (生成时整体产出、克隆时整体快照), 没有任何按块过滤的需求. 拆 7 列反而制造
//       「模板表 7 列 ↔ 副本表 7 列」两套同构但独立演化的结构, 克隆时的字段映射
//       迟早漏字段. 单 json 列让克隆 = 一次整体赋值, 结构上不可能漏.
//     - **不落 trust_level**: 信任度是**咨访关系演进状态** (随会谈加深而上升),
//       属于私有副本, 公共模板挂信任度 = 全局共享的可变状态, 必然串号.
//     - **不落任何计数字段** (使用数/收藏数/评分): 零压红线, 列都不存在 = 物理上不可能下发.
//     - **不用 @DeleteDateColumn**: 跟 counselor 既有 21 个 entity 一致, 软删查询手写
//       `deletedAt: IsNull()` (仓库硬约束 #2).
//     - **不加 DB-level FK**: 跟 ADR-0003 一致, 跨表引用应用层校验.
//
//   验证 (大炮跑 pnpm migration:run 后):
//     1. SHOW TABLES LIKE 'visitor_pool_templates'; # 1 张表
//     2. DESCRIBE visitor_pool_templates; # 17 列
//     3. SHOW INDEX FROM visitor_pool_templates; # PRIMARY + 2 复合索引
//     4. 全表 grep 'trust_level\|count\|score' 列名命中数 = 0
//     5. npm run seed:visitor-pool → 6 行, 连跑两次行数不变
//
//   时间戳: 2026-10-23
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH } from '../config/visitor-pool.config';
import type { VisitorFullPersonaScript } from '../domain/visitor-persona/visitor-persona.types';
import type { TrainingDifficulty } from '../enums/training-difficulty.enum';
import type { VisitorPoolDefenseType, VisitorPoolIssueDomain, VisitorPoolSource } from '../enums/visitor-pool.enum';
import type { VisitorStyle } from '../enums/visitor-style.enum';

/**
 * visitor_pool_templates 表 —— 公共来访模板 (全局只读).
 *
 * 语义: 这是「人物内容层」的**公共供给**. 任何人启动同一官方人物, 都会在
 * `visitor_full_personas` 克隆出**各自独立**的私有副本; 模板本身**永远不被回写**
 * (会谈进展 / 信任度变化 / 档案解锁都只落在私有副本上).
 */
@Entity('visitor_pool_templates')
// 图鉴筛选条的主查询路径: 「已上架 + 某议题领域」.
@Index('idx_vpt_enabled_domain', ['enabled', 'issueDomain'])
// 图鉴筛选条的次查询路径: 「已上架 + 某难度档」.
@Index('idx_vpt_enabled_difficulty', ['enabled', 'difficulty'])
export class VisitorPoolTemplate {
  /**
   * 公共模板 id (稳定 slug, 兼对外契约).
   *
   * V2026-10-23 治本 (seed 失败 — "Data too long for column 'id'" 的根因修复):
   *   原因: 本列原先声明为 `@PrimaryGeneratedColumn('uuid')` + 建表 `CHAR(36)`, 而实际
   *     写入的是**内容 slug** (形如 `vpt_self_worth_intellectualization_l1` = 37 字符):
   *     ① 列宽与 id 方案错配 → 种子第 5 条被 MySQL 拒收;
   *     ② 更隐蔽的是 `PrimaryGeneratedColumn('uuid')`: 任何**不传 id** 的 insert 会
   *        静默拿到一个随机 UUID —— 而 AI 生成端点 (admin service) 正是那样的路径,
   *        结果库里会混入"内容派生但 id 随机"的行, 破坏"id 可由内容复现"的不变量.
   *   修法: 改为 `@PrimaryColumn({ type: 'varchar', length: 64 })` (与仓库既有
   *     `quotes.id` 严格同范式) + 列宽统一到 VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH;
   *     所有写入方必须**显式**给 id (seed 给内容 slug, AI 生成给 `vpt_gen_<uuid32>`).
   *   反双胞胎: 不用「UUID 主键 + 另加 slug 列」—— 那会让对外的 templateId 变成不透明
   *     UUID, 而 spec §3.1/§3.3 的响应示例里 templateId 本身就是 `tpl_01` 这类 slug.
   *   验证: 1. tsc 0 错  2. seed 6 条全部入库  3. AI 生成端点产出的 id 形如 vpt_gen_<32hex>
   *   时间戳: 2026-10-23
   */
  @PrimaryColumn({ type: 'varchar', length: VISITOR_POOL_TEMPLATE_ID_MAX_LENGTH })
  id!: string;

  /**
   * 匿名称呼 (中性乳名), 例「晚晴」.
   *
   * 不是"名字", 是**代号**: 公共库里的来访者一律匿名化, 避免与真实来访混淆.
   * 命名规则 (形态/中性/不撞真实人/去重尾号) 由 config/visitor-pool-codename.ts 统一维护.
   */
  @Column({ type: 'varchar', length: 100 })
  codename!: string;

  /**
   * 年龄区间, 例「28-35」.
   *
   * 只存区间不存精确生日: 精确生日 + 其他字段组合会让公共人物变得可识别 (spec §2.1).
   */
  @Column({ type: 'varchar', length: 20, name: 'age_range' })
  ageRange!: string;

  /** 初次见面主动呈现的一句话主诉 (卡片副标题) */
  @Column({ type: 'varchar', length: 300, name: 'presenting_complaint' })
  presentingComplaint!: string;

  /**
   * 主导防御类型 (主一种, 锁定不可临场改).
   *
   * 与 `style_hint` 正交: 防御类型 = 内在防御机制; 配合风格 = 训练中呈现的姿态.
   */
  @Column({ type: 'varchar', length: 20, name: 'defense_type' })
  defenseType!: VisitorPoolDefenseType;

  /** 议题领域 (可扩展集合) */
  @Column({ type: 'varchar', length: 20, name: 'issue_domain' })
  issueDomain!: VisitorPoolIssueDomain;

  /** 推荐训练目标, 例「练开放式提问与情绪反射」 (写技术目标, 不写诊断/治疗目标) */
  @Column({ type: 'varchar', length: 200, name: 'training_goal' })
  trainingGoal!: string;

  /** 难度档 (L1 配合度最高) */
  @Column({ type: 'varchar', length: 4 })
  difficulty!: TrainingDifficulty;

  /** 案例来源 (本期恒为 official) */
  @Column({ type: 'varchar', length: 20, default: 'official' })
  source!: VisitorPoolSource;

  /**
   * 配合风格 (映射仓库既有 VisitorStyle).
   *
   * 实例化时作为私有副本的呈现姿态默认值; **公共列表响应不下发** (前端契约 §4:
   * styleHint 由实例化响应的 defaultPreset 返回).
   */
  @Column({ type: 'varchar', length: 20, name: 'style_hint', default: 'cooperative' })
  styleHint!: VisitorStyle;

  /** 人物默认情绪基线 0-1 (微调起点) */
  @Column({ type: 'float', name: 'emotion_baseline_default', default: 0.35 })
  emotionBaselineDefault!: number;

  /** 人物默认防御水平 0-1 (微调起点; 与防御**类型**是两回事) */
  @Column({ type: 'float', name: 'defense_level_default', default: 0.2 })
  defenseLevelDefault!: number;

  /**
   * 7 大块全量剧本快照 (basics / developmentalTimeline / innerWorkingModel /
   * socialMap / coping / therapyExpectation / presentingIssue).
   *
   * **公共接口绝不下发**: 只在实例化时由服务端内部读取, 整体快照进私有副本.
   */
  @Column({ type: 'json' })
  script!: VisitorFullPersonaScript;

  /** 上下架开关: 1 = 已上架 (公共图鉴可见), 0 = 草稿 (仅管理端可见) */
  @Column({ type: 'tinyint', default: 1 })
  enabled!: boolean;

  /** 图鉴排序 (小的在前) */
  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // 软删 (跟 counselor 既有 entity 一致, 非 @DeleteDateColumn → 查询需手写 IsNull()).
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}

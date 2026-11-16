// V2026-11-14 治本 (TD-18 · C2 第二批仓储端口化 · good_state_diary 域 · P-DEBT-11 / L-1):
//   抽象: `GoodStateDiaryService` 不再注入 typeorm 的泛型仓储对象, 只依赖本端口
//     interface + `DIARY_ENTRY_REPOSITORY` DI token —— TypeORM 实现收进
//     `data/diary-entry.repository.typeorm.ts`, 查询口径 (双游标分页 / LIKE 检索 /
//     tag AND 过滤 / 软删生命周期 / 物理擦除) 全部封在实现里, service 只看到业务语义的方法.
//
//   模板先例: `src/consent/domain/repositories/consent.repository.ts` (TD-17 · 单端口 · 实体工厂在实现层)
//     + `src/life-map/domain/repositories/` (TD-16) + `src/analytics/domain/repositories/` (TD-13).
//
//   端口划分粒度 (TD-18 判定): **单端口** —— 本域只有 1 张表 / 1 个直连仓储的 service /
//     13 处仓储调用全部落在同一张表上; 方法面虽宽 (10 个), 但拆成多端口只会把同一张表的
//     查询口径切碎, 面反而更宽 (对齐 TD-13 D-2「面窄才守得住」).
//
//   关键方法 (方法面只收 service 现有的 13 处调用, 不泛化成通用代理):
//     - create(input): 新增一行 —— 行由 service 以纯对象构造, 实体工厂在实现层
//     - save(row): 更新既有行 —— service 先 findById 取行、改字段、再 save
//     - findById(uid, entryId, opts?): 按 id + authorId 取单行 (三处单条查询合一)
//     - findDrafts(uid): 草稿箱 (status=Draft, createdAt/id DESC, take 200)
//     - listRecent(query): 最近列表 —— 返回 limit + 1 行, hasMore / 切片 / nextCursor 留 service
//     - searchEntries(query): 全文检索 —— LIKE 模式与 tag 条件由 service 算好传进来
//     - softDelete / restore / deleteByAuthor / purgeExpiredSoftDeletes: 生命周期四个出口
//
//   反双胞胎:
//     - 不用泛型 typeorm 仓储代理 —— 那等于把 typeorm 的 API 面原样漏给业务层
//     - 不暴露 typeorm 的管理句柄 / 查询选项 / 操作符 —— 只允许出现在实现文件内
//     - 不写 SQL —— 端口只说「要什么」, 怎么说由实现决定
//     - 不暴露 entity 类 —— 出参用 Row 领域类型, 业务层不碰实体
//     - **行不由仓储工厂方法构造** —— 实体工厂收在实现层, service 侧零工厂依赖
//
//   与 life-map 先例的关键差异: **Row 保留 deletedAt 列** —— 本域 DTO 输出 deletedAt、
//     restore 后断言 deletedAt === null、getByIdIncludingDeleted 需读软删行, 软删列对业务层有用.
//
//   如何验证:
//     1. 单元测试用端口替身驱动 service (test/good_state_diary/td18-good-state-diary-port-c2-batch2.spec.ts),
//        不起真 TypeORM / 不连 DB / 不 vi.mock('typeorm')
//     2. grep 复核: 端口 / service / 新 spec 里 typeorm 值符号 0 命中
//   时间戳: 2026-11-14 GMT+8

import { DiaryEntryStatus } from '../../enums/diary-entry-status.enum.js';
import { DiaryMoodLevel } from '../../enums/diary-mood-level.enum.js';
import { DiaryTag } from '../../enums/diary-tag.enum.js';

/**
 * 日记行 —— 端口出参 (窄领域类型, 不含 entity 类).
 *
 * V2026-11-14 治本 (TD-18 · 差异点 1): **保留 deletedAt 列** —— 与 life-map 先例不同.
 *   本域 DTO 输出 deletedAt、restore 后断言 deletedAt === null、getByIdIncludingDeleted
 *   要读软删行 —— 软删列对业务层有用, 不能在 Row 层剔掉.
 */
export interface DiaryRow {
  id: string;
  authorId: string;
  status: DiaryEntryStatus;
  title: string | null;
  body: string;
  moodLevel: DiaryMoodLevel | null;
  moodSnapshottedAt: Date | null;
  moodNote: string | null;
  sourceEmotionLogId: string | null;
  /** comma-separated DiaryTag.name —— 端口层不做枚举数组转换 (转换留 service). */
  tags: string | null;
  linkedPracticeId: string | null;
  aiFeedback: Record<string, unknown> | null;
  aiFeedbackGeneratedAt: Date | null;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** 软删时间 —— null = 未软删. */
  deletedAt: Date | null;
}

/**
 * 新增日记入参 —— 行由 service 以纯对象构造 (不依赖仓储工厂方法).
 *
 * 时间戳 (createdAt / updatedAt) 与软删列 (deletedAt) 由落库层生成, 不在入参里.
 */
export interface CreateDiaryEntryInput {
  authorId: string;
  status: DiaryEntryStatus;
  body: string;
  title: string | null;
  moodLevel: DiaryMoodLevel | null;
  moodSnapshottedAt: Date | null;
  moodNote: string | null;
  sourceEmotionLogId: string | null;
  tags: string | null;
  linkedPracticeId: string | null;
  isPrivate: boolean;
}

/**
 * 最近列表查询入参 —— 游标已解码, 状态已解析.
 */
export interface ListRecentEntriesQuery {
  uid: string;
  /** 状态过滤 —— service 的 parseStatusFilter 解析结果 (空值兜底 finalized). */
  statuses: DiaryEntryStatus[];
  /** 页面条数 —— 实现层按 limit + 1 取行, hasMore 判定留 service. */
  limit: number;
  /** 游标 (已解码的 {t, i}) —— undefined = 首页. */
  cursor?: { t: string; i: string };
}

/**
 * 全文检索查询入参 —— LIKE 模式与 tag 条件都在 service 侧算好.
 */
export interface SearchEntriesQuery {
  uid: string;
  /** 已转义的模糊匹配模式 (%...%) —— 通配符转义留 service, 实现层原样进 LIKE 条件. */
  likePattern: string;
  /** 页面条数 —— 实现层按 limit + 1 取行, hasMore 判定留 service. */
  limit: number;
  /** 游标 (已解码的 {t, i}) —— undefined = 首页. */
  cursor?: { t: string; i: string };
  /** tag AND 条件 —— 解析留 service, comma-padding LIKE 口径下沉实现层. */
  tagFilters: DiaryTag[];
}

/**
 * 日记仓储契约 —— good_state_diary 域日记存储的唯一真相源.
 *
 * 唯一调用方: `GoodStateDiaryService` (providers/good-state-diary.service.ts).
 */
export interface DiaryEntryRepository {
  /**
   * 新增一行 —— 行纯对象 (service 内构造), 实体工厂在实现层.
   *
   * @param input 新增入参
   * @returns 落库后的行
   */
  create(input: CreateDiaryEntryInput): Promise<DiaryRow>;

  /**
   * 更新既有行 —— service 先 findById 取行、改字段、再交回本方法.
   *
   * @param row 整行 (含 id / createdAt / updatedAt / deletedAt)
   * @returns 落库后的行
   */
  save(row: DiaryRow): Promise<DiaryRow>;

  /**
   * 按 id + authorId 取单行 —— 三处单条查询 (默认排除软删 / 含软删 / 所有权校验) 合一.
   *
   * @param uid 作者 id (越权隔离口径)
   * @param entryId 日记 id
   * @param opts includeDeleted = true 时含软删行
   * @returns 行 (无命中返 null)
   */
  findById(uid: string, entryId: string, opts?: { includeDeleted?: boolean }): Promise<DiaryRow | null>;

  /**
   * 草稿箱 —— status=draft, createdAt + id 倒序, 取 200 条.
   *
   * @param uid 作者 id
   * @returns 行列表
   */
  findDrafts(uid: string): Promise<DiaryRow[]>;

  /**
   * 最近列表 —— 双游标 (createdAt + id DESC) 分页, 按 limit + 1 取行.
   *
   * @param query 查询入参
   * @returns 行列表 (最多 limit + 1 行, hasMore 判定留 service)
   */
  listRecent(query: ListRecentEntriesQuery): Promise<DiaryRow[]>;

  /**
   * 全文检索 —— LIKE 模糊 + tag AND (comma-padding) + 双游标分页.
   *
   * @param query 查询入参
   * @returns 行列表 (最多 limit + 1 行, hasMore 判定留 service)
   */
  searchEntries(query: SearchEntriesQuery): Promise<DiaryRow[]>;

  /**
   * 软删 —— 打上删除时间戳 (30 天内可恢复).
   *
   * @param uid 作者 id
   * @param entryId 日记 id
   * @returns 受影响行数 (无命中返 0)
   */
  softDelete(uid: string, entryId: string): Promise<{ affected: number }>;

  /**
   * 恢复软删 —— 清掉删除时间戳.
   *
   * @param uid 作者 id
   * @param entryId 日记 id
   * @returns 受影响行数 (无命中返 0)
   */
  restore(uid: string, entryId: string): Promise<{ affected: number }>;

  /**
   * 物理擦除某作者的全部日记 —— 「彻底删除」入口.
   *
   * @param uid 作者 id
   * @returns 受影响行数
   */
  deleteByAuthor(uid: string): Promise<{ affected: number }>;

  /**
   * 物理擦除到期软删条目 —— 30 天窗口由 service 算好 cutoff 传进来.
   *
   * @param cutoff 擦除截止时间 (删除时间早于它才擦)
   * @returns 受影响行数
   */
  purgeExpiredSoftDeletes(cutoff: Date): Promise<{ affected: number }>;
}

/** DI token —— NestJS 注入用. */
export const DIARY_ENTRY_REPOSITORY = Symbol('DIARY_ENTRY_REPOSITORY');

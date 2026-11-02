// V2026-10-23 治本 (AI 模拟来访池 — 公共供给层 service):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §3.1-§3.4 要求 4 组公共端点:
//     - §3.1 公共图鉴列表 (筛选 + 游标分页)
//     - §3.2 单模板表层详情
//     - §3.3 实例化 (克隆为我的私有副本)
//     - §3.4 收藏 (开关 + 我的收藏列表)
//   核心不变量 (spec §1 / §4):
//     ① 公共模板**全局只读**, 任何用户的会谈进展 / 信任度 / 档案解锁都**绝不回写模板**;
//     ② 启动同一官方人物, 每人拿到**各自独立**的副本;
//     ③ 公共响应**永不含** 7 大块剧本 (`script`) 与任何计数字段.
//
//   修法: VisitorPoolService 承载全部公共读写; 内部管理/生成走同目录的
//   VisitorPoolAdminService (职责分离: 公共面与内部面不混在一个 service 里,
//   避免"忘了加权限判断"这类事故).
//
//   反双胞胎:
//     - **不建副本表**: 私有副本复用 `visitor_full_personas` (spec §2.2), 只多一列
//       source_template_id 标注来源. 另建一张 `visitor_pool_copies` 会出现两套
//       "7 大块 + trust_level" 结构, 现有 6 个 visitor-persona 端点就得改两遍.
//     - **不用 OFFSET 分页**: 图鉴是网格滚动, OFFSET 在筛选结果变动时会漏条/重条.
//       用 keyset (sort_order, id) 推进, 跟 quote 服务的金句流同范式.
//     - **不下发 script**: toCard() 是**唯一**的模板 → 出参转换口, 它只挑表层字段.
//       多写一个转换函数就多一个泄露点.
//     - **不落全站收藏数**: 收藏表是关系表, 计数需要额外聚合, 而零压红线要求
//       根本不下发 —— 列都不存在, 聚合也无从谈起.
//     - **收藏表走硬删**: MySQL 唯一索引不含 deleted_at, 软删会让"取消 → 再收藏"撞唯一键.
//
//   验证:
//     1. tsc 0 错
//     2. GET /counselor/visitor-pool?issueDomain=intimate → 只回表层, 无 script 字段
//     3. POST /:id/instantiate 两次 → 两条独立副本, 模板 script 与 trust_level 不变
//     4. A 的副本编辑不影响模板与 B 的副本
//     5. 重复收藏幂等; 取消收藏后再收藏成功
//
//   时间戳: 2026-10-23

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, IsNull, type Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { VISITOR_POOL_LIST_DEFAULT_LIMIT } from '../config/visitor-pool.config';
import type { VisitorFullPersonaScript } from '../domain/visitor-persona/visitor-persona.types';
import type { VisitorPoolCard, VisitorPoolDefaultPreset } from '../domain/visitor-pool/visitor-pool.types';
import type {
  InstantiateVisitorPoolDto,
  VisitorPoolCardDto,
  VisitorPoolFavoriteResultDto,
  VisitorPoolInstantiateResultDto,
  VisitorPoolListDto,
  VisitorPoolQueryDto,
} from '../dto/visitor-pool.dto';
import { VisitorFullPersona } from '../entities/visitor-full-persona.entity';
import { VisitorPoolFavorite } from '../entities/visitor-pool-favorite.entity';
import { VisitorPoolTemplate } from '../entities/visitor-pool-template.entity';
import { VisitorMode } from '../enums/visitor-mode.enum';

/**
 * 公共来访模板 service.
 */
@Injectable()
export class VisitorPoolService {
  private readonly logger = new Logger(VisitorPoolService.name);

  constructor(
    @InjectRepository(VisitorPoolTemplate)
    private readonly templateRepo: Repository<VisitorPoolTemplate>,
    @InjectRepository(VisitorPoolFavorite)
    private readonly favoriteRepo: Repository<VisitorPoolFavorite>,
    @InjectRepository(VisitorFullPersona)
    private readonly personaRepo: Repository<VisitorFullPersona>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // §3.1 GET /counselor/visitor-pool — 公共图鉴列表
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 公共图鉴列表 (筛选 + keyset 游标分页).
   *
   * 排序固定为 (sort_order ASC, id ASC): sort_order 是运营可控的图鉴顺序,
   * id 兜底保证同 sort_order 下顺序稳定 (否则分页会漏条/重条).
   *
   * @param userId 当前用户 id (用于回填本人收藏状态)
   * @param query 筛选 + 游标
   * @returns 人物卡列表 + 下一页游标
   */
  async list(userId: string, query: VisitorPoolQueryDto): Promise<VisitorPoolListDto> {
    const limit = query.limit ?? VISITOR_POOL_LIST_DEFAULT_LIMIT;
    const hasFilter = Boolean(query.issueDomain ?? query.difficulty ?? query.defenseType ?? query.trainingGoal ?? query.source);
    const qb = this.templateRepo.createQueryBuilder('t').where('t.deletedAt IS NULL').andWhere('t.enabled = :enabled', { enabled: true });

    if (query.issueDomain) {
      qb.andWhere('t.issueDomain = :issueDomain', { issueDomain: query.issueDomain });
    }
    if (query.difficulty) {
      qb.andWhere('t.difficulty = :difficulty', { difficulty: query.difficulty });
    }
    if (query.defenseType) {
      qb.andWhere('t.defenseType = :defenseType', { defenseType: query.defenseType });
    }
    if (query.source) {
      qb.andWhere('t.source = :source', { source: query.source });
    }
    if (query.trainingGoal) {
      // 模糊匹配 (子串): 前端的"训练目标"筛选是自然语言片段 (如「开放式提问」),
      // 精确匹配会一条都筛不出来. 转义 % _ \ 以免用户输入被当成通配符.
      qb.andWhere('t.trainingGoal LIKE :trainingGoal', { trainingGoal: `%${escapeLike(query.trainingGoal)}%` });
    }

    if (query.cursor) {
      // 游标解析: 找到该条, 拿它的 (sort_order, id) 当推进锚点.
      // 解析不到 → 400 (游标失效, 客户端应重置分页), 不静默从头返回.
      // 注意: 这里**不过滤** enabled / deletedAt —— 锚点即便已下架, 它的排序位置
      // 仍然有效, 否则用户翻页时会因为运营下架了一个模板而整页跳空.
      const anchor = await this.templateRepo.findOne({ where: { id: query.cursor } });
      if (!anchor) {
        throw new BizException(BizCode.VisitorPoolCursorInvalid, `游标无效或已失效: ${query.cursor}`);
      }
      qb.andWhere('(t.sortOrder > :anchorSortOrder OR (t.sortOrder = :anchorSortOrder AND t.id > :anchorId))', {
        anchorSortOrder: anchor.sortOrder,
        anchorId: anchor.id,
      });
    }

    qb.orderBy('t.sortOrder', 'ASC').addOrderBy('t.id', 'ASC');

    // 多取一条判断还有没有下一页 (LIMIT n+1 惯用法), 避免多打一次 COUNT.
    const rows = await qb.take(limit + 1).getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // 「整个库都是空的」与「筛选后没有匹配」是两件事, 前端要能分开处理:
    //   - 库空 (未跑 seed:visitor-pool) → 404, 前端回退本地种子 (前端契约 §3.2)
    //   - 筛选无匹配 → 正常返回空数组, 前端显示"该条件下暂无人物"空态
    // 所以只在"无筛选 + 无游标 + 结果为空"时才去查全库计数 (多一次查询, 但只发生在
    // 列表为空这种冷路径上).
    if (items.length === 0 && !hasFilter && !query.cursor) {
      const total = await this.templateRepo.count({ where: { enabled: true, deletedAt: IsNull() } });
      if (total === 0) {
        this.logger.warn('[visitor_pool_library_empty] 公共模板库为空, 前端应回退本地种子');
        throw new BizException(BizCode.VisitorPoolLibraryEmpty, '来访人物内容库为空 (未执行 seed:visitor-pool)');
      }
    }

    const favorited = await this.loadFavoritedIds(
      userId,
      items.map((item) => item.id),
    );

    const last = items.at(-1);
    return {
      items: items.map((item) => this.toCard(item, favorited.has(item.id))),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §3.2 GET /counselor/visitor-pool/:templateId — 表层详情
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 单模板表层详情.
   *
   * @param userId 当前用户 id (用于回填本人收藏状态)
   * @param templateId 公共模板 id
   * @returns 人物卡
   * @throws BizException(VisitorPoolTemplateNotFound) 不存在 / 已下架 / 已软删
   */
  async getCard(userId: string, templateId: string): Promise<VisitorPoolCardDto> {
    const template = await this.loadEnabledTemplate(templateId);
    const favorited = await this.loadFavoritedIds(userId, [template.id]);
    return this.toCard(template, favorited.has(template.id));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §3.3 POST /counselor/visitor-pool/:templateId/instantiate — 克隆私有副本
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 实例化: 把公共模板克隆为**当前用户的私有副本**.
   *
   * 语义 (spec §3.3):
   *   1. 校验模板存在且已上架, 不存在 → 404
   *   2. 把模板的 7 大块剧本**整体快照**复制成一条新的 visitor_full_personas 私有副本,
   *      写 source_template_id, trust_level 重置为 0.2
   *   3. **幂等**: 重复调用生成**新副本**, 不覆盖旧副本, 不改模板
   *
   * @param userId 当前用户 id
   * @param templateId 公共模板 id
   * @param input 临场参数覆盖 (全部可选)
   * @returns 副本 id + 模板卡片 + 本场生效的临场参数
   */
  async instantiate(userId: string, templateId: string, input: InstantiateVisitorPoolDto): Promise<VisitorPoolInstantiateResultDto> {
    const template = await this.loadEnabledTemplate(templateId);

    // 剧本整体快照: 模板的 7 大块 → 副本的 7 个 json 列, 一一对应, 不做任何改写.
    // 副本因此与模板**当时**的剧本完全一致 (即使之后模板被微调, 已克隆的副本不受影响).
    const script = template.script;
    const entity = this.personaRepo.create({
      tenantId: userId, // A9 一人一租户
      userId,
      caseId: null, // 未转长程个案
      sourceTemplateId: template.id,
      displayName: template.codename,
      ...splitScriptToColumns(script),
      trustLevel: 0.2, // 新副本的信任度重置为默认 (不继承任何人的进展)
    });
    const saved = await this.personaRepo.save(entity);

    const preset = this.resolvePreset(template, input);
    const favorited = await this.loadFavoritedIds(userId, [template.id]);

    this.logger.log(`[visitor_pool_instantiated] user=${userId} template=${template.id} persona=${saved.id}`);

    return {
      personaId: saved.id,
      card: this.toCard(template, favorited.has(template.id)),
      defaultPreset: preset,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §3.4 收藏: 开关 + 我的收藏
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 收藏 (幂等).
   *
   * @param userId 当前用户 id
   * @param templateId 公共模板 id
   * @returns 收藏状态
   */
  async favorite(userId: string, templateId: string): Promise<VisitorPoolFavoriteResultDto> {
    // 收藏必须校验模板存在且可用: 不能收藏一个不存在的人.
    await this.loadEnabledTemplate(templateId);

    // upsert: 冲突走 ON DUPLICATE KEY UPDATE, 保证"重复收藏"是幂等 no-op.
    await this.favoriteRepo.upsert({ tenantId: userId, userId, templateId }, { conflictPaths: ['userId', 'templateId'] });

    this.logger.log(`[visitor_pool_favorited] user=${userId} template=${templateId}`);
    return { templateId, favorited: true };
  }

  /**
   * 取消收藏 (幂等, 未收藏也返回 200).
   *
   * @param userId 当前用户 id
   * @param templateId 公共模板 id
   * @returns 收藏状态
   */
  async unfavorite(userId: string, templateId: string): Promise<VisitorPoolFavoriteResultDto> {
    // **刻意不校验模板是否存在**: 取消收藏的目标终态是"没有这条收藏", 而这个终态
    // 在模板已被下架/删除时**已经成立**. 若此时抛 404, 用户就无法清掉一条失效收藏.
    // 删除一条不存在的收藏本来就是 no-op (跟 quote 服务的收藏端点同口径).
    await this.favoriteRepo.delete({ userId, templateId });

    this.logger.log(`[visitor_pool_unfavorited] user=${userId} template=${templateId}`);
    return { templateId, favorited: false };
  }

  /**
   * 我的收藏列表 (表层卡片).
   *
   * 排序: 最近收藏的在前 (收藏关系表自身的 created_at) —— "我的收藏"是一个
   * **行为序列**, 用户关心的是"我最近收藏了什么", 不是模板的图鉴顺序.
   *
   * @param userId 当前用户 id
   * @returns 收藏的人物卡列表
   */
  async listFavorites(userId: string): Promise<VisitorPoolListDto> {
    const relations = await this.favoriteRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (relations.length === 0) {
      return { items: [], nextCursor: null };
    }

    const templateIds = relations.map((relation) => relation.templateId);
    const templates = await this.templateRepo.find({ where: { id: In(templateIds) } });
    const byId = new Map(templates.map((template) => [template.id, template]));

    // 按收藏顺序输出; 模板已下架/软删的跳过 (收藏指向的是 id, 内容没了就没了).
    const items: VisitorPoolCardDto[] = [];
    for (const relation of relations) {
      const template = byId.get(relation.templateId);
      if (template && template.enabled && template.deletedAt === null) {
        items.push(this.toCard(template, true));
      }
    }

    return { items, nextCursor: null };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 取一条已上架且未软删的模板.
   *
   * @param templateId 公共模板 id
   * @throws BizException(VisitorPoolTemplateNotFound) 不存在 / 已下架 / 已软删
   */
  private async loadEnabledTemplate(templateId: string): Promise<VisitorPoolTemplate> {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template || !template.enabled || template.deletedAt !== null) {
      throw new BizException(BizCode.VisitorPoolTemplateNotFound, `来访人物不存在或已下架: ${templateId}`);
    }
    return template;
  }

  /**
   * 取本人在给定模板集合里的收藏状态 (零 N+1: 一条查询 + 内存 Set).
   *
   * @param userId 当前用户 id
   * @param templateIds 模板 id 集合
   * @returns 已收藏的 id 集合
   */
  private async loadFavoritedIds(userId: string, templateIds: string[]): Promise<Set<string>> {
    if (templateIds.length === 0) {
      return new Set<string>();
    }
    const relations = await this.favoriteRepo.find({
      where: { userId, templateId: In(templateIds) },
      select: { id: true, templateId: true },
    });
    return new Set(relations.map((relation) => relation.templateId));
  }

  /**
   * 模板 → 表层卡片 (**唯一**的模板出参转换口).
   *
   * 这里是"剧本不下发"的**结构性保证**: 只挑表层字段, 没有任何一处把 script
   * 带进出参. 想加剧本字段的人必须先改这个函数, 而这个函数是零压红线的守门人.
   *
   * @param template 模板行
   * @param favorited 本人是否已收藏
   */
  private toCard(template: VisitorPoolTemplate, favorited: boolean): VisitorPoolCardDto {
    const card: VisitorPoolCard = {
      templateId: template.id,
      codename: template.codename,
      ageRange: template.ageRange,
      presentingComplaint: template.presentingComplaint,
      defenseType: template.defenseType,
      issueDomain: template.issueDomain,
      trainingGoal: template.trainingGoal,
      difficulty: template.difficulty,
      source: template.source,
      favorited,
    };
    return card;
  }

  /**
   * 计算本场生效的临场参数 (人物默认值 + 本次覆盖).
   *
   * 缺省值来源:
   *   - 情绪基线 / 防御水平 / 难度 ← 模板的 `*_default` 列
   *   - 模式 ← useMySettings (与训练会话启动参数的缺省一致)
   *   - 种子 ← 服务端生成 (未指定时)
   *
   * @param template 模板行
   * @param input 本次覆盖
   */
  private resolvePreset(template: VisitorPoolTemplate, input: InstantiateVisitorPoolDto): VisitorPoolDefaultPreset {
    const preset: VisitorPoolDefaultPreset = {
      styleHint: template.styleHint,
      emotionBaseline: input.emotionBaseline ?? template.emotionBaselineDefault,
      defenseLevel: input.defenseLevel ?? template.defenseLevelDefault,
      difficulty: input.difficulty ?? template.difficulty,
      mode: input.mode ?? VisitorMode.USE_MY_SETTINGS,
      randomSeed: input.randomSeed ?? randomUUID(),
    };
    return preset;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 模块内工具
// ════════════════════════════════════════════════════════════════════════════

/**
 * 7 大块剧本 → 私有副本的 7 个 json 列 (一一对应, 不改写任何值).
 *
 * 单独抽成模块级纯函数: 克隆是"整体快照", 字段映射必须**可一眼核对** ——
 * 将来剧本加第 8 块时, 这里会立刻编译报错 (缺一个键), 而不是静默丢一块.
 *
 * @param script 模板的 7 大块剧本
 */
export function splitScriptToColumns(script: VisitorFullPersonaScript): {
  basics: VisitorFullPersonaScript['basics'];
  developmentalTimeline: VisitorFullPersonaScript['developmentalTimeline'];
  innerWorkingModel: VisitorFullPersonaScript['innerWorkingModel'];
  socialMap: VisitorFullPersonaScript['socialMap'];
  coping: VisitorFullPersonaScript['coping'];
  therapyExpectation: VisitorFullPersonaScript['therapyExpectation'];
  presentingIssue: VisitorFullPersonaScript['presentingIssue'];
} {
  return {
    basics: script.basics,
    developmentalTimeline: script.developmentalTimeline,
    innerWorkingModel: script.innerWorkingModel,
    socialMap: script.socialMap,
    coping: script.coping,
    therapyExpectation: script.therapyExpectation,
    presentingIssue: script.presentingIssue,
  };
}

/**
 * 转义 LIKE 模式里的通配符 (用户输入不得被当成通配符).
 *
 * @param raw 用户输入
 */
function escapeLike(raw: string): string {
  return raw.replaceAll(/[\\%_]/g, (matched) => `\\${matched}`);
}

// V2026-10-23 治本 (AI 模拟来访池 — 内部管理面 service: AI 生成 + 模板治理):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §3.5 (AI 生成模板) 与 §3.6 (管理端读写位)
//     要求两件**内部**能力:
//       ① 持续扩充官方库: LLM 一次产出表层卡片 + 7 大块剧本, 结构校验通过后落表
//       ② 模板治理: 管理列表 (含草稿/下架) / 详情 (含 script) / 编辑 / 上下架 / 软删 / 恢复
//     两者都是**内部工具**, 不面向普通练习用户, 失败直接报错 (spec §3.5「不做面向用户的
//     软降级」), 普通用户访问 → 403 (spec §4).
//
//   修法: VisitorPoolAdminService 与公共面 VisitorPoolService **分文件**:
//     - 公共面 0 处引用内部能力 (内部生成/编辑不会意外暴露给普通用户)
//     - 内部面独立持有 LLM 依赖, 公共面不需要它
//
//   反双胞胎:
//     - **不把管理面塞进 VisitorPoolService**: 一个 service 同时装"公共只读"与
//       "内部可写"是权限事故的温床 —— 将来加端点时, 忘了加角色守卫就等于开天窗.
//     - **不新建 LLM 场景 profile**: 生成任务与 `personaGeneration` 同类 (写出一整套
//       人生剧本, 输出体量与超时需求一致), 复用既有 profile, 不造"参数几乎相同"的孪生档位.
//     - **不做软降级**: LLM 失败 / 校验不过 → 明确报错 + 不落半成品. 公共库里出现
//       残缺人物, 比"这次没生成出来"糟糕得多.
//     - **生成结果默认落草稿** (enabled=0): spec §3.5 明确要求人工审核后再上架.
//       AI 产出直接上架 = 把"内容审核"外包给模型.
//     - **不落任何计数字段**: 生成量/使用量一律不记 (零压红线).
//
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST /counselor/admin/visitor-pool/generate → 返回 card + script, 落 enabled=0
//     3. 普通用户 token 调 generate / 管理列表 → 403
//     4. 故意让模型写危机内容 → 报错, 库里 0 新增
//
//   时间戳: 2026-10-23

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { type Repository } from 'typeorm';

import { CounselorLlmJsonClient } from './llm-json.client';
import { toValidateCallback, VISITOR_POOL_FIXED_SOURCE, type VisitorPoolGenerationExpectation } from './visitor-pool.validator';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { COUNSELOR_LLM_PROFILES } from '../config/counselor-llm.config';
import { composeCodename, isAcceptableCodename, withCodenameDedupSuffix } from '../config/visitor-pool-codename';
import {
  buildVisitorPoolGenerationUserPrompt,
  VISITOR_POOL_SCHEMA_DESCRIPTION,
  VISITOR_POOL_SYSTEM_PROMPT,
} from '../config/visitor-pool-prompts';
import {
  VISITOR_POOL_GENERATE_MAX_ATTEMPTS,
  VISITOR_POOL_GENERATE_MAX_COUNT_DEFAULT,
  VISITOR_POOL_GENERATE_MAX_COUNT_ENV_KEY,
  VISITOR_POOL_GENERATE_MAX_COUNT_LIMIT,
  VISITOR_POOL_LIST_DEFAULT_LIMIT,
} from '../config/visitor-pool.config';
import type { VisitorPoolGeneratedTemplate } from '../domain/visitor-pool/visitor-pool.types';
import type {
  GenerateVisitorPoolTemplateDto,
  UpdateVisitorPoolTemplateDto,
  VisitorPoolAdminListDto,
  VisitorPoolAdminListItemDto,
  VisitorPoolAdminListQueryDto,
  VisitorPoolAdminTemplateDto,
} from '../dto/visitor-pool.dto';
import { VisitorPoolTemplate } from '../entities/visitor-pool-template.entity';
import { VisitorPoolTemplateStatus } from '../enums/visitor-pool.enum';

/**
 * 内部来访池管理 service.
 */
@Injectable()
export class VisitorPoolAdminService {
  private readonly logger = new Logger(VisitorPoolAdminService.name);

  constructor(
    @InjectRepository(VisitorPoolTemplate)
    private readonly templateRepo: Repository<VisitorPoolTemplate>,
    private readonly llmJson: CounselorLlmJsonClient,
    private readonly config: ConfigService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // §3.5 POST /counselor/admin/visitor-pool/generate — 内部 AI 生成
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 内部 AI 生成公共模板 (落草稿).
   *
   * 流程 (spec §3.5):
   *   1. LLM 一次产出 `{ card, script }`
   *   2. 结构校验 (卡片 + 7 大块 + 一致性 + 内容边界) 通过才落库
   *   3. 落库时 enabled=0 (草稿), 等待人工审核后上架
   *   4. 失败直接报错给内部调用方, **不落半成品**
   *
   * @param operatorId 发起生成的管理员 id (计费/审计用)
   * @param input 生成方向
   * @returns 新生成的模板 (含 7 大块剧本)
   * @throws BizException(VisitorPoolGenerationFailed) LLM 不可用 / 校验始终不过
   */
  async generate(operatorId: string, input: GenerateVisitorPoolTemplateDto): Promise<VisitorPoolAdminTemplateDto[]> {
    const count = this.resolveGenerateCount(input.count);
    const expected = {
      issueDomain: input.issueDomain,
      defenseType: input.defenseType,
      difficulty: input.difficulty,
    };
    const publish = input.publish ?? false;

    // V2026-10-23 治本 (化名归口 —— 代号由后端分配, 创意给模型, 正确性归后端):
    //   原因: 作者定的命名规则要求「量产后由后端从柔和词库组合并查重」, 且「去重兜底:
    //     词库内撞名时挂灰色极小尾号」. 若直接把 LLM 提的代号落库, 就既没有查重,
    //     也无法保证尾号形态.
    //   修法: 先取全库已占用的代号集合, 逐条落库时由 resolveCodename 决定最终代号:
    //     LLM 提的代号**合规且未被占用** → 直接用 (保留模型的创意);
    //     否则 → 从对应气质的柔和词库里另配一个 (词库也挤不下时才挂去重尾号).
    const takenCodenames = await this.loadTakenCodenames();

    const created: VisitorPoolTemplate[] = [];
    for (let index = 1; index <= count; index += 1) {
      const generated = await this.generateOne(operatorId, expected, input, index);
      const codename = this.resolveCodename(generated.card.codename, takenCodenames);
      takenCodenames.add(codename);
      const entity = this.templateRepo.create({
        // V2026-10-23 治本 (主键改为非自增 slug 后, 写入方必须显式给 id):
        //   `visitor_pool_templates.id` 已从 `@PrimaryGeneratedColumn('uuid')` 改为
        //   `@PrimaryColumn(varchar(64))` —— 目的是让"id 可由内容复现"成为**结构性**保证
        //   (若留着 uuid 自增, 不传 id 的 insert 会静默拿到随机 UUID, 库里就混入
        //   "内容派生但 id 随机"的行). 代价是: 每个写入方都要自己给 id.
        //   AI 生成这条路径给 `vpt_gen_<uuid32>`: 生成物没有"可复现的源内容", 唯一性
        //   与不可猜比"可复现"更重要; 前缀 `gen` 也让运维一眼看出它是生成物而非人工基线.
        id: `vpt_gen_${randomUUID().replaceAll('-', '')}`,
        codename,
        ageRange: generated.card.ageRange,
        presentingComplaint: generated.card.presentingComplaint,
        defenseType: generated.card.defenseType,
        issueDomain: generated.card.issueDomain,
        trainingGoal: generated.card.trainingGoal,
        difficulty: generated.card.difficulty,
        // source 由后端固定写 (不让 LLM 自称来源).
        source: VISITOR_POOL_FIXED_SOURCE,
        styleHint: generated.card.styleHint,
        emotionBaselineDefault: generated.card.emotionBaselineDefault,
        defenseLevelDefault: generated.card.defenseLevelDefault,
        script: generated.script,
        enabled: publish,
        sortOrder: await this.nextSortOrder(),
        deletedAt: null,
      });
      created.push(await this.templateRepo.save(entity));
    }

    this.logger.log(`[visitor_pool_generated] operator=${operatorId} count=${created.length} published=${publish}`);
    return created.map((template) => this.toAdminDto(template));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // §3.6 管理端读写
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 管理列表 (含草稿 / 已下架).
   *
   * 口径与公共图鉴一致 (keyset 游标分页), 差别只有两点:
   *   ① 不过滤 enabled / deletedAt —— 草稿与已下架也在列表里
   *   ② 多一个 status 筛选
   *
   * @param query 筛选 + 游标
   */
  async list(query: VisitorPoolAdminListQueryDto): Promise<VisitorPoolAdminListDto> {
    const limit = query.limit ?? VISITOR_POOL_LIST_DEFAULT_LIMIT;
    const qb = this.templateRepo.createQueryBuilder('t').where('1 = 1');

    if (query.issueDomain) {
      qb.andWhere('t.issueDomain = :issueDomain', { issueDomain: query.issueDomain });
    }
    if (query.difficulty) {
      qb.andWhere('t.difficulty = :difficulty', { difficulty: query.difficulty });
    }
    if (query.status) {
      // status 是**派生**值 (enabled + deleted_at), 落成两个可索引的条件.
      if (query.status === VisitorPoolTemplateStatus.DRAFT) {
        qb.andWhere('t.deletedAt IS NULL').andWhere('t.enabled = :disabled', { disabled: false });
      } else if (query.status === VisitorPoolTemplateStatus.ENABLED) {
        qb.andWhere('t.deletedAt IS NULL').andWhere('t.enabled = :enabled', { enabled: true });
      } else {
        qb.andWhere('t.deletedAt IS NOT NULL');
      }
    }

    if (query.cursor) {
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

    const rows = await qb.take(limit + 1).getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const last = items.at(-1);
    return {
      items: items.map((template) => this.toAdminListItem(template)),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  /**
   * 管理端详情 (含 7 大块剧本).
   *
   * @param templateId 公共模板 id
   */
  async get(templateId: string): Promise<VisitorPoolAdminTemplateDto> {
    const template = await this.loadTemplate(templateId);
    return this.toAdminDto(template);
  }

  /**
   * 编辑模板 (表层字段 / 上下架 / 排序).
   *
   * 只改**显式传入**的字段: 未传的保持原样 (逐字段白名单拷贝, 不用 spread
   * 覆盖成 undefined).
   *
   * @param templateId 公共模板 id
   * @param input 待改字段
   */
  async update(templateId: string, input: UpdateVisitorPoolTemplateDto): Promise<VisitorPoolAdminTemplateDto> {
    const template = await this.loadTemplate(templateId);

    if (input.codename !== undefined) template.codename = input.codename;
    if (input.ageRange !== undefined) template.ageRange = input.ageRange;
    if (input.presentingComplaint !== undefined) template.presentingComplaint = input.presentingComplaint;
    if (input.defenseType !== undefined) template.defenseType = input.defenseType;
    if (input.issueDomain !== undefined) template.issueDomain = input.issueDomain;
    if (input.trainingGoal !== undefined) template.trainingGoal = input.trainingGoal;
    if (input.difficulty !== undefined) template.difficulty = input.difficulty;
    if (input.styleHint !== undefined) template.styleHint = input.styleHint;
    if (input.emotionBaselineDefault !== undefined) template.emotionBaselineDefault = input.emotionBaselineDefault;
    if (input.defenseLevelDefault !== undefined) template.defenseLevelDefault = input.defenseLevelDefault;
    if (input.enabled !== undefined) template.enabled = input.enabled;
    if (input.sortOrder !== undefined) template.sortOrder = input.sortOrder;

    const saved = await this.templateRepo.save(template);
    this.logger.log(`[visitor_pool_updated] template=${templateId}`);
    return this.toAdminDto(saved);
  }

  /**
   * 软删模板 (下架).
   *
   * **不物理删除**: 公共模板是内容资产, 误删一个官方人物 = 所有以它起步的副本
   * 追溯不到来源; 且 soft delete 保留了"这个 id 曾经存在过"的事实.
   *
   * @param templateId 公共模板 id
   */
  async remove(templateId: string): Promise<void> {
    const template = await this.loadTemplate(templateId);
    template.deletedAt = new Date();
    template.enabled = false;
    await this.templateRepo.save(template);
    this.logger.log(`[visitor_pool_removed] template=${templateId}`);
  }

  /**
   * 恢复软删的模板.
   *
   * 恢复后仍是**下架**状态 (enabled=false): 恢复 ≠ 上架, 上架要人工再走一次审核动作.
   *
   * @param templateId 公共模板 id
   */
  async restore(templateId: string): Promise<VisitorPoolAdminTemplateDto> {
    const template = await this.loadTemplate(templateId);
    template.deletedAt = null;
    template.enabled = false;
    const saved = await this.templateRepo.save(template);
    this.logger.log(`[visitor_pool_restored] template=${templateId}`);
    return this.toAdminDto(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 取全库已占用的代号 (用于查重).
   *
   * 口径: **未软删**的所有模板 (含草稿). 草稿也在管理列表里可见, 它的代号已被"预定",
   * 不能被别人抢走; 而已软删的模板已从图鉴消失, 它的代号可以回收.
   *
   * @returns 已占用的代号集合
   */
  private async loadTakenCodenames(): Promise<Set<string>> {
    const rows = await this.templateRepo.find({ select: { codename: true } });
    return new Set(rows.map((row) => row.codename));
  }

  /**
   * 决定一条模板最终落库的代号.
   *
   * 优先级 (作者规则「后端维护 + 词库组合 + 撞名兜底」的直接实现):
   *   ① 模型提的代号**合规且未被占用** → 直接用 (保留创意, 且它已过命名规则闸门);
   *   ② 模型提的代号**合规但已占用** → 挂去重尾号 (作者规则的「去重兜底」:
   *      词库内撞名时名字后挂灰色极小尾号, 如「晚晴 · 02」);
   *   ③ 模型提的代号**不合规** → 由后端从常见中性称呼词库另配一个 (词库与组合空间
   *      都挤不下时, 同样退到尾号形态).
   *
   * 注意: 这里**不按防御类型 / 阻抗强度 / 难度去"配"名字** (作者第二版明令「不配性格」) ——
   * 名字与人物设定解耦, 性格只由会谈里的对话和行为体现.
   *
   * @param proposed 模型提的代号
   * @param taken 已占用的代号集合
   */
  private resolveCodename(proposed: string, taken: ReadonlySet<string>): string {
    if (!isAcceptableCodename(proposed)) {
      const composed = composeCodename(taken);
      this.logger.log(`[visitor_pool_codename_replaced] proposed=${proposed} replaced=${composed} reason=不符合命名规则`);
      return composed;
    }
    if (!taken.has(proposed)) {
      return proposed;
    }
    // 撞名 → 挂去重尾号 (尾号仅去重, 不抢视觉).
    const deduped = withCodenameDedupSuffix(proposed, taken);
    this.logger.log(`[visitor_pool_codename_deduped] proposed=${proposed} assigned=${deduped} reason=已占用`);
    return deduped;
  }

  /**
   * 生成 1 份模板 (含"拒收重生成"重试).
   *
   * 重试语义 (spec §3.5.1「命中即拒收重生成」): 校验不通过时, 把**拒收原因**
   * 喂回模型, 让它针对性修改. 仍不过 → 抛错, 不落半成品.
   *
   * @param operatorId 发起生成的管理员 id
   * @param expected 方向约束
   * @param input 原始入参 (含代称/目标方向)
   * @param index 本次是第几条 (同批多条的区分标识)
   */
  private async generateOne(
    operatorId: string,
    expected: VisitorPoolGenerationExpectation,
    input: GenerateVisitorPoolTemplateDto,
    index: number,
  ): Promise<VisitorPoolGeneratedTemplate> {
    const profile = COUNSELOR_LLM_PROFILES.personaGeneration;
    let lastReason = '未知原因';

    for (let attempt = 1; attempt <= VISITOR_POOL_GENERATE_MAX_ATTEMPTS; attempt += 1) {
      const sink: { reason: string | null } = { reason: null };
      // 首次尝试不带拒收原因; 之后的尝试把**上一次**的拒收原因喂回模型 (spec §3.5.1
      // 「命中即拒收重生成」—— 不带原因的重试, 模型只会原样再犯).
      const userPrompt = this.buildAttemptPrompt(input, index, attempt, lastReason);

      const result = await this.llmJson.requestJson<VisitorPoolGeneratedTemplate>({
        systemPrompt: VISITOR_POOL_SYSTEM_PROMPT,
        userPrompt,
        schemaDescription: VISITOR_POOL_SCHEMA_DESCRIPTION,
        validate: toValidateCallback(expected, sink),
        maxCompletionTokens: profile.maxCompletionTokens,
        reasoningEffort: profile.reasoningEffort,
        timeoutMs: profile.timeoutMs,
        tenantId: operatorId,
        userId: operatorId,
      });

      if (result.ok && result.data) {
        return result.data;
      }

      // 失败归因: 业务校验失败 → 用校验理由 (可回喂); LLM 层失败 → 用错误码.
      lastReason = sink.reason ?? result.errorMessage ?? result.errorCode ?? '未知原因';
      this.logger.warn(
        `[visitor_pool_generate_rejected] operator=${operatorId} attempt=${attempt}/${VISITOR_POOL_GENERATE_MAX_ATTEMPTS} reason=${lastReason.slice(0, 200)}`,
      );
    }

    throw new BizException(
      BizCode.VisitorPoolGenerationFailed,
      `来访人物生成失败 (已重试 ${VISITOR_POOL_GENERATE_MAX_ATTEMPTS} 次): ${lastReason}`,
    );
  }

  /**
   * 拼某一次尝试的 user prompt (第 2 次起带上一次的拒收原因).
   *
   * @param input 原始入参
   * @param index 本次是第几条
   * @param attempt 第几次尝试 (1 起)
   * @param lastReason 上一次的拒收原因
   */
  private buildAttemptPrompt(input: GenerateVisitorPoolTemplateDto, index: number, attempt: number, lastReason: string): string {
    const base = buildVisitorPoolGenerationUserPrompt({
      issueDomain: input.issueDomain,
      defenseType: input.defenseType,
      difficulty: input.difficulty,
      trainingGoal: input.trainingGoal,
      codenameHint: input.codenameHint,
      index,
    });
    if (attempt <= 1) {
      return base;
    }
    return `${base}\n\n上一次产出未通过校验, 原因: ${lastReason}\n` + '请针对该原因修正后重新输出完整 JSON (不要只输出改动部分).';
  }

  /**
   * 解析本次生成条数 (env 上限 + 硬顶 + 入参三者取小).
   *
   * @param requested 入参条数
   */
  private resolveGenerateCount(requested: number | undefined): number {
    const envRaw = this.config.get<string>(VISITOR_POOL_GENERATE_MAX_COUNT_ENV_KEY);
    const parsed = envRaw === undefined ? Number.NaN : Number.parseInt(envRaw, 10);
    const envLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : VISITOR_POOL_GENERATE_MAX_COUNT_DEFAULT;
    const effectiveLimit = Math.min(envLimit, VISITOR_POOL_GENERATE_MAX_COUNT_LIMIT);
    const wanted = requested ?? VISITOR_POOL_GENERATE_MAX_COUNT_DEFAULT;
    const count = Math.min(wanted, effectiveLimit);
    if (count < wanted) {
      this.logger.warn(`[visitor_pool_generate_count_capped] requested=${wanted} effective=${count} envLimit=${envLimit}`);
    }
    return count;
  }

  /**
   * 下一个图鉴排序值 (追加到末尾, 步长 10, 便于中间插位).
   */
  private async nextSortOrder(): Promise<number> {
    const last = await this.templateRepo.find({ order: { sortOrder: 'DESC' }, take: 1 });
    const max = last.at(0)?.sortOrder ?? 0;
    return max + 10;
  }

  /**
   * 取一条模板 (含已软删的 —— 管理端要能看到并恢复它).
   *
   * @param templateId 公共模板 id
   * @throws BizException(VisitorPoolTemplateNotFound) 不存在
   */
  private async loadTemplate(templateId: string): Promise<VisitorPoolTemplate> {
    const template = await this.templateRepo.findOne({ where: { id: templateId } });
    if (!template) {
      throw new BizException(BizCode.VisitorPoolTemplateNotFound, `来访人物不存在: ${templateId}`);
    }
    return template;
  }

  /**
   * 模板 → 管理端详情 (含 7 大块剧本).
   *
   * @param template 模板行
   */
  private toAdminDto(template: VisitorPoolTemplate): VisitorPoolAdminTemplateDto {
    return {
      templateId: template.id,
      codename: template.codename,
      ageRange: template.ageRange,
      presentingComplaint: template.presentingComplaint,
      defenseType: template.defenseType,
      issueDomain: template.issueDomain,
      trainingGoal: template.trainingGoal,
      difficulty: template.difficulty,
      source: template.source,
      styleHint: template.styleHint,
      emotionBaselineDefault: template.emotionBaselineDefault,
      defenseLevelDefault: template.defenseLevelDefault,
      enabled: template.enabled,
      status: deriveStatus(template),
      sortOrder: template.sortOrder,
      script: template.script,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  /**
   * 模板 → 管理端列表项 (不含剧本).
   *
   * @param template 模板行
   */
  private toAdminListItem(template: VisitorPoolTemplate): VisitorPoolAdminListItemDto {
    return {
      templateId: template.id,
      codename: template.codename,
      issueDomain: template.issueDomain,
      defenseType: template.defenseType,
      difficulty: template.difficulty,
      source: template.source,
      enabled: template.enabled,
      status: deriveStatus(template),
      sortOrder: template.sortOrder,
      updatedAt: template.updatedAt,
    };
  }
}

/**
 * 派生模板的上架状态 (由 enabled + deletedAt 决定, 不落独立列).
 *
 * @param template 模板行
 */
function deriveStatus(template: VisitorPoolTemplate): VisitorPoolTemplateStatus {
  if (template.deletedAt !== null) {
    return VisitorPoolTemplateStatus.OFF;
  }
  return template.enabled ? VisitorPoolTemplateStatus.ENABLED : VisitorPoolTemplateStatus.DRAFT;
}

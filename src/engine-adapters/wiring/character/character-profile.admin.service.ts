// V2026-10-29 治本 (WP9-B · B 层 · 角色资产池管理服务):
//   职责: 角色基线的 CRUD / 上下架 / 审核状态治理 (内部 admin, 非 UGC).
//   边界: 只做「表读写 + 校验 + 状态迁移」; 零内核知识、零映射公式、零渲染语义.
//
//   为什么写路径与读路径分开:
//     `DbCharacterProfileResolver` 是**只读**的 (引擎侧按 template_id 取一行),
//     本服务是**写路径** (运营改内容 / 上下架 / 过审). 两者混在一处会让
//     "引擎顺手把 draft 行改了"变成可能 —— 而引擎只该消费"已过审且在架"的内容.
//
//   为什么"下架"不改内容、只改 enabled:
//     上下架是**运营决策**, 内容是**资产**. 下架后内容仍在库里 (可再上架 / 可回滚),
//     引擎侧立刻回退中性 (resolver 的命中条件含 enabled=1).
//
//   反双胞胎:
//     - 不在服务里做任何内核映射: 写进去的是**基线数值 + 结构化心理要素**,
//       映射由 resolver 统一走 WP9-A 的 buildCharacterProfile.
//     - 不静默吞冲突: template_id 重复 → 明确报错 (BizCode.InvalidParameter),
//       而不是"覆盖掉旧行" —— 旧行可能已被审核过.
//     - 不物理删除: 一律软删 (deleted_at), 跟仓库软删约定一致.
//     - 不改 audit_status 之外的状态机: 审核态只有 draft/approved/rejected 三档,
//       本服务只做**直接置值**, 不做"approved → approved 自动降级"这类隐式迁移.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9b-character-admin.spec.ts 覆盖增删改查/上下架/重复冲突
//
//   时间戳: 2026-10-29

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsWhere, Repository } from 'typeorm';

import type { CreateCharacterProfileDto, UpdateCharacterProfileDto } from './character-profile.dto';
import { CharacterProfileAdminListDto, CharacterProfileAdminDto, CharacterProfileAdminListQueryDto } from './character-profile.dto';
import { CharacterProfileEntity } from './character-profile.entity';
import { deriveCharacterProfileId } from './character-profile.seed';
import { BizCode } from '../../../common/exceptions/biz-code.enum';
import { BizException } from '../../../common/exceptions/biz.exception';

/** 管理列表默认条数. */
const DEFAULT_LIMIT = 50;

/**
 * 角色资产池管理服务.
 */
@Injectable()
export class CharacterProfileAdminService {
  private readonly logger = new Logger(CharacterProfileAdminService.name);

  constructor(
    @InjectRepository(CharacterProfileEntity)
    private readonly repo: Repository<CharacterProfileEntity>,
  ) {}

  /**
   * 管理列表 (含未过审 / 已下架 / 已软删).
   *
   * @param query 过滤条件
   * @returns 角色列表 + 总数
   */
  async list(query: CharacterProfileAdminListQueryDto): Promise<CharacterProfileAdminListDto> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const where: FindOptionsWhere<CharacterProfileEntity> = {};
    if (query.templateId) where.templateId = query.templateId;
    if (query.auditStatus) where.auditStatus = query.auditStatus;
    if (query.enabled !== undefined) where.enabled = query.enabled === 'true';

    const [rows, total] = await this.repo.findAndCount({
      where,
      order: { templateId: 'ASC' },
      take: limit,
      skip: offset,
    });
    return { items: rows.map((row) => toAdminDto(row)), total };
  }

  /**
   * 取一条角色详情 (含已软删的 —— 管理端要能看到并恢复它).
   *
   * @param templateId 公共模板 id
   * @returns 角色详情
   * @throws BizException(ResourceNotFound) 不存在
   */
  async get(templateId: string): Promise<CharacterProfileAdminDto> {
    return toAdminDto(await this.loadRow(templateId));
  }

  /**
   * 新建角色.
   *
   * @param input 角色内容
   * @returns 建好的角色
   * @throws BizException(InvalidParameter) templateId 已存在
   */
  async create(input: CreateCharacterProfileDto): Promise<CharacterProfileAdminDto> {
    const templateId = input.templateId.trim();
    const existing = await this.repo.findOne({ where: { templateId } });
    if (existing) {
      throw new BizException(BizCode.InvalidParameter, `角色已存在: ${templateId} (请直接编辑)`);
    }

    const row = this.repo.create({
      id: deriveCharacterProfileId(templateId),
      templateId,
      displayName: input.displayName,
      attachmentStyle: input.attachmentStyle,
      fivePs: input.fivePs,
      baselineTrust: input.baselineTrust,
      baselineResistanceVerbal: input.baselineResistanceVerbal,
      baselineResistanceDepth: input.baselineResistanceDepth,
      baselineResistanceStyle: input.baselineResistanceStyle,
      baselineEmotionValence: input.baselineEmotionValence,
      baselineEmotionArousal: input.baselineEmotionArousal,
      coreBeliefs: input.coreBeliefs,
      underlyingDesires: input.underlyingDesires,
      forbiddenBehaviors: input.forbiddenBehaviors,
      sensitiveTopics: input.sensitiveTopics,
      // 缺省 draft: 内部新建的角色也要显式过审才进引擎 (跟"未审核不可用"同口径).
      auditStatus: input.auditStatus ?? 'draft',
      enabled: input.enabled ?? true,
      version: 1,
      deletedAt: null,
    });
    const saved = await this.repo.save(row);
    this.logger.log(`[create] templateId=${templateId} audit=${saved.auditStatus} enabled=${saved.enabled}`);
    return toAdminDto(saved);
  }

  /**
   * 编辑角色 (内容字段 + 上下架 + 审核态).
   *
   * @param templateId 公共模板 id
   * @param input 待改字段 (未提供的原样保留)
   * @returns 改完后的角色
   * @throws BizException(ResourceNotFound) 不存在
   */
  async update(templateId: string, input: UpdateCharacterProfileDto): Promise<CharacterProfileAdminDto> {
    const row = await this.loadRow(templateId);

    if (input.displayName !== undefined) row.displayName = input.displayName;
    if (input.attachmentStyle !== undefined) row.attachmentStyle = input.attachmentStyle;
    if (input.fivePs !== undefined) row.fivePs = input.fivePs;
    if (input.baselineTrust !== undefined) row.baselineTrust = input.baselineTrust;
    if (input.baselineResistanceVerbal !== undefined) row.baselineResistanceVerbal = input.baselineResistanceVerbal;
    if (input.baselineResistanceDepth !== undefined) row.baselineResistanceDepth = input.baselineResistanceDepth;
    if (input.baselineResistanceStyle !== undefined) row.baselineResistanceStyle = input.baselineResistanceStyle;
    if (input.baselineEmotionValence !== undefined) row.baselineEmotionValence = input.baselineEmotionValence;
    if (input.baselineEmotionArousal !== undefined) row.baselineEmotionArousal = input.baselineEmotionArousal;
    if (input.coreBeliefs !== undefined) row.coreBeliefs = input.coreBeliefs;
    if (input.underlyingDesires !== undefined) row.underlyingDesires = input.underlyingDesires;
    if (input.forbiddenBehaviors !== undefined) row.forbiddenBehaviors = input.forbiddenBehaviors;
    if (input.sensitiveTopics !== undefined) row.sensitiveTopics = input.sensitiveTopics;
    if (input.auditStatus !== undefined) row.auditStatus = input.auditStatus;
    if (input.enabled !== undefined) row.enabled = input.enabled;

    // 内容版本号递增: 让"内容变过"这件事对消费方可见 (版本迁移本身归 Phase2).
    row.version += 1;

    const saved = await this.repo.save(row);
    this.logger.log(`[update] templateId=${templateId} audit=${saved.auditStatus} enabled=${saved.enabled} version=${saved.version}`);
    return toAdminDto(saved);
  }

  /**
   * 软删角色 (下架 + 标记删除).
   *
   * @param templateId 公共模板 id
   * @returns 删除结果
   * @throws BizException(ResourceNotFound) 不存在
   */
  async remove(templateId: string): Promise<{ templateId: string; deleted: boolean }> {
    const row = await this.loadRow(templateId);
    row.deletedAt = new Date();
    row.enabled = false;
    await this.repo.save(row);
    this.logger.log(`[remove] templateId=${templateId} 已软删并下架`);
    return { templateId, deleted: true };
  }

  /**
   * 取一条角色行 (含已软删的 —— 管理端要能看到并恢复它).
   *
   * @param templateId 公共模板 id
   * @returns 行
   * @throws BizException(ResourceNotFound) 不存在
   */
  private async loadRow(templateId: string): Promise<CharacterProfileEntity> {
    const row = await this.repo.findOne({ where: { templateId } });
    if (!row) {
      throw new BizException(BizCode.ResourceNotFound, `角色不存在: ${templateId}`);
    }
    return row;
  }
}

/**
 * 实体 → 管理端出参.
 *
 * @param row 角色行
 * @returns 出参
 */
function toAdminDto(row: CharacterProfileEntity): CharacterProfileAdminDto {
  return {
    templateId: row.templateId,
    displayName: row.displayName,
    attachmentStyle: row.attachmentStyle,
    fivePs: row.fivePs,
    baselineTrust: row.baselineTrust,
    baselineResistanceVerbal: row.baselineResistanceVerbal,
    baselineResistanceDepth: row.baselineResistanceDepth,
    baselineResistanceStyle: row.baselineResistanceStyle,
    baselineEmotionValence: row.baselineEmotionValence,
    baselineEmotionArousal: row.baselineEmotionArousal,
    coreBeliefs: row.coreBeliefs,
    underlyingDesires: row.underlyingDesires,
    forbiddenBehaviors: row.forbiddenBehaviors,
    sensitiveTopics: row.sensitiveTopics,
    auditStatus: row.auditStatus,
    enabled: row.enabled,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

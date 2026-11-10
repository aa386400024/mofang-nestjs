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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { FindOptionsWhere, Repository } from 'typeorm';

import { CharacterProfileVersionEntity, type CharacterProfileSnapshot } from './character-profile-version.entity.js';
import {
  CharacterProfileAdminListDto,
  CharacterProfileAdminDto,
  CharacterProfileAdminListQueryDto,
  CharacterProfileVersionDetailDto,
  CharacterProfileVersionListDto,
  CharacterProfileVersionSummaryDto,
  type CreateCharacterProfileDto,
  type UpdateCharacterProfileDto,
} from './character-profile.dto.js';
import { CharacterProfileEntity } from './character-profile.entity.js';
import { deriveCharacterProfileId } from './character-profile.seed.js';
import {
  bumpCharacterVersion,
  formatCharacterVersion,
  type CharacterVersionBump,
  type CharacterVersionChangeType,
} from './character-version.js';
import { BizCode } from '../../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../../common/exceptions/biz.exception.js';
import { CharacterUsageRegistry } from '../../../voice/character-usage-slot.js';

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
    /**
     * 历史版本快照仓储 (WP38).
     *
     * 每次改版都往这张表写一份**变更后**的完整快照 —— 角色基线是临床内容资产,
     * 覆盖式更新等于"改坏了找不回来".
     */
    @InjectRepository(CharacterProfileVersionEntity)
    private readonly versionRepo: Repository<CharacterProfileVersionEntity>,
    /**
     * 角色占用查询插槽 (WP38 · 主版本锁定要用).
     *
     * 为什么是可选依赖:
     *   插槽由**业务域** (counselor) 实现并注册, 引擎侧只认插槽不认实现.
     *   插槽没装 (单测 / 裁剪部署) → 判不出"还有几场会话在用" → 本服务按
     *   **查不到**处理 (放行 + 告警), 而不是假装"0 场"或硬挡管理操作.
     */
    @Optional()
    private readonly usageRegistry?: CharacterUsageRegistry,
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
      // WP51: 同盟三维基线两列 —— **没给就不出现** (走 DB DEFAULT 0.5 / 0),
      //   与 WP10A 的表达风格三列同一纪律 (默认值只有 DDL 一处真相).
      ...(input.baselineSafety === undefined ? {} : { baselineSafety: input.baselineSafety }),
      ...(input.baselineBond === undefined ? {} : { baselineBond: input.baselineBond }),
      coreBeliefs: input.coreBeliefs,
      underlyingDesires: input.underlyingDesires,
      forbiddenBehaviors: input.forbiddenBehaviors,
      sensitiveTopics: input.sensitiveTopics,
      // 缺省 draft: 内部新建的角色也要显式过审才进引擎 (跟"未审核不可用"同口径).
      auditStatus: input.auditStatus ?? 'draft',
      enabled: input.enabled ?? true,
      version: 1,
      // WP38: semver 初值 1.0.0 (缺省三列也是 1/0/0 —— 这里显式写, 不靠 DB DEFAULT 兜底).
      versionMajor: 1,
      versionMinor: 0,
      versionPatch: 0,
      deletedAt: null,
    });
    const saved = await this.repo.save(row);
    // WP38: 首版也要留痕 —— 否则"第一版是怎么配的"无从追溯.
    await this.recordVersion(saved, 'create', null);
    this.logger.log(
      `[create] templateId=${templateId} audit=${saved.auditStatus} enabled=${saved.enabled} ` +
        `version=${formatCharacterVersion({ major: saved.versionMajor, minor: saved.versionMinor, patch: saved.versionPatch })}`,
    );
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
  async update(templateId: string, input: UpdateCharacterProfileDto, changedBy?: string | null): Promise<CharacterProfileAdminDto> {
    const row = await this.loadRow(templateId);
    // WP38: 版本递增档位 (缺省 patch = 文案 / 小参数微调).
    const bump: CharacterVersionBump = input.versionBump ?? 'patch';

    // WP38: 主版本锁定 —— 还有活跃会话在用这个角色时, 不允许改主版本.
    //   (有会话在用 → 改主版本 = 那些会话的角色定位被抽走; 任务单 §2.1 的核心红线.)
    if (bump === 'major') {
      await this.assertMajorChangeAllowed(templateId);
    }

    applyContentUpdates(row, input);

    // 内容修改计数递增 (int 自增; 不是版本真相源 —— 见实体注释).
    row.version += 1;

    // WP38: semver 递增 (major → M+1.0.0 / minor → M.m+1.0 / patch → M.m.p+1).
    const next = bumpCharacterVersion({ major: row.versionMajor, minor: row.versionMinor, patch: row.versionPatch }, bump);
    row.versionMajor = next.major;
    row.versionMinor = next.minor;
    row.versionPatch = next.patch;

    const saved = await this.repo.save(row);
    // WP38: 把**变更后**的这一版存进历史表 (可回溯).
    await this.recordVersion(saved, bump, changedBy ?? null);
    this.logger.log(
      `[update] templateId=${templateId} audit=${saved.auditStatus} enabled=${saved.enabled} ` +
        `version=${saved.version} semver=${formatCharacterVersion(next)} bump=${bump}`,
    );
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
   * 历史版本列表 (WP38 · 回溯入口).
   *
   * 按版本号**从新到旧**排 —— 运营改坏了要看的通常是"上一版"与"上上一版".
   *
   * @param templateId 公共模板 id
   * @returns 版本摘要列表 + 总数
   */
  async listVersions(templateId: string): Promise<CharacterProfileVersionListDto> {
    const rows = await this.versionRepo.find({
      where: { templateId },
      order: { versionMajor: 'DESC', versionMinor: 'DESC', versionPatch: 'DESC' },
    });
    return { items: rows.map((row) => toVersionSummaryDto(row)), total: rows.length };
  }

  /**
   * 取某一版历史快照 (WP38 · 回溯读取).
   *
   * @param templateId 公共模板 id
   * @param major 主版本号
   * @param minor 次版本号
   * @param patch 修订号
   * @returns 版本详情 (摘要 + 内容快照)
   * @throws BizException(ResourceNotFound) 该版本不存在
   */
  async getVersion(templateId: string, major: number, minor: number, patch: number): Promise<CharacterProfileVersionDetailDto> {
    const row = await this.versionRepo.findOne({
      where: { templateId, versionMajor: major, versionMinor: minor, versionPatch: patch },
    });
    if (!row) {
      throw new BizException(BizCode.ResourceNotFound, `角色历史版本不存在: ${templateId}@${major}.${minor}.${patch}`);
    }
    return { ...toVersionSummaryDto(row), snapshot: row.snapshot };
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

  /**
   * 主版本锁定判定 (WP38): 还有活跃会话在用这个角色 → 不许改主版本.
   *
   * 口径 (任务单 §五 第 1 问的建议): **活跃**会话 = 还没结束的 (ended_at IS NULL).
   * 已结束的会话不再影响判定 —— 学员已经聊完了, 改定位不影响他.
   *
   * @param templateId 公共模板 id
   * @throws BizException(CharacterVersionLocked) 还有活跃会话在用
   */
  private async assertMajorChangeAllowed(templateId: string): Promise<void> {
    const active = await this.countActiveSessions(templateId);
    if (active === null) {
      // 判不出来 (插槽没装 / 查询失败) → 放行 + 告警, 不硬挡运营操作.
      return;
    }
    if (active > 0) {
      throw new BizException(
        BizCode.CharacterVersionLocked,
        `角色 ${templateId} 还有 ${active} 场会话在进行中, 不能改主版本 (请等会话结束后再改, 或改次版本)`,
      );
    }
  }

  /**
   * 数该角色当前的活跃会话 (WP38).
   *
   * @param templateId 公共模板 id
   * @returns 活跃会话数; null = **判不出来** (不等于 0)
   */
  private async countActiveSessions(templateId: string): Promise<number | null> {
    if (!this.usageRegistry) {
      this.logger.warn(`[update] 角色占用插槽未装配 (usageRegistry 缺失), 主版本锁定判定按"判不出来"处理: templateId=${templateId}`);
      return null;
    }
    return this.usageRegistry.countActiveSessions(templateId);
  }

  /**
   * 把某一版的内容存进历史表 (WP38).
   *
   * 存的是**变更后**的完整快照 —— 回溯要回答的是"这一版当时是怎么配的".
   * 主键由 (template_id + 版本号) 内容派生 → 同一版重复写是幂等覆盖, 不会出第二行.
   *
   * @param row 变更后的角色行
   * @param changeType 变更类型
   * @param changedBy 变更人 id (未知时 null)
   */
  private async recordVersion(
    row: CharacterProfileEntity,
    changeType: CharacterVersionChangeType,
    changedBy: string | null,
  ): Promise<void> {
    const label = formatCharacterVersion({
      major: row.versionMajor,
      minor: row.versionMinor,
      patch: row.versionPatch,
    });
    const entity = this.versionRepo.create({
      id: deriveCharacterProfileId(`${row.templateId}@${label}`),
      templateId: row.templateId,
      versionMajor: row.versionMajor,
      versionMinor: row.versionMinor,
      versionPatch: row.versionPatch,
      changeType,
      snapshot: toSnapshot(row),
      changedBy,
    });
    await this.versionRepo.save(entity);
  }
}

/**
 * 实体 → 管理端出参. *
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
    baselineSafety: row.baselineSafety,
    baselineBond: row.baselineBond,
    coreBeliefs: row.coreBeliefs,
    underlyingDesires: row.underlyingDesires,
    forbiddenBehaviors: row.forbiddenBehaviors,
    sensitiveTopics: row.sensitiveTopics,
    auditStatus: row.auditStatus,
    enabled: row.enabled,
    version: row.version,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    versionPatch: row.versionPatch,
    versionLabel: formatCharacterVersion({ major: row.versionMajor, minor: row.versionMinor, patch: row.versionPatch }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 把入参里的内容字段拷到角色行 (WP38 · 从 update() 里抽出来).
 *
 * 为什么要抽: update() 里原本堆着 19 个"字段在场就拷"的分支, 再加上版本递增与
 * 主版本锁定, 复杂度越过 lint 上限. 抽出来之后 update() 只剩"编排" ——
 * 判定 (锁) → 拷字段 → 递增 → 落库 → 留痕, 一眼看得完.
 *
 * 口径不变: 未提供的字段原样保留 (不是 undefined); audit_status / enabled 也在这里拷.
 *
 * @param row 角色行 (就地改)
 * @param input 编辑入参
 */
function applyContentUpdates(row: CharacterProfileEntity, input: UpdateCharacterProfileDto): void {
  if (input.displayName !== undefined) row.displayName = input.displayName;
  if (input.attachmentStyle !== undefined) row.attachmentStyle = input.attachmentStyle;
  if (input.fivePs !== undefined) row.fivePs = input.fivePs;
  if (input.baselineTrust !== undefined) row.baselineTrust = input.baselineTrust;
  if (input.baselineResistanceVerbal !== undefined) row.baselineResistanceVerbal = input.baselineResistanceVerbal;
  if (input.baselineResistanceDepth !== undefined) row.baselineResistanceDepth = input.baselineResistanceDepth;
  if (input.baselineResistanceStyle !== undefined) row.baselineResistanceStyle = input.baselineResistanceStyle;
  if (input.baselineEmotionValence !== undefined) row.baselineEmotionValence = input.baselineEmotionValence;
  if (input.baselineEmotionArousal !== undefined) row.baselineEmotionArousal = input.baselineEmotionArousal;
  // WP51: 同盟三维基线两列 —— 缺省 = 不改 (不把已标定好的值冲回默认).
  if (input.baselineSafety !== undefined) row.baselineSafety = input.baselineSafety;
  if (input.baselineBond !== undefined) row.baselineBond = input.baselineBond;
  if (input.coreBeliefs !== undefined) row.coreBeliefs = input.coreBeliefs;
  if (input.underlyingDesires !== undefined) row.underlyingDesires = input.underlyingDesires;
  if (input.forbiddenBehaviors !== undefined) row.forbiddenBehaviors = input.forbiddenBehaviors;
  if (input.sensitiveTopics !== undefined) row.sensitiveTopics = input.sensitiveTopics;
  if (input.auditStatus !== undefined) row.auditStatus = input.auditStatus;
  if (input.enabled !== undefined) row.enabled = input.enabled;
}

/**
 * 历史版本行 → 摘要出参 (WP38).
 *
 * @param row 历史版本行
 * @returns 摘要
 */
function toVersionSummaryDto(row: CharacterProfileVersionEntity): CharacterProfileVersionSummaryDto {
  return {
    templateId: row.templateId,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    versionPatch: row.versionPatch,
    versionLabel: formatCharacterVersion({ major: row.versionMajor, minor: row.versionMinor, patch: row.versionPatch }),
    changeType: row.changeType,
    changedBy: row.changedBy,
    createdAt: row.createdAt,
  };
}

/**
 * 角色行 → 内容快照 (WP38).
 *
 * 快照是**冻结形状** (见 CharacterProfileSnapshot 的注释): 刻意不含时间戳 /
 * 软删位 / int 计数列 —— 那些是"行"的属性, 不是"这一版的内容".
 *
 * @param row 角色行
 * @returns 内容快照
 */
function toSnapshot(row: CharacterProfileEntity): CharacterProfileSnapshot {
  return {
    templateId: row.templateId,
    displayName: row.displayName,
    attachmentStyle: row.attachmentStyle,
    fivePs: row.fivePs,
    personalityTraits: row.personalityTraits,
    baselineTrust: row.baselineTrust,
    baselineResistanceVerbal: row.baselineResistanceVerbal,
    baselineResistanceDepth: row.baselineResistanceDepth,
    baselineResistanceStyle: row.baselineResistanceStyle,
    baselineEmotionValence: row.baselineEmotionValence,
    baselineEmotionArousal: row.baselineEmotionArousal,
    baselineSafety: row.baselineSafety,
    baselineBond: row.baselineBond,
    speechVolumeBaseline: row.speechVolumeBaseline,
    narrativeStyle: row.narrativeStyle,
    expressionTone: row.expressionTone,
    verbalVoice: row.verbalVoice,
    coreBeliefs: row.coreBeliefs,
    underlyingDesires: row.underlyingDesires,
    forbiddenBehaviors: row.forbiddenBehaviors,
    sensitiveTopics: row.sensitiveTopics,
    auditStatus: row.auditStatus,
    enabled: row.enabled,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    versionPatch: row.versionPatch,
  };
}

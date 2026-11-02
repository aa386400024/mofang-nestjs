// V2026-10-29 治本 (WP9-B · B 层 · MySQL 角色解析器):
//   职责: 实现 WP9-A 冻结的 `CharacterProfileResolver` 端口 —— 从 `character_profiles`
//         取"已审核 + 已上架 + 未软删"的角色行, 转成 WP9-A 的种子形状, 复用**同一份**
//         映射函数产出内核 `CharacterProfile`.
//   边界: 只做「取行 → 转形状 → 交给既有映射」; **零映射公式**; 不写内核快照,
//         不改注入点 (WP9-B 换数据源只改装配层一行绑定).
//
//   为什么"不重写映射"是硬要求 (任务单 §4 反双胞胎):
//     映射公式 (defenseLevel×0.35 / 难度 bonus / style 微调 / clamp01 /
//     transference 全零) 住在 WP9-A 的 `buildCharacterProfile` 一份里.
//     若这里再写一份, 就会出现"内置种子走公式 A、DB 角色走公式 B"的双轨 ——
//     同一个难度档在两条数据源下阻抗不同, 而这种差异**没有任何报错**.
//     所以本文件的职责严格限定为: 取行 → 转 `BuiltinCharacterSeed` 形状 → 调用既有映射.
//
//   为什么"查不到"返 null 而不是抛错:
//     角色池里没有这个 slug / 还没过审 / 已下架 —— 都是**常态**.
//     抛错会把"这场没有角色"升级成"会话开不起来"; 端口契约是返 null, 调用方回退中性.
//
//   反双胞胎:
//     - 不在 SQL 里做数值换算: 库里存的是**基线值**, 临场叠加是映射层的事.
//     - 不把 5Ps 长文喂给内核: five_ps 是人读材料, 内核只吃数值 + 结构化心理要素.
//     - 不把 display_name 之外的展示字段塞进 CharacterProfile: 速查卡是 BFF/前端的关切
//       (任务单 §11.3 明确「不要把 ageRange/riskTags/occupation 塞进 CharacterProfile」).
//     - 不在 resolver 里吞 DB 异常: 异常**向上冒泡**给 `EngineStreamBackend.resolveCharacter`,
//       由那一层统一 warn + 回退中性 (WP9-A 已立的容错边界, 本轮不改那一层).
//     - 不用 `repo.save` 直接写: 写路径归 admin 服务, resolver 是**只读**的.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp9b-db-character-resolver.spec.ts 覆盖命中/未命中/审核态/确定性/preset
//
//   时间戳: 2026-10-29

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import { buildCharacterProfile, stableSeedFromKey, type BuiltinCharacterSeed } from './builtin-character-registry';
import { CharacterProfileEntity } from './character-profile.entity';
import type { CharacterProfileResolver, CharacterResolveRequest, ResolvedCharacter } from './character-profile.resolver';

/**
 * 角色行 → WP9-A 种子形状 (纯映射).
 *
 * **这里不含任何映射公式**: 只把"数据库的一行"翻译成"WP9-A 认识的那个形状",
 * 让 `buildCharacterProfile` 去算阻抗/情绪/信任. 若哪天这里出现 `× 0.35` 之类的
 * 系数, 就是第二份映射公式长出来了 —— 那是本文件最该被拦下的退化.
 *
 * @param row 角色行
 * @returns WP9-A 种子形状
 */
export function toCharacterSeed(row: CharacterProfileEntity): BuiltinCharacterSeed {
  return {
    key: row.templateId,
    displayName: row.displayName,
    attachmentStyle: row.attachmentStyle,
    // 拷贝一层: 避免装配结果与仓储实体共享可变引用 (值语义).
    coreBeliefs: row.coreBeliefs.map((belief) => ({ ...belief, activationTags: [...belief.activationTags] })),
    underlyingDesires: row.underlyingDesires.map((desire) => ({ ...desire })),
    forbiddenBehaviors: [...row.forbiddenBehaviors],
    sensitiveTopics: [...row.sensitiveTopics],
    baseline: {
      trust: row.baselineTrust,
      resistance: {
        verbal: row.baselineResistanceVerbal,
        depth: row.baselineResistanceDepth,
        style: row.baselineResistanceStyle,
      },
      emotion: {
        valence: row.baselineEmotionValence,
        arousal: row.baselineEmotionArousal,
      },
    },
  };
}

/**
 * MySQL 角色解析器 (WP9-B 的数据源实现).
 *
 * 命中口径 (任务单 §4.1): `template_id` 精确匹配 + `audit_status='approved'`
 * + `enabled=1` + `deleted_at IS NULL`.
 */
@Injectable()
export class DbCharacterProfileResolver implements CharacterProfileResolver {
  private readonly logger = new Logger(DbCharacterProfileResolver.name);

  constructor(
    @InjectRepository(CharacterProfileEntity)
    private readonly repo: Repository<CharacterProfileEntity>,
  ) {}

  /**
   * 解析一个角色.
   *
   * @param request 解析请求 (角色 key + 临场参数)
   * @returns 命中 → 角色基线; 未命中 (无此行 / 未过审 / 已下架 / 已软删) → null (**不抛错**)
   */
  async resolve(request: CharacterResolveRequest): Promise<ResolvedCharacter | null> {
    const templateId = request.templateId?.trim();
    if (!templateId) return null;

    const row = await this.repo.findOne({
      where: {
        templateId,
        auditStatus: 'approved',
        enabled: true,
        deletedAt: IsNull(),
      },
    });
    if (!row) {
      await this.logMissReason(templateId);
      return null;
    }

    return {
      // 复用 WP9-A 的唯一一份映射 (临场 preset 的叠加规则与内置种子完全一致).
      characterProfile: buildCharacterProfile(toCharacterSeed(row), request.preset),
      // seed 由角色 key 稳定派生 (与内置种子同一口径: 同一角色 = 同一条轨迹).
      seed: stableSeedFromKey(templateId),
      displayName: row.displayName,
    };
  }

  /**
   * 未命中时补一条**可诊断**的日志.
   *
   * 为什么多查一次: 主查询按 §4.1 的过滤条件查, 查不到时无法区分
   * 「压根没这一行」与「这一行存在但没过审 / 已下架」—— 而这两者对运营的意义
   * 完全不同 (前者是"还没建档", 后者是"建了但不能用"). 多查一次换一条能定位的日志,
   * 值得; 诊断本身再失败也不影响主流程 (会话照常走中性基线).
   *
   * @param templateId 角色 key
   */
  private async logMissReason(templateId: string): Promise<void> {
    try {
      const row = await this.repo.findOne({ where: { templateId, deletedAt: IsNull() } });
      if (!row) {
        // 没建档是常态 (角色池还在扩库期) → debug 级, 不刷 warn.
        this.logger.debug(`[resolve] 无角色行 templateId=${templateId} → 回退中性基线`);
        return;
      }
      const reason = row.enabled ? `审核状态=${row.auditStatus}` : '已下架';
      this.logger.warn(`[resolve] 角色不可用 templateId=${templateId} (${reason}) → 回退中性基线`);
    } catch (error) {
      this.logger.debug(`[resolve] 诊断角色行失败 templateId=${templateId}: ${messageOf(error)}`);
    }
  }
}

/**
 * 错误转可读文案.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

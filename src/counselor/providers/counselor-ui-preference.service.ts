// V2026-10-20 治本 (专项技能 Hero 显示偏好 — Service):
//   原因: 偏好写入必须走白名单校验. 若 controller 直接 merge 任意 JSON key,
//     前端一次 typo 就会写入永久脏偏好, 且无任何报错 —— 属于典型的"沉默故障".
//   修复: read 补齐默认值 + 白名单过滤, update 逐 key 校验, 未知 key 抛 BadRequest.
//   反双胞胎:
//     - 不用 merge 深合并 (偏好是扁平布尔 map, 深合并反而掩盖误用)
//     - 不静默忽略未知 key (静默 = 拼写错误永不被发现, 与 §8 可追溯性冲突)
//   验证:
//     1. GET 任意用户 → 返回全量默认值 (首次访问前无记录也能拿到)
//     2. PATCH { specializedSkillsHeroVisible: false } → 回显 false
//     3. PATCH { unknownKey: 1 } → 400, 消息含 unknownKey
//   时间戳: 2026-10-20
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { CounselorUiPreferencesDto, UpdateCounselorUiPreferencesDto } from '../dto/training-exercise.dto';
import { CounselorUiPreference } from '../entities/counselor-ui-preference.entity';
import { COUNSELOR_UI_PREFERENCE_DEFAULTS, CounselorUiPreferenceKey } from '../enums/counselor-ui-preference-key.enum';
import { LIVE_SUPERVISION_HINT_TIER_VALUES, LiveSupervisionHintTier } from '../enums/live-supervision-hint-tier.enum';

@Injectable()
export class CounselorUiPreferenceService {
  constructor(
    @InjectRepository(CounselorUiPreference)
    private readonly repo: Repository<CounselorUiPreference>,
  ) {}

  async getPreferences(userId: string): Promise<CounselorUiPreferencesDto> {
    const row = await this.repo.findOne({ where: { userId } });

    // 首次访问: 无记录 → 返回全量默认值, 不落库 (读路径不应产生副作用)
    const stored = row?.prefs ?? {};
    return {
      [CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE]: this.readBooleanPref(
        stored,
        CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE,
      ),
      // V2026-10-21 治本 (V1.2 VS-B1 — 上帝视角 key 接入逐 key 显式映射):
      //   原因: 本 service 是**逐 key 显式映射**的 (不是 spread), 所以 enum / defaults / DTO 加了
      //     新 key 之后, 这里不同步就等于该 key 永远读不到 (读出来是 undefined).
      //   修法: 显式补一行, 缺省 false (上帝视角默认关闭, 见 enum 内治本注释).
      //   反双胞胎: 不改成 Object.keys(defaults).reduce(...) 一把梭: 那样新增 key 就不会再漏映射,
      //     但 DTO 是 class (固定字段), 编译期就报缺失 —— 显式映射 + 编译期检查更安全.
      [CounselorUiPreferenceKey.GOD_VIEW_ENABLED]: this.readBooleanPref(stored, CounselorUiPreferenceKey.GOD_VIEW_ENABLED),
      // V2026-10-21 治本 (V1.2 VS-C — 轻提示档位 key 接入逐 key 显式映射):
      //   值类型是字符串 (2 值档位), 缺省回落 defaults (off).
      [CounselorUiPreferenceKey.LIVE_SUPERVISION_HINT_TIER]: this.readTierPref(stored, CounselorUiPreferenceKey.LIVE_SUPERVISION_HINT_TIER),
    };
  }

  /**
   * 读 1 个布尔型偏好 (键缺失 → 回落默认值).
   *
   * V2026-10-21 治本 (V1.2 VS-B2 — prefs 值类型放宽为 `boolean | string` 后的类型收窄):
   *   原因: prefs 的值类型为了容纳档位 (字符串) 放宽成了 `boolean | string`, 直接透传会让
   *     DTO 的布尔字段拿到 `string | boolean` → TS2418.
   *   修法: 收窄在**读取处**做 (而不是在类型上 as 断言): 布尔键只认 `true`, 档位键只认 'light'.
   *   反双胞胎: 不用 `as boolean` 断言压过去: 库里真存了字符串时, 断言会骗过编译器,
   *     让"上帝视角开关"变成真值字符串 ("false" 也是真) —— 那是最典型的偏好坑.
   *
   * @param stored 已存的偏好 map
   * @param key 偏好键
   */
  private readBooleanPref(stored: Record<string, boolean | string>, key: CounselorUiPreferenceKey): boolean {
    const value = stored[key] ?? COUNSELOR_UI_PREFERENCE_DEFAULTS[key];
    return value === true;
  }

  /**
   * 读 1 个档位型偏好 (键缺失 → 回落默认值; 非法值 → 回落 off).
   *
   * @param stored 已存的偏好 map
   * @param key 偏好键
   */
  private readTierPref(stored: Record<string, boolean | string>, key: CounselorUiPreferenceKey): LiveSupervisionHintTier {
    const value = stored[key] ?? COUNSELOR_UI_PREFERENCE_DEFAULTS[key];
    return value === LiveSupervisionHintTier.LIGHT ? LiveSupervisionHintTier.LIGHT : LiveSupervisionHintTier.OFF;
  }

  async updatePreferences(userId: string, dto: UpdateCounselorUiPreferencesDto): Promise<CounselorUiPreferencesDto> {
    const incoming = dto.preferences ?? {};

    // 白名单校验: 显式列出非法 key, 让前端 typo 当场暴露
    const allowed = new Set<string>(Object.values(CounselorUiPreferenceKey));
    const unknown = Object.keys(incoming).filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`未知的界面偏好键: ${unknown.join(', ')}. 允许值: ${[...allowed].join(', ')}`);
    }

    // V2026-10-21 治本 (V1.2 VS-C — 字符串值的**值白名单**):
    //   原因: 键白名单只能拦"未知键", 拦不住"已知键 + 非法值".
    //     prefs 值类型放宽为 `boolean | string` 后, 客户端可以传
    //     { liveSupervisionHintTier: 'garbage' } —— 键合法, 值不合法.
    //     档位是**影响业务分支**的开关 (off → worker 直接跳过, 不跑 LLM), 脏值会让行为不可预期.
    //   修法: 对字符串型偏好键校验取值, 非法就 400 (跟未知键同口径: 当场暴露, 不静默).
    //   反双胞胎: 不在 DTO 上用 @IsIn 校验: preferences 是动态键的 Record,
    //     class-validator 无法逐键声明约束; 值校验放 service (唯一写入口).
    const tierIncoming = incoming[CounselorUiPreferenceKey.LIVE_SUPERVISION_HINT_TIER];
    if (tierIncoming !== undefined && !LIVE_SUPERVISION_HINT_TIER_VALUES.includes(tierIncoming as LiveSupervisionHintTier)) {
      throw new BadRequestException(
        `偏好 ${CounselorUiPreferenceKey.LIVE_SUPERVISION_HINT_TIER} 取值非法: ${String(tierIncoming)}. ` +
          `允许值: ${LIVE_SUPERVISION_HINT_TIER_VALUES.join(' / ')}`,
      );
    }

    const existing = await this.repo.findOne({ where: { userId } });
    const merged: Record<string, boolean | string> = {
      ...COUNSELOR_UI_PREFERENCE_DEFAULTS,
      ...existing?.prefs,
      ...incoming,
    };

    await (existing ? this.repo.update(existing.id, { prefs: merged }) : this.repo.save(this.repo.create({ userId, prefs: merged })));

    return {
      [CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE]: this.readBooleanPref(
        merged,
        CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE,
      ),
      // V2026-10-21 治本 (V1.2 VS-B1 — 上帝视角 key 同上, 逐 key 显式映射)
      [CounselorUiPreferenceKey.GOD_VIEW_ENABLED]: this.readBooleanPref(merged, CounselorUiPreferenceKey.GOD_VIEW_ENABLED),
      // V2026-10-21 治本 (V1.2 VS-C — 轻提示档位 key 同上, 逐 key 显式映射)
      [CounselorUiPreferenceKey.LIVE_SUPERVISION_HINT_TIER]: this.readTierPref(merged, CounselorUiPreferenceKey.LIVE_SUPERVISION_HINT_TIER),
    };
  }
}

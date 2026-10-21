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
      [CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE]:
        stored[CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE] ??
        COUNSELOR_UI_PREFERENCE_DEFAULTS[CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE],
      // V2026-10-21 治本 (V1.2 VS-B1 — 上帝视角 key 接入逐 key 显式映射):
      //   原因: 本 service 是**逐 key 显式映射**的 (不是 spread), 所以 enum / defaults / DTO 加了
      //     新 key 之后, 这里不同步就等于该 key 永远读不到 (读出来是 undefined).
      //   修法: 显式补一行, 缺省 false (上帝视角默认关闭, 见 enum 内治本注释).
      //   反双胞胎: 不改成 Object.keys(defaults).reduce(...) 一把梭: 那样新增 key 就不会再漏映射,
      //     但 DTO 是 class (固定字段), 编译期就报缺失 —— 显式映射 + 编译期检查更安全.
      [CounselorUiPreferenceKey.GOD_VIEW_ENABLED]:
        stored[CounselorUiPreferenceKey.GOD_VIEW_ENABLED] ?? COUNSELOR_UI_PREFERENCE_DEFAULTS[CounselorUiPreferenceKey.GOD_VIEW_ENABLED],
    };
  }

  async updatePreferences(userId: string, dto: UpdateCounselorUiPreferencesDto): Promise<CounselorUiPreferencesDto> {
    const incoming = dto.preferences ?? {};

    // 白名单校验: 显式列出非法 key, 让前端 typo 当场暴露
    const allowed = new Set<string>(Object.values(CounselorUiPreferenceKey));
    const unknown = Object.keys(incoming).filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(`未知的界面偏好键: ${unknown.join(', ')}. 允许值: ${[...allowed].join(', ')}`);
    }

    const existing = await this.repo.findOne({ where: { userId } });
    const merged: Record<string, boolean> = {
      ...COUNSELOR_UI_PREFERENCE_DEFAULTS,
      ...existing?.prefs,
      ...incoming,
    };

    await (existing ? this.repo.update(existing.id, { prefs: merged }) : this.repo.save(this.repo.create({ userId, prefs: merged })));

    return {
      [CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE]: merged[CounselorUiPreferenceKey.SPECIALIZED_SKILLS_HERO_VISIBLE],
      // V2026-10-21 治本 (V1.2 VS-B1 — 上帝视角 key 同上, 逐 key 显式映射)
      [CounselorUiPreferenceKey.GOD_VIEW_ENABLED]: merged[CounselorUiPreferenceKey.GOD_VIEW_ENABLED],
    };
  }
}

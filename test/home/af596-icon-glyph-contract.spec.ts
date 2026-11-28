// AF-596 · 图标字段 glyph 枚举兼容契约
//
// 覆盖:
//   ① 共享白名单严格 23 项且无重复;
//   ② guide 12 门课程 coverGlyph 全部落在白名单;
//   ③ 咨询师端 4 个入口卡 glyph 全部落在白名单;
//   ④ 首页支撑关系 avatarGlyph 按权限层级映射;
//   ⑤ 陪伴者端首页 avatarGlyph + 工具卡 glyph 与旧字段同图;
//   ⑥ 微干预工具卡 icon → glyph 映射, 未知图标返回 null;
//   ⑦ 同一版本保留旧字段 (avatarEmoji / coverEmoji / emoji / icon).
//
// 验证: pnpm exec vitest run test/home/af596-icon-glyph-contract.spec.ts

import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { CounselorHomeService } from '../../src/counselor/providers/counselor-home.service.js';
import { GuideService } from '../../src/guide/providers/guide.service.js';
import { HomeMessage } from '../../src/home/entities/home-message.entity.js';
import { MicroInterventionScenario } from '../../src/home/entities/micro-intervention-scenario.entity.js';
import { HomeCompanionService } from '../../src/home/providers/home-companion.service.js';
import { HomeMicroInterventionScenarioService } from '../../src/home/providers/home-micro-intervention-scenario.service.js';
import type { HomeMicroInterventionStatsService } from '../../src/home/providers/home-micro-intervention-stats.service.js';
import type { HomeMicroInterventionService } from '../../src/home/providers/home-micro-intervention.service.js';
import type { HomeMoodLogService } from '../../src/home/providers/home-mood-log.service.js';
import { HomeOverviewService } from '../../src/home/providers/home-overview.service.js';
import type { HomeRecommendationEngine } from '../../src/home/providers/home-recommendation.engine.js';
import { CompanionBinding } from '../../src/profile/entities/companion-binding.entity.js';
import { UserProfile } from '../../src/profile/entities/user-profile.entity.js';
import { ICON_GLYPHS, isIconGlyph, type IconGlyph } from '../../src/shared/types/icon-glyph.types.js';
import { User } from '../../src/user/entities/user.entity.js';

const EXPECTED_GLYPHS = [
  'personUser',
  'personSupport',
  'personFriend',
  'personFamily',
  'personCompanion',
  'personVerified',
  'statusCare',
  'statusSuccess',
  'statusWarning',
  'moodNature',
  'moodGreat',
  'moodGood',
  'moodNeutral',
  'moodLow',
  'moodCrisis',
  'growthTarget',
  'growthStar',
  'growthBadgeCompanion',
  'actionMail',
  'actionShare',
  'actionArchive',
  'systemHandbook',
  'practiceBreathing',
] as const;

function expectGlyph(value: unknown): asserts value is IconGlyph {
  expect(isIconGlyph(value)).toBe(true);
}

function asRepo<T>(value: unknown): Repository<T> {
  return value as Repository<T>;
}

describe('AF-596 图标枚举白名单', () => {
  it('严格等于前端给定的 23 个枚举名且无重复', () => {
    expect(ICON_GLYPHS).toHaveLength(23);
    expect([...ICON_GLYPHS]).toEqual(EXPECTED_GLYPHS);
    expect(new Set(ICON_GLYPHS).size).toBe(ICON_GLYPHS.length);
  });
});

describe('AF-596 guide 课程封面', () => {
  it('12 门课程同时保留 coverEmoji 并新增合法 coverGlyph', () => {
    const courses = new GuideService().courses;
    expect(courses).toHaveLength(12);
    for (const course of courses) {
      expect(course.coverEmoji).toBeTruthy();
      expectGlyph(course.coverGlyph);
    }
  });
});

describe('AF-596 咨询师端入口卡', () => {
  it('4 个训练分类同时保留 emoji 并新增合法 glyph', async () => {
    const overview = await new CounselorHomeService().getOverview('uid');
    expect(overview.trainingCategories).toHaveLength(4);
    for (const category of overview.trainingCategories) {
      expect(category.emoji).toBeTruthy();
      expectGlyph(category.glyph);
    }
  });
});

describe('AF-596 首页支撑关系', () => {
  it('陪伴者头像按 L1/L2/L3 映射到对应 glyph', async () => {
    const bindingRepo = asRepo<CompanionBinding>({
      find: vi.fn().mockResolvedValue([
        { id: 'b1', ownerUid: 'u1', companionUid: 'c1', permissionLevel: 'L1', status: 'active', boundAt: new Date() },
        { id: 'b2', ownerUid: 'u1', companionUid: 'c2', permissionLevel: 'L2', status: 'active', boundAt: new Date() },
        { id: 'b3', ownerUid: 'u1', companionUid: 'c3', permissionLevel: 'L3', status: 'active', boundAt: new Date() },
      ]),
    });
    const profileRepo = asRepo<UserProfile>({
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([
        { uid: 'c1', nickname: 'A' },
        { uid: 'c2', nickname: 'B' },
        { uid: 'c3', nickname: 'C' },
      ]),
    });
    const userRepo = asRepo<User>({ findOne: vi.fn().mockResolvedValue(null) });
    const messageRepo = asRepo<HomeMessage>({ count: vi.fn().mockResolvedValue(0) });
    const moodService = { getTodayLatest: vi.fn().mockResolvedValue(null) } as unknown as HomeMoodLogService;
    const microService = {
      getActive: vi.fn().mockResolvedValue({ active: null, pending: null }),
    } as unknown as HomeMicroInterventionService;
    const microStatsService = {
      getStats: vi.fn().mockResolvedValue({ completedThisWeek: 0, triggeredToday: 0, consecutiveDays: 0 }),
    } as unknown as HomeMicroInterventionStatsService;
    const microScenarioService = { listActive: vi.fn().mockResolvedValue([]) } as unknown as HomeMicroInterventionScenarioService;
    const recommendationEngine = {
      greet: vi.fn().mockReturnValue({ timeSlot: 'morning', greeting: '早上好', dateLabel: '11 月 28 日' }),
      pick: vi.fn().mockReturnValue({
        id: 'rec-1',
        title: '接地',
        summary: '回到当下',
        durationMinutes: 5,
        scenario: '情绪失控时',
        matchedReason: '情绪匹配',
        kind: 'grounding',
        routePath: '/tools/grounding',
      }),
    } as unknown as HomeRecommendationEngine;
    const service = new HomeOverviewService(
      bindingRepo,
      profileRepo,
      userRepo,
      messageRepo,
      moodService,
      microService,
      microStatsService,
      microScenarioService,
      recommendationEngine,
    );

    const overview = await service.getOverview('u1', null);
    expect(overview.companions.map((c) => c.avatarEmoji)).toEqual(['🌸', '🌿', '🌷']);
    expect(overview.companions.map((c) => c.avatarGlyph)).toEqual(['personUser', 'personCompanion', 'personVerified']);
    for (const companion of overview.companions) {
      expectGlyph(companion.avatarGlyph);
    }
  });
});

describe('AF-596 陪伴者端首页', () => {
  function buildService(): HomeCompanionService {
    const binding = {
      id: 'b1',
      ownerUid: 'owner',
      companionUid: 'companion',
      permissionLevel: 'L2',
      status: 'active',
      boundAt: new Date(),
    };
    const bindingRepo = asRepo<CompanionBinding>({
      find: vi.fn().mockResolvedValue([binding]),
      findOne: vi.fn().mockResolvedValue(binding),
    });
    const profileRepo = asRepo<UserProfile>({
      find: vi.fn().mockResolvedValue([{ uid: 'owner', nickname: '对方' }]),
      findOne: vi.fn().mockResolvedValue({ uid: 'owner', nickname: '对方' }),
    });
    return new HomeCompanionService(bindingRepo, profileRepo);
  }

  it('首页头像 / 被陪伴者头像同时保留 emoji 并新增合法 glyph', async () => {
    const overview = await buildService().getOverview('companion');
    expect(overview.avatarEmoji).toBe('🤝');
    expect(overview.avatarGlyph).toBe('personSupport');
    expect(overview.accompaniedPersonStatus.avatarEmoji).toBe('🌱');
    expect(overview.accompaniedPersonStatus.avatarGlyph).toBe('personCompanion');
    expectGlyph(overview.avatarGlyph);
    expectGlyph(overview.accompaniedPersonStatus.avatarGlyph);
  });

  it('5 个工具卡同时保留 emoji 并新增合法 glyph', async () => {
    const overview = await buildService().getOverview('companion');
    expect(overview.toolbox.map((item) => item.emoji)).toEqual(['💌', '🤝', '📝', '🆘', '🌱']);
    expect(overview.toolbox.map((item) => item.glyph)).toEqual([
      'actionMail',
      'personSupport',
      'actionArchive',
      'statusWarning',
      'growthTarget',
    ]);
    for (const item of overview.toolbox) {
      expectGlyph(item.glyph);
    }
  });

  it('切换陪伴对象返回 avatarGlyph', async () => {
    const response = await buildService().switchAccompaniedPerson('companion', 'b1');
    expect(response?.avatarEmoji).toBe('🌱');
    expect(response?.avatarGlyph).toBe('personCompanion');
    expectGlyph(response?.avatarGlyph);
  });
});

describe('AF-596 微干预工具卡', () => {
  function buildService(rows: MicroInterventionScenario[]): HomeMicroInterventionScenarioService {
    return new HomeMicroInterventionScenarioService(asRepo<MicroInterventionScenario>({ find: vi.fn().mockResolvedValue(rows) }));
  }

  function scenario(icon: string): MicroInterventionScenario {
    return {
      trigger: `trigger-${icon}`,
      scenario: '场景',
      icon,
      kind: 'breathing',
      durationSeconds: 30,
      category: 'rest',
      triggerDescription: '说明',
      accentKey: 'softBlue',
      displayOrder: 1,
      isEnabled: true,
    } as unknown as MicroInterventionScenario;
  }

  it('7 个种子图标全部有稳定 glyph 映射', async () => {
    const icons = ['📅', '👥', '🌙', '💢', '📱', '🌌', '☀️'];
    const expected: IconGlyph[] = ['growthTarget', 'personSupport', 'moodNeutral', 'statusWarning', 'moodLow', 'moodNature', 'moodGreat'];
    const rows = await buildService(icons.map(scenario)).listActive();
    expect(rows.map((row) => row.icon)).toEqual(icons);
    expect(rows.map((row) => row.glyph)).toEqual(expected);
    for (const row of rows) {
      expectGlyph(row.glyph);
    }
  });

  it('未知 icon 返回 null, 交由前端兜底 personUser', async () => {
    const [row] = await buildService([scenario('🦄')]).listActive();
    expect(row?.icon).toBe('🦄');
    expect(row?.glyph).toBeNull();
  });
});

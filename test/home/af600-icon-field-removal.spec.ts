// AF-600 · 旧 emoji 字段删除契约
//
// 覆盖:
//   ① GET /home/overview：L2 陪伴者只返回 avatarGlyph=personCompanion，avatarEmoji 缺席；
//   ② GET /home/companion-overview：首页/被陪伴者/工具箱只返回 glyph，旧 emoji 字段缺席；
//   ③ GET /guide/courses：12 门课程只返回合法 coverGlyph，pitfall_001→systemHandbook；
//   ④ GET /counselor/home/overview：4 个分类只返回合法 glyph，fullSession→statusSuccess；
//   ⑤ 微干预只返回 glyph，旧 icon 字段缺席；未知 glyph 为 null；
//   ⑥ OpenAPI 中 8 个旧属性全部消失，新 glyph 属性保留。
//
// 验证: pnpm exec vitest run test/home/af600-icon-field-removal.spec.ts

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ObjectLiteral, Repository } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CounselorHomeController } from '../../src/counselor/controllers/counselor-home.controller.js';
import { CounselorTrainingCategoryDto } from '../../src/counselor/dto/counselor-home.dto.js';
import { CounselorHomeService } from '../../src/counselor/providers/counselor-home.service.js';
import { GuideController } from '../../src/guide/controllers/guide.controller.js';
import { GuideCourseDto } from '../../src/guide/dto/guide.dto.js';
import { GuideService } from '../../src/guide/providers/guide.service.js';
import { HomeCompanionOverviewController } from '../../src/home/controllers/home-companion-overview.controller.js';
import { HomeOverviewController } from '../../src/home/controllers/home-overview.controller.js';
import {
  CompanionHomeOverviewDto,
  CompanionPersonStatusDto,
  SwitchAccompaniedPersonResponseDto,
  ToolboxItemDto,
} from '../../src/home/dto/home-companion-overview.dto.js';
import { MicroInterventionScenarioDto, SupportCompanionDto } from '../../src/home/dto/home-overview.dto.js';
import { HomeMessage } from '../../src/home/entities/home-message.entity.js';
import { HomeCompanionService } from '../../src/home/providers/home-companion.service.js';
import type { HomeMicroInterventionScenarioService } from '../../src/home/providers/home-micro-intervention-scenario.service.js';
import type { HomeMicroInterventionStatsService } from '../../src/home/providers/home-micro-intervention-stats.service.js';
import type { HomeMicroInterventionService } from '../../src/home/providers/home-micro-intervention.service.js';
import type { HomeMoodLogService } from '../../src/home/providers/home-mood-log.service.js';
import { HomeOverviewService } from '../../src/home/providers/home-overview.service.js';
import type { HomeRecommendationEngine } from '../../src/home/providers/home-recommendation.engine.js';
import { CompanionBinding } from '../../src/profile/entities/companion-binding.entity.js';
import { UserProfile } from '../../src/profile/entities/user-profile.entity.js';
import { isIconGlyph, type IconGlyph } from '../../src/shared/types/icon-glyph.types.js';
import { User } from '../../src/user/entities/user.entity.js';
import { JwtAuthGuard } from '../../src/user/guards/jwt-auth.guard.js';

function asRepo<T extends ObjectLiteral>(value: unknown): Repository<T> {
  return value as Repository<T>;
}

function expectGlyph(value: unknown): asserts value is IconGlyph {
  expect(isIconGlyph(value)).toBe(true);
}

function buildOverviewService(): HomeOverviewService {
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
  const microService = { getActive: vi.fn().mockResolvedValue({ active: null, pending: null }) } as unknown as HomeMicroInterventionService;
  const microStatsService = {
    getStats: vi.fn().mockResolvedValue({ completedThisWeek: 0, triggeredToday: 0, consecutiveDays: 0 }),
  } as unknown as HomeMicroInterventionStatsService;
  const microScenarioService = {
    listActive: vi.fn().mockResolvedValue([
      {
        trigger: 'before_meeting',
        scenario: '会议前',
        glyph: 'growthTarget',
        kind: 'breathing',
        durationSeconds: 30,
        category: 'work',
        triggerDescription: '会议前 5 分钟',
        accentKey: 'softBlue',
        displayOrder: 1,
        isEnabled: true,
      },
      {
        trigger: 'unknown',
        scenario: '未知',
        glyph: null,
        kind: 'breathing',
        durationSeconds: 30,
        category: 'rest',
        triggerDescription: '未知图标',
        accentKey: 'softBlue',
        displayOrder: 2,
        isEnabled: true,
      },
    ]),
  } as unknown as HomeMicroInterventionScenarioService;
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
  return new HomeOverviewService(
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
}

function buildCompanionService(): HomeCompanionService {
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

describe('AF-600 旧 emoji 字段删除契约', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HomeOverviewController, HomeCompanionOverviewController, GuideController, CounselorHomeController],
      providers: [
        { provide: HomeOverviewService, useValue: buildOverviewService() },
        { provide: HomeCompanionService, useValue: buildCompanionService() },
        GuideService,
        CounselorHomeService,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: { userId: string } } } }) => {
          context.switchToHttp().getRequest().user = { userId: 'u1' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /home/overview 只返回 L2 的 avatarGlyph，avatarEmoji 缺席', async () => {
    const res = await request(app.getHttpServer()).get('/home/overview').expect(200);
    const companions = res.body.companions as { avatarGlyph: string; avatarEmoji?: unknown }[];
    expect(companions.map((item) => item.avatarGlyph)).toEqual(['personUser', 'personCompanion', 'personVerified']);
    for (const companion of companions) {
      expectGlyph(companion.avatarGlyph);
      expect(companion).not.toHaveProperty('avatarEmoji');
    }
  });

  it('GET /home/overview 微干预只返回 glyph，旧 icon 缺席', async () => {
    const res = await request(app.getHttpServer()).get('/home/overview').expect(200);
    const scenarios = res.body.microInterventionScenarios as { glyph: IconGlyph | null; icon?: unknown }[];
    expect(scenarios[0]?.glyph).toBe('growthTarget');
    expect(scenarios[1]?.glyph).toBeNull();
    for (const scenario of scenarios) {
      expect(scenario).not.toHaveProperty('icon');
    }
  });

  it('GET /home/companion-overview 首页、被陪伴者与工具箱只返回 glyph', async () => {
    const res = await request(app.getHttpServer()).get('/home/companion-overview').expect(200);
    expect(res.body.avatarGlyph).toBe('personSupport');
    expect(res.body).not.toHaveProperty('avatarEmoji');
    expect(res.body.accompaniedPersonStatus.avatarGlyph).toBe('personCompanion');
    expect(res.body.accompaniedPersonStatus).not.toHaveProperty('avatarEmoji');
    const toolbox = res.body.toolbox as { glyph: IconGlyph; emoji?: unknown }[];
    expect(toolbox.map((item) => item.glyph)).toEqual(['actionMail', 'personSupport', 'actionArchive', 'statusWarning', 'growthTarget']);
    for (const item of toolbox) {
      expectGlyph(item.glyph);
      expect(item).not.toHaveProperty('emoji');
    }
  });

  it('GET /guide/courses 12 门课程只返回 coverGlyph，pitfall_001→systemHandbook', async () => {
    const res = await request(app.getHttpServer()).get('/guide/courses').expect(200);
    const courses = res.body.courses as { id: string; coverGlyph: IconGlyph; coverEmoji?: unknown }[];
    expect(courses).toHaveLength(12);
    for (const course of courses) {
      expectGlyph(course.coverGlyph);
      expect(course).not.toHaveProperty('coverEmoji');
    }
    expect(courses.find((course) => course.id === 'pitfall_001')?.coverGlyph).toBe('systemHandbook');
  });

  it('GET /counselor/home/overview 4 个分类只返回 glyph，fullSession→statusSuccess', async () => {
    const res = await request(app.getHttpServer()).get('/counselor/home/overview').expect(200);
    const categories = res.body.trainingCategories as { category: string; glyph: IconGlyph; emoji?: unknown }[];
    expect(categories).toHaveLength(4);
    for (const category of categories) {
      expectGlyph(category.glyph);
      expect(category).not.toHaveProperty('emoji');
    }
    expect(categories.find((category) => category.category === 'fullSession')?.glyph).toBe('statusSuccess');
  });

  it('OpenAPI 中 8 个旧属性全部消失，新 glyph 属性保留', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build(), {
      extraModels: [
        SupportCompanionDto,
        MicroInterventionScenarioDto,
        CompanionPersonStatusDto,
        ToolboxItemDto,
        SwitchAccompaniedPersonResponseDto,
        CompanionHomeOverviewDto,
        GuideCourseDto,
        CounselorTrainingCategoryDto,
      ],
    });
    const schemas = document.components?.schemas ?? {};
    const cases: [string, string, string][] = [
      ['SupportCompanionDto', 'avatarEmoji', 'avatarGlyph'],
      ['MicroInterventionScenarioDto', 'icon', 'glyph'],
      ['CompanionPersonStatusDto', 'avatarEmoji', 'avatarGlyph'],
      ['ToolboxItemDto', 'emoji', 'glyph'],
      ['SwitchAccompaniedPersonResponseDto', 'avatarEmoji', 'avatarGlyph'],
      ['CompanionHomeOverviewDto', 'avatarEmoji', 'avatarGlyph'],
      ['GuideCourseDto', 'coverEmoji', 'coverGlyph'],
      ['CounselorTrainingCategoryDto', 'emoji', 'glyph'],
    ];
    for (const [schemaName, removed, kept] of cases) {
      const schema = schemas[schemaName] as { properties?: Record<string, unknown> } | undefined;
      expect(schema?.properties?.[removed], `${schemaName}.${removed} 应已删除`).toBeUndefined();
      expect(schema?.properties?.[kept], `${schemaName}.${kept} 应保留`).toBeTruthy();
    }
  });
});

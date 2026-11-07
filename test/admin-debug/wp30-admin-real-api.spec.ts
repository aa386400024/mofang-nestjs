// V2026-11-05 治本 (WP30 · 调试器两页切真 API · 单测):
//   覆盖任务单 §五 的验收:
//     ① GET /admin/api/characters/:slug            → 角色详情 (含 auditStatus + 5Ps 映射)
//     ② GET /admin/api/characters/:slug/sessions   → 该角色的最近 N 场会话
//     ③ GET /admin/api/sessions/:id/trajectory     → 轨迹 (幕路径 + 已触发节点)
//     ④ GET /admin/api/sessions/:id/memories       → 本场记忆 (当前恒空)
//     ⑤ 4 个新端点全部继承 class 级 AdminRoleGuard (非 admin → 403)
//     ⑥ 角色不存在 / 会话不存在 → 404
//
//   全 mock: 不起 Nest 容器, 不连 DB, 不发网络.
//     · 角色仓储 / 会话仓储用 stub (只实现 controller 用到的那两个方法);
//     · 剧本走仓库真静态资产 (ETHICAL_TRAJECTORY_SCRIPT_MAP) —— 标题与幕序是真值,
//       不用桩数据冒充, 免得"测试通过但线上标题不对".
//
//   验证: npx vitest run test/admin-debug/wp30-admin-real-api.spec.ts
//   时间戳: 2026-11-05 GMT+8
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { FindOperator } from 'typeorm';

import { AdminDebugController } from '../../src/admin-debug/admin-debug.controller.js';
import { AdminRoleGuard } from '../../src/admin-debug/guards/admin-role.guard.js';
import type { TurnTrace } from '../../src/admin-debug/trace-recorder.service.js';
import { buildAdminTrajectoryState } from '../../src/admin-debug/trajectory-view.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';

const USER_ID = 'admin-user';
const SLUG = 'vpt_intimate_avoidance_l1';
const OTHER_SLUG = 'vpt_dependent_hypervigilance_l2';
const SESSION_ID = 'session-a';

/** 仓库里的真剧本 id (伦理盲盒 1 · 表白). */
const SCRIPT_ID = 'ethical_romantic_confession';
/** 危机剧本 (第 2 幕后缀是 `_signal` 而不是 `_event` —— 映射要认它). */
const CRISIS_SCRIPT_ID = 'ethical_suicide_crisis';

/**
 * 假配置服务 (只回 env 字典).
 */
function stubConfig(env: Record<string, string>): { get<T>(key: string): T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

/**
 * 假 Redis (只有统计端点用得到; 既有端点不碰 Redis).
 *
 * ⚠️ 为什么给**必填**的第 4 个构造参数而不是"可选依赖 + 运行时兜底":
 *   可选依赖在 DI 里会**静默注入 undefined** —— 端点一调就炸, 而且报错现场
 *   离根因很远 (上一单 B1 认定的最危险模式). 必填 = 编译器逼着每个构造点补上.
 */
function stubRedis(hash: Record<string, string> = {}): { hgetall(): Promise<Record<string, string>> } {
  return {
    async hgetall(): Promise<Record<string, string>> {
      return { ...hash };
    },
  };
}

/**
 * where 条件匹配 (等值 + IsNull).
 *
 * 为什么支持 `IsNull`: controller 的软删过滤写的就是 `deletedAt: IsNull()`,
 * stub 若不认这个算子, "查得到" 的用例会假失败.
 */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull') return row[key] === null || row[key] === undefined;
      return true;
    }
    if (expected === null || expected === undefined) return true;
    return row[key] === expected;
  });
}

/**
 * 假角色仓储 (查一行 + 查列表).
 */
class FakeCharacterRepo {
  readonly rows: Record<string, unknown>[] = [];
  readonly findCalls: unknown[] = [];
  readonly findOneCalls: { readonly where?: Record<string, unknown> }[] = [];

  async find(options: { readonly where?: Record<string, unknown> }): Promise<Record<string, unknown>[]> {
    this.findCalls.push(options);
    return this.rows.filter((row) => matchesWhere(row, options.where));
  }

  async findOne(options: { readonly where?: Record<string, unknown> }): Promise<Record<string, unknown> | null> {
    this.findOneCalls.push(options);
    return this.rows.find((row) => matchesWhere(row, options.where)) ?? null;
  }
}

/**
 * 假会话仓储 (查一行 + 查列表; 列表按 startedAt 倒序并遵守 take).
 */
class FakeSessionReadRepo {
  readonly rows: Record<string, unknown>[] = [];
  readonly findCalls: { readonly where?: Record<string, unknown>; readonly take?: number }[] = [];

  async find(options: { readonly where?: Record<string, unknown>; readonly take?: number }): Promise<Record<string, unknown>[]> {
    this.findCalls.push(options);
    const matched = this.rows.filter((row) => matchesWhere(row, options.where));
    const sorted = [...matched].sort((a, b) => {
      const left = a['startedAt'] instanceof Date ? a['startedAt'].getTime() : 0;
      const right = b['startedAt'] instanceof Date ? b['startedAt'].getTime() : 0;
      return right - left;
    });
    return options.take === undefined ? sorted : sorted.slice(0, options.take);
  }

  async findOne(options: { readonly where?: Record<string, unknown> }): Promise<Record<string, unknown> | null> {
    this.findCalls.push(options);
    return this.rows.find((row) => matchesWhere(row, options.where)) ?? null;
  }
}

/**
 * 装一个 controller (会话仓储 + 角色仓储 + 配置).
 */
function buildController(): {
  readonly controller: AdminDebugController;
  readonly sessionRepo: FakeSessionReadRepo;
  readonly characterRepo: FakeCharacterRepo;
} {
  const sessionRepo = new FakeSessionReadRepo();
  const characterRepo = new FakeCharacterRepo();
  const controller = new AdminDebugController(sessionRepo as never, characterRepo as never, stubConfig({}) as never, stubRedis() as never);
  return { controller, sessionRepo, characterRepo };
}

/**
 * 造一行角色基线 (`character_profiles`).
 */
function buildCharacterRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cp-1',
    templateId: SLUG,
    displayName: '晚晴',
    attachmentStyle: 'avoidant',
    fivePs: {
      presenting: '主诉: 亲密关系中反复感到被抛弃',
      precipitating: '诱发: 三个月前对方提出分手',
      maintaining: '维持: 长期回避亲密需求',
      protective: '保护: 有稳定支持系统与工作',
      vulnerability: '易感: 早年依恋关系不稳定',
    },
    baselineTrust: 0.28,
    baselineResistanceVerbal: 0.42,
    baselineResistanceDepth: 0.5,
    baselineResistanceStyle: 0.38,
    baselineEmotionValence: -0.45,
    baselineEmotionArousal: 0.62,
    baselineSafety: 0.5,
    baselineBond: 0,
    speechVolumeBaseline: 0.42,
    narrativeStyle: 'disorganized',
    expressionTone: 'intellectualizing',
    enabled: true,
    auditStatus: 'approved',
    version: 1,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * 造一份逐轮留痕快照.
 */
function buildTrace(overrides: Partial<TurnTrace> = {}): TurnTrace {
  return {
    turnIndex: 0,
    characterSlug: SLUG,
    bdiSnapshot: { trust: 0.3, valence: -0.2, arousal: 0.5, resistance: 0.4, anxiousSecure: 'anxious' },
    renderSpec: { taskKind: 'reply', promptPreview: '', maxCompletionTokens: 512, reasoningEffort: 'medium' },
    llmUsage: { promptTokens: 100, completionTokens: 50, reasoningTokens: 10, ttftMs: 120, finishReason: 'stop' },
    crisis: { detected: false, category: null },
    ts: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('WP30 · Admin Dashboard 切真 API', () => {
  describe('① GET /admin/api/characters/:slug — 角色详情', () => {
    it('返回角色详情, 含 auditStatus / 5Ps / 表达风格 / 基线', async () => {
      const { controller, characterRepo } = buildController();
      characterRepo.rows.push(buildCharacterRow());

      const detail = await controller.character({ adminBasicAuth: true } as never, SLUG);

      expect(detail.slug).toBe(SLUG);
      expect(detail.codename).toBe('晚晴');
      expect(detail.attachmentStyle).toBe('avoidant');
      expect(detail.enabled).toBe(true);
      // 审核态必须是后端真值 (任务单验收 §5.1 第 1 条).
      expect(detail.auditStatus).toBe('approved');
      expect(detail.baseline.trust).toBeCloseTo(0.28);
      expect(detail.baseline.resist).toBeCloseTo(0.42);
      expect(detail.baseline.valence).toBeCloseTo(-0.45);
      expect(detail.baseline.arousal).toBeCloseTo(0.62);
      expect(detail.resistance.depth).toBeCloseTo(0.5);
      expect(detail.expressionStyle).toEqual({
        speechVolumeBaseline: 0.42,
        narrativeStyle: 'disorganized',
        expressionTone: 'intellectualizing',
      });
    });

    it('5Ps 走临床对应映射 (vulnerability→predisposing, maintaining→perpetuating)', async () => {
      const { controller, characterRepo } = buildController();
      characterRepo.rows.push(buildCharacterRow());

      const detail = await controller.character({ adminBasicAuth: true } as never, SLUG);

      expect(detail.fivePs.presenting).toBe('主诉: 亲密关系中反复感到被抛弃');
      expect(detail.fivePs.precipitating).toBe('诱发: 三个月前对方提出分手');
      expect(detail.fivePs.perpetuating).toBe('维持: 长期回避亲密需求');
      expect(detail.fivePs.protecting).toBe('保护: 有稳定支持系统与工作');
      expect(detail.fivePs.predisposing).toBe('易感: 早年依恋关系不稳定');
    });

    it('角色不存在 → 404 (ResourceNotFound)', async () => {
      const { controller } = buildController();

      await expect(controller.character({ adminBasicAuth: true } as never, 'missing-slug')).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });

    it('软删的角色查不到 → 404', async () => {
      const { controller, characterRepo } = buildController();
      characterRepo.rows.push(buildCharacterRow({ deletedAt: new Date('2026-11-05T00:00:00Z') }));

      await expect(controller.character({ adminBasicAuth: true } as never, SLUG)).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });

  describe('② GET /admin/api/characters/:slug/sessions — 角色历史会话', () => {
    it('只返回该角色的会话 (按留痕里的 characterSlug 过滤)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push(
        {
          id: 's-1',
          personaName: '晚晴',
          startedAt: new Date('2026-11-05T10:00:00Z'),
          endedAt: new Date('2026-11-05T10:30:00Z'),
          status: 'completed',
          turnDebugTrace: [buildTrace({ characterSlug: SLUG })],
        },
        {
          id: 's-2',
          personaName: '小满',
          startedAt: new Date('2026-11-05T09:00:00Z'),
          endedAt: null,
          status: 'active',
          turnDebugTrace: [buildTrace({ characterSlug: OTHER_SLUG })],
        },
      );

      const rows = await controller.characterSessions({ adminBasicAuth: true } as never, SLUG);

      expect(rows).toHaveLength(1);
      expect(rows.at(0)?.sessionId).toBe('s-1');
      expect(rows.at(0)?.visitorAlias).toBe('晚晴');
      expect(rows.at(0)?.durationSec).toBe(1800);
      expect(rows.at(0)?.totalTokens).toBe(150);
    });

    it('没有留痕的会话不归属任何角色 (角色只存在于留痕里)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({
        id: 's-3',
        personaName: '无名',
        startedAt: new Date('2026-11-05T10:00:00Z'),
        endedAt: null,
        status: 'active',
        turnDebugTrace: null,
      });

      const rows = await controller.characterSessions({ adminBasicAuth: true } as never, SLUG);

      expect(rows).toHaveLength(0);
    });

    it('学员只看自己的会话 (ownerFilter 生效)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({
        id: 's-4',
        userId: 'student-b',
        personaName: '小满',
        startedAt: new Date('2026-11-05T10:00:00Z'),
        endedAt: null,
        status: 'active',
        turnDebugTrace: [buildTrace({ characterSlug: SLUG })],
      });

      const rows = await controller.characterSessions({ user: { userId: USER_ID } } as never, SLUG);

      expect(rows).toHaveLength(0);
      expect(sessionRepo.findCalls.at(-1)?.where?.['userId']).toBe(USER_ID);
    });

    it('sessionCount 与会话列表同源 (同一份过滤口径, 不两次各算一遍)', async () => {
      const { controller, sessionRepo, characterRepo } = buildController();
      characterRepo.rows.push(buildCharacterRow());
      sessionRepo.rows.push(
        {
          id: 's-1',
          personaName: '晚晴',
          startedAt: new Date('2026-11-05T10:00:00Z'),
          endedAt: null,
          status: 'completed',
          turnDebugTrace: [buildTrace({ characterSlug: SLUG })],
        },
        {
          id: 's-2',
          personaName: '晚晴',
          startedAt: new Date('2026-11-04T10:00:00Z'),
          endedAt: null,
          status: 'completed',
          turnDebugTrace: [buildTrace({ characterSlug: SLUG })],
        },
      );

      const detail = await controller.character({ adminBasicAuth: true } as never, SLUG);
      const rows = await controller.characterSessions({ adminBasicAuth: true } as never, SLUG);

      expect(detail.sessionCount).toBe(2);
      expect(rows).toHaveLength(2);
    });

    it('单次最多返回 20 场 (任务单 §八 Q2)', async () => {
      const { controller, sessionRepo } = buildController();
      for (let i = 0; i < 25; i += 1) {
        sessionRepo.rows.push({
          id: `s-${i}`,
          personaName: '晚晴',
          startedAt: new Date(`2026-11-0${(i % 9) + 1}T10:00:00Z`),
          endedAt: null,
          status: 'completed',
          turnDebugTrace: [buildTrace({ characterSlug: SLUG })],
        });
      }

      const rows = await controller.characterSessions({ adminBasicAuth: true } as never, SLUG);

      expect(rows).toHaveLength(20);
    });
  });

  describe('③ GET /admin/api/sessions/:id/trajectory — 剧本轨迹', () => {
    it('返回幕路径与已触发节点 (含类型与触发时刻)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({
        id: SESSION_ID,
        personaName: '晚晴',
        startedAt: new Date('2026-11-05T10:00:00Z'),
        endedAt: null,
        status: 'active',
        turnDebugTrace: [
          buildTrace({
            turnIndex: 0,
            ts: '2026-11-05T10:00:00.000Z',
            trajectoryTrace: {
              scriptId: SCRIPT_ID,
              mode: 'force_override',
              activated: true,
              activeNodeId: 'confession_free',
              advanced: false,
              cursor: 0,
              visitedNodeIds: ['confession_free'],
            },
          }),
          buildTrace({
            turnIndex: 1,
            ts: '2026-11-05T10:05:00.000Z',
            trajectoryTrace: {
              scriptId: SCRIPT_ID,
              mode: 'force_override',
              activated: true,
              activeNodeId: 'confession_event',
              advanced: true,
              cursor: 2,
              visitedNodeIds: ['confession_free', 'confession_event'],
            },
          }),
        ],
      });

      const state = await controller.sessionTrajectory({ adminBasicAuth: true } as never, SESSION_ID);

      expect(state).not.toBeNull();
      expect(state?.scriptId).toBe(SCRIPT_ID);
      // 剧本标题取仓库真静态资产, 不是编的.
      expect(state?.scriptName).toContain('情感');
      expect(state?.currentNode).toBe('confession_event');
      expect(state?.path).toEqual(['confession_free', 'confession_event']);
      expect(state?.triggered.map((node) => node.nodeId)).toEqual(['confession_free', 'confession_event']);
      // 类型按幕序派: order 0 → entry, order 1 → crisis.
      expect(state?.triggered[0]?.type).toBe('entry');
      expect(state?.triggered[1]?.type).toBe('crisis');
      // 名称按后缀派.
      expect(state?.triggered[0]?.label).toBe('自由开场');
      expect(state?.triggered[1]?.label).toBe('伦理事件');
      // 触发时刻 = 第一次把该幕放进 visited 的那一轮.
      expect(state?.triggered[0]?.triggeredAt).toBe('2026-11-05T10:00:00.000Z');
      expect(state?.triggered[1]?.triggeredAt).toBe('2026-11-05T10:05:00.000Z');
    });

    it('本场没有剧本 → null (前端据此不渲染轨迹面板)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({
        id: SESSION_ID,
        personaName: '晚晴',
        startedAt: new Date('2026-11-05T10:00:00Z'),
        endedAt: null,
        status: 'active',
        turnDebugTrace: [buildTrace()],
      });

      const state = await controller.sessionTrajectory({ adminBasicAuth: true } as never, SESSION_ID);

      expect(state).toBeNull();
    });

    it('会话不存在 → 404', async () => {
      const { controller } = buildController();

      await expect(controller.sessionTrajectory({ adminBasicAuth: true } as never, 'missing')).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });

    it('危机剧本的第 2 幕 (_signal 后缀) 也要能派类型与名称', () => {
      const state = buildAdminTrajectoryState([
        buildTrace({
          trajectoryTrace: {
            scriptId: CRISIS_SCRIPT_ID,
            mode: 'force_override',
            activated: true,
            activeNodeId: 'crisis_signal',
            advanced: true,
            cursor: 2,
            visitedNodeIds: ['crisis_free', 'crisis_signal'],
          },
        }),
      ]);

      expect(state?.triggered[0]?.type).toBe('entry');
      expect(state?.triggered[1]?.type).toBe('crisis');
      expect(state?.triggered[1]?.label).toBe('危机信号');
    });
  });

  describe('④ GET /admin/api/sessions/:id/memories — 本场记忆', () => {
    it('training_sessions 无 memories 列 → 返空数组 (不是 404)', async () => {
      const { controller, sessionRepo } = buildController();
      sessionRepo.rows.push({
        id: SESSION_ID,
        personaName: '晚晴',
        startedAt: new Date('2026-11-05T10:00:00Z'),
        endedAt: null,
        status: 'active',
        turnDebugTrace: [buildTrace()],
      });

      const rows = await controller.sessionMemories({ adminBasicAuth: true } as never, SESSION_ID);

      expect(rows).toEqual([]);
    });

    it('会话不存在 → 404', async () => {
      const { controller } = buildController();

      await expect(controller.sessionMemories({ adminBasicAuth: true } as never, 'missing')).rejects.toMatchObject({
        code: BizCode.ResourceNotFound,
      });
    });
  });

  describe('⑤ 4 个新端点全部继承 AdminRoleGuard', () => {
    it('controller 类级挂了 AdminRoleGuard (新增端点自动继承)', () => {
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, AdminDebugController) as unknown[] | undefined;

      expect(classGuards).toContain(AdminRoleGuard);
    });

    it('4 个新端点都在, 且都是 GET + 有效 guard 含 AdminRoleGuard', () => {
      const prototype = AdminDebugController.prototype;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, AdminDebugController) as unknown[] | undefined) ?? [];
      const routes: { readonly path: string; readonly method: number; readonly guards: unknown[] }[] = [];
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === 'constructor') continue;
        const handler = (prototype as unknown as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
        routes.push({
          path,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined,
          guards: [...classGuards, ...methodGuards],
        });
      }

      const paths = routes.map((route) => route.path);
      expect(paths).toContain('characters/:slug');
      expect(paths).toContain('characters/:slug/sessions');
      expect(paths).toContain('sessions/:id/trajectory');
      expect(paths).toContain('sessions/:id/memories');
      for (const route of routes) {
        expect(route.method).toBe(RequestMethod.GET);
        expect(route.guards).toContain(AdminRoleGuard);
      }
    });
  });
});

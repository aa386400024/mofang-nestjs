// V2026-11-06 治本 (WP38 补做 · 调试会话恢复 · 单测):
//   覆盖验收:
//     ① 每轮结束后, 持久化文件里有内核状态快照 (BDI + 记忆 + 轨迹块);
//     ② 有 POST /admin/api/debug/session/:id/resume 端点 (前端契约);
//     ③ 后端重启后调 resume 能恢复会话并继续发消息;
//     ④ 恢复后的 BDI 状态与最后一轮一致 (不是从头开始).
//
//   "后端重启"怎么模拟: **换一个服务实例 + 换一个空的内存状态仓储** ——
//     内存仓储就是"进程内的状态", 换个实例 = 状态全丢 (与真重启同构);
//     而**文件**留着 (同一个临时目录), 那是"重启之后还在的东西".
//
//   真文件 (临时目录, 用完即删) + 真内核 (InMemoryEngineSession + 内存状态仓储)
//   覆盖"状态一致性"; 引擎门面用极小替身 (不跑 LLM, 不发网络).
//
//   验证: npx vitest run test/admin-debug/wp38-debug-session-resume.spec.ts
//   时间戳: 2026-11-06 GMT+8

import { Logger, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDebugKernelState, DebugKernelStateRestorer } from '../../src/admin-debug/debug-kernel-state.js';
import { DebugSessionStore } from '../../src/admin-debug/debug-session-store.js';
import { DebugSessionController } from '../../src/admin-debug/debug-session.controller.js';
import { DebugSessionService } from '../../src/admin-debug/debug-session.service.js';
import { BizCode } from '../../src/common/exceptions/biz-code.enum.js';
import { BizException } from '../../src/common/exceptions/biz.exception.js';
import type { TurnRenderResult } from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import type { ResolvedCharacter } from '../../src/engine-adapters/wiring/character/character-profile.resolver.js';
import { InMemoryBdiStateRepository } from '../../src/engine-core/in-memory/in-memory-bdi-state.repository.js';
import { InMemoryEngineSession } from '../../src/engine-core/in-memory/in-memory-engine-session.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import { createEmptyBdiSnapshot, type BdiSnapshot } from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

/** 已知角色代号 (解析器只认它). */
const KNOWN_SLUG = 'vpt_intimate_avoidance_l1';

/** 调试会话的固定租户 (与生产常量同值). */
const TENANT_ID = 'debug';

/**
 * 造一份可控的 BDI 快照.
 *
 * @param overrides 要盖掉的字段
 * @returns BDI 快照
 */
function makeSnapshot(overrides: { readonly trust?: number } = {}): BdiSnapshot {
  const base = createEmptyBdiSnapshot();
  return { ...base, trust: overrides.trust ?? 0.5, safety: 0.4, bond: 0.1 };
}

/**
 * 造一份门面结算结果.
 *
 * @param snapshot 本轮 BDI 快照
 * @param turnIndex 内核轮次 (恢复后的会话里, 内核轮次从头算起)
 * @returns 门面结算结果
 */
function makeTurnResult(snapshot: BdiSnapshot, turnIndex: number, reply = '（回应）'): TurnRenderResult {
  return {
    reply,
    snapshot,
    turnIndex,
    render: {
      fallbackUsed: false,
      providerHint: 'minimax',
      usage: { completionTokens: 120, totalTokens: 300, promptTokens: 180, reasoningTokens: 60 },
      model: 'MiniMax-M3.1-Flash',
      spec: { taskKind: 'chat', promptPreview: '你是一个来访者…', maxCompletionTokens: 1500, reasoningEffort: 'medium' },
      finishReason: 'stop',
      ttftMs: 420,
      promptFull: '你是一个来访者……(完整 system prompt)',
    },
  };
}

/**
 * 引擎门面替身 (不跑内核, 只记录调用).
 */
class StubEngine {
  /** 预置的结算结果 (按调用顺序取). */
  readonly queue: TurnRenderResult[] = [];
  /** 开过的会话. */
  readonly opened: string[] = [];
  /** 发过的轮次. */
  readonly turns: { readonly handleId: string; readonly userText: string }[] = [];
  /** 还原过的渲染上下文. */
  readonly restored: { readonly handleId: string; readonly turns: readonly { role: string; text: string }[] }[] = [];

  open(input: { readonly sessionId: string }): { readonly handleId: string; readonly sessionId: string } {
    this.opened.push(input.sessionId);
    return { handleId: `handle-${input.sessionId}`, sessionId: input.sessionId };
  }

  async turnStream(handleId: string, input: { readonly userText: string }): Promise<TurnRenderResult> {
    this.turns.push({ handleId, userText: input.userText });
    const next = this.queue.shift();
    if (!next) throw new Error('测试未预置结算结果');
    return next;
  }

  restoreRenderContext(handleId: string, turns: readonly { role: string; text: string }[]): void {
    this.restored.push({ handleId, turns });
  }

  close(): void {
    /* noop */
  }
}

/**
 * 角色解析器替身.
 */
class StubResolver {
  async resolve(input: { readonly templateId: string }): Promise<ResolvedCharacter | null> {
    if (input.templateId !== KNOWN_SLUG) return null;
    return {
      characterProfile: { coreBeliefs: [], attachmentStyle: 'avoidant' },
      displayName: '亲密回避型 L1',
      seed: 42,
    } as unknown as ResolvedCharacter;
  }
}

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
 * 装一套调试服务 (真文件存储 + 真状态仓储 + 替身引擎).
 *
 * @param dir 会话文件目录
 * @param bdiStates BDI 状态仓储 (缺省 = 新的空仓储 = "进程刚起")
 * @returns 服务 + 引擎 + 状态仓储 + 记忆仓储
 */
function buildService(
  dir: string,
  bdiStates: InMemoryBdiStateRepository = new InMemoryBdiStateRepository(),
): {
  readonly service: DebugSessionService;
  readonly engine: StubEngine;
  readonly bdiStates: InMemoryBdiStateRepository;
  readonly memories: InMemoryMemoryStore;
} {
  const engine = new StubEngine();
  const memories = new InMemoryMemoryStore();
  const store = new DebugSessionStore(stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never);
  const restorer = new DebugKernelStateRestorer(bdiStates, memories);
  const service = new DebugSessionService(
    engine as never,
    new StubResolver(),
    { get: async () => null } as never,
    stubConfig({ ENGINE_DEBUG_CHAT_ENABLED: '1' }) as never,
    store,
    { generate: async () => '兜底标题' },
    restorer,
  );
  return { service, engine, bdiStates, memories };
}

/**
 * 轮询直到条件成立 (超时抛错).
 *
 * 为什么需要: 会话标题是**异步**生成的 (fire-and-forget) —— 那一轮跑完时,
 *   文件可能还在被后台任务改写. 清理临时目录前必须等它落定, 否则会撞上
 *   "删目录时文件又被写回来" (Windows 上表现为 ENOTEMPTY).
 *
 * @param condition 条件判定
 * @param timeoutMs 超时上限
 */
async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`waitFor 超时: 条件在 ${timeoutMs}ms 内没成立`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * 读会话文件里的内核状态快照 (读不到 → null).
 */
function readKernelState(raw: unknown): {
  readonly trust: number;
  readonly turnIndex: number;
  readonly revision: number;
  readonly memories: readonly { readonly role: string; readonly content: string }[];
  readonly trajectory: unknown;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const state = record['kernelState'];
  if (!state || typeof state !== 'object') return null;
  const inner = state as Record<string, unknown>;
  const snapshot = inner['snapshot'];
  const snapshotRaw = snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : {};
  const memories = inner['memories'];
  return {
    trust: Number(snapshotRaw['trust']),
    turnIndex: Number(inner['turnIndex']),
    revision: Number(inner['revision']),
    memories: Array.isArray(memories) ? (memories as readonly { role: string; content: string }[]) : [],
    trajectory: inner['trajectory'] ?? null,
  };
}

describe('WP38 补做 · 调试会话恢复', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'debug-resume-'));
  });

  afterEach(async () => {
    // maxRetries: Windows 上删目录可能撞上后台写文件的瞬间 (ENOTEMPTY).
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  // ── ① 每轮落盘内核状态快照 ────────────────────────────────────────
  describe('① 内核状态快照落盘', () => {
    it('跑完一轮 → 持久化文件里有内核状态快照 (BDI + 记忆 + 轨迹块)', async () => {
      const { service, engine } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);
      engine.queue.push(makeTurnResult(makeSnapshot({ trust: 0.83 }), 1));
      await service.runTurn(created.sessionId, '我理解你的感受。');

      const raw = JSON.parse(await readFile(join(dir, `${created.sessionId}.json`), 'utf8')) as unknown;
      const state = readKernelState(raw);

      expect(state).not.toBeNull();
      expect(state?.trust).toBeCloseTo(0.83, 5);
      expect(state?.turnIndex).toBe(1);
      expect(state?.revision).toBe(1);
      // 一轮两条记忆: 咨询师半边 + 来访者半边.
      expect(state?.memories).toHaveLength(2);
      expect(state?.memories[0]?.role).toBe('counselor');
      expect(state?.memories[1]?.role).toBe('visitor');
      // 调试会话不注入剧本 → 轨迹块恒为 null.
      expect(state?.trajectory).toBeNull();
    });

    it('还没跑过一轮的会话 → 快照为 null (恢复接口据此明确报错)', async () => {
      const { service } = buildService(dir);
      const created = await service.createSession(KNOWN_SLUG);

      const raw = JSON.parse(await readFile(join(dir, `${created.sessionId}.json`), 'utf8')) as unknown;

      expect(readKernelState(raw)).toBeNull();
    });
  });

  // ── ② 恢复接口 (前端契约) ─────────────────────────────────────────
  describe('② 恢复端点', () => {
    it('控制器暴露 POST session/:id/resume', () => {
      const pathOf = (method: string): string | undefined =>
        Reflect.getMetadata(PATH_METADATA, DebugSessionController.prototype[method as keyof DebugSessionController]);
      const methodOf = (method: string): number | undefined =>
        Reflect.getMetadata(METHOD_METADATA, DebugSessionController.prototype[method as keyof DebugSessionController]);

      expect(pathOf('resumeSession')).toBe('session/:id/resume');
      expect(methodOf('resumeSession')).toBe(RequestMethod.POST);
    });
  });

  // ── ③ 重启后恢复并继续发消息 ──────────────────────────────────────
  describe('③ 重启后恢复', () => {
    it('重启后调 resume → 会话活过来, 能接着发消息 (轮次接着往下数)', async () => {
      // 第一个进程: 跑两轮.
      const first = buildService(dir);
      const created = await first.service.createSession(KNOWN_SLUG);
      first.engine.queue.push(makeTurnResult(makeSnapshot({ trust: 0.7 }), 1));
      await first.service.runTurn(created.sessionId, '第一轮');
      first.engine.queue.push(makeTurnResult(makeSnapshot({ trust: 0.8 }), 2));
      await first.service.runTurn(created.sessionId, '第二轮');

      // 重启: 新服务实例 + 新的空状态仓储 (文件留着).
      const second = buildService(dir);
      const resumed = await second.service.resumeSession(created.sessionId);

      expect(resumed.resumed).toBe(true);
      expect(resumed.alreadyActive).toBe(false);
      expect(resumed.sessionId).toBe(created.sessionId);
      expect(resumed.restored.snapshot).toBe(true);
      expect(resumed.restored.memories).toBe(4);
      expect(resumed.restored.contextTurns).toBe(4);

      // 恢复后能继续发消息, 且轮次**接着往下数** (不是从头开始).
      //
      // ⚠️ V2026-11-08 (并行 flake 诊断): 标题生成在 service 里是 `void` fire-and-forget,
      //   失败**只 warn 不抛** —— "写失败"与"还没写完"在测试侧**长得一模一样**.
      //   这里先装上告警捕获 (必须在触发标题生成**之前**装), 超时时把现场带出来.
      //   **只带字段名 / 状态值 / 错误名, 绝不打印对话正文或 prompt** (心理内容红线).
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      try {
        second.engine.queue.push(makeTurnResult(makeSnapshot({ trust: 0.9 }), 1));
        const turn = await second.service.runTurn(created.sessionId, '第三轮');

        expect(turn.reply).toBe('（回应）');
        expect(turn.trace.turnIndex).toBe(3);
        // 渲染上下文还原了 (上一轮说过的话还在).
        expect(second.engine.restored[0]?.turns).toHaveLength(4);
        expect(second.engine.restored[0]?.turns[0]?.text).toBe('第一轮');

        // 这一轮把轮次推到 3 → 触发**异步**标题生成; 等它落定 (否则清理临时目录会撞上后台写文件).
        //
        // ⚠️ 等待上限 **30s** (只改这一处, `waitFor` 的默认值留给其它调用点):
        //   这里等的是**异步副作用落盘**, 不是业务逻辑 —— 142 个 worker 并行时
        //   文件写 + rename 会被拖慢, 10s 偶发不够 (单跑该文件必绿, 并行才偶发红).
        await waitFor(async () => {
          const raw = JSON.parse(await readFile(join(dir, `${created.sessionId}.json`), 'utf8')) as { readonly title?: string };
          return raw.title === '兜底标题';
        }, 30_000);
      } catch (error) {
        // 只给"等待超时"补现场; 断言失败原样抛 (别把真失败盖成诊断信息).
        const isTimeout = error instanceof Error && error.message.includes('waitFor 超时');
        if (!isTimeout) throw error;
        const file = join(dir, `${created.sessionId}.json`);
        const fileExists = existsSync(file);
        let title: string | undefined;
        let titleSource: string | undefined;
        if (fileExists) {
          const raw = JSON.parse(await readFile(file, 'utf8')) as { readonly title?: string; readonly titleSource?: string };
          title = raw.title;
          titleSource = raw.titleSource;
        }
        const warnTexts = warnSpy.mock.calls.map((call) => String(call[0]));
        throw new Error(
          [
            'waitFor 超时: 异步标题未落定',
            `session=${created.sessionId}`,
            `fileExists=${String(fileExists)}`,
            `title=${title ?? '(无)'}`,
            `titleSource=${titleSource ?? '(无)'}`,
            `warns=${warnTexts.length > 0 ? warnTexts.join(' | ') : '(无)'}`,
            `cause=${error instanceof Error ? error.message : String(error)}`,
          ].join(' '),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('恢复后该会话在列表里变成 active=true 且 resumable=true', async () => {
      const first = buildService(dir);
      const created = await first.service.createSession(KNOWN_SLUG);
      first.engine.queue.push(makeTurnResult(makeSnapshot(), 1));
      await first.service.runTurn(created.sessionId, '第一轮');

      const second = buildService(dir);
      await second.service.resumeSession(created.sessionId);
      const listed = await second.service.listPersistedSessions();

      expect(listed[0]?.active).toBe(true);
      expect(listed[0]?.resumable).toBe(true);
    });

    it('重复调 resume → 幂等 (不重复开内核句柄)', async () => {
      const first = buildService(dir);
      const created = await first.service.createSession(KNOWN_SLUG);
      first.engine.queue.push(makeTurnResult(makeSnapshot(), 1));
      await first.service.runTurn(created.sessionId, '第一轮');

      const second = buildService(dir);
      await second.service.resumeSession(created.sessionId);
      const again = await second.service.resumeSession(created.sessionId);

      expect(again.resumed).toBe(false);
      expect(again.alreadyActive).toBe(true);
      expect(second.engine.opened).toHaveLength(1);
    });
  });

  // ── ④ 失败要如实报错 ──────────────────────────────────────────────
  describe('④ 恢复失败如实报错', () => {
    it('没有内核快照 → 明确报错 (不静默建一场中性新会话)', async () => {
      const first = buildService(dir);
      const created = await first.service.createSession(KNOWN_SLUG);

      const second = buildService(dir);
      const error = await second.service.resumeSession(created.sessionId).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BizException);
      expect((error as BizException).code).toBe(BizCode.InvalidParameter);
    });

    it('会话不存在 → 404', async () => {
      const { service } = buildService(dir);
      const error = await service.resumeSession('debug_不存在').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BizException);
      expect((error as BizException).code).toBe(BizCode.ResourceNotFound);
    });
  });

  // ── ⑤ BDI 状态与最后一轮一致 (真内核) ─────────────────────────────
  describe('⑤ BDI 状态与最后一轮一致', () => {
    it('回灌后的内核句柄, 第一轮就在恢复出来的状态上继续 (不是中性基线)', async () => {
      // 基线: 全新会话跑同一句话 (没恢复过) 的结果.
      const baselineKernel = new InMemoryEngineSession({
        bdiStates: new InMemoryBdiStateRepository(),
        memories: new InMemoryMemoryStore(),
      });
      const baselineHandle = baselineKernel.openSession({ sessionId: 'debug_baseline', tenantId: TENANT_ID, visitorId: 'debug-admin' });
      const baseline = await baselineKernel.turn(baselineHandle.handleId, { userText: '我理解你的感受。' });

      // 造一份"跑了很多轮之后"的有辨识度快照.
      const distinctive = { ...baseline.snapshot, trust: 0.83 };

      // 重启: 新的空仓储 + 回灌.
      const restoredRepo = new InMemoryBdiStateRepository();
      const restorer = new DebugKernelStateRestorer(restoredRepo, new InMemoryMemoryStore());
      const kernelState = buildDebugKernelState({
        snapshot: distinctive,
        revision: 1,
        turnIndex: 1,
        updatedAt: Date.now(),
        memories: [],
      });

      expect(await restorer.restoreBdiState(TENANT_ID, 'debug_kernel', kernelState)).toBe('restored');
      const record = await restoredRepo.load(TENANT_ID, 'debug_kernel');
      expect(record?.snapshot.trust).toBeCloseTo(0.83, 5);

      // 新内核句柄 (同一个 sessionId) → 第一轮就接着恢复出来的状态走.
      const restoredKernel = new InMemoryEngineSession({
        bdiStates: restoredRepo,
        memories: new InMemoryMemoryStore(),
      });
      const restoredHandle = restoredKernel.openSession({ sessionId: 'debug_kernel', tenantId: TENANT_ID, visitorId: 'debug-admin' });
      const after = await restoredKernel.turn(restoredHandle.handleId, { userText: '我理解你的感受。' });

      // 恢复出来的状态 + 与基线**同一个**增量 = 恢复后的第一轮结果.
      //   (增量来自同一句话的事件算子, 与起点无关 —— 这正是"接着走"的含义.)
      const delta = baseline.snapshot.trust - createEmptyBdiSnapshot().trust;
      expect(after.snapshot.trust).toBeCloseTo(distinctive.trust + delta, 2);
      // 关键: 结果**不是**中性基线的结果 (否则就是"从头开始"了).
      expect(after.snapshot.trust).not.toBeCloseTo(baseline.snapshot.trust, 3);
    });

    it('仓储里已有更新的状态 → 不覆盖 (活着的真相优先)', async () => {
      const repo = new InMemoryBdiStateRepository();
      const restorer = new DebugKernelStateRestorer(repo, new InMemoryMemoryStore());
      const kernelState = buildDebugKernelState({
        snapshot: makeSnapshot({ trust: 0.83 }),
        revision: 1,
        turnIndex: 1,
        updatedAt: Date.now(),
        memories: [],
      });

      expect(await restorer.restoreBdiState(TENANT_ID, 'debug_x', kernelState)).toBe('restored');
      // 第二次: 仓储里的版本不低于文件 → 原样保留.
      expect(await restorer.restoreBdiState(TENANT_ID, 'debug_x', kernelState)).toBe('kept');
      const record = await repo.load(TENANT_ID, 'debug_x');
      expect(record?.snapshot.trust).toBeCloseTo(0.83, 5);
    });
  });
});

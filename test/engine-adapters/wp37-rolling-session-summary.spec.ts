// V2026-11-03 WP37 (B 层 · 会话级滚动摘要):
//   目的: 钉死"工作窗口溢出 → 滚动摘要 → 进 prompt"这条完整链路 ——
//     ① 攒批: 攒够 N 轮才调一次 LLM (没攒够不调);
//     ② 滚动: 第二版摘要带上第一版 (不丢早期内容);
//     ③ 落库: 写成 SHORT_TERM / SUMMARY 记忆条目 (契约早就预留好的那两个口子);
//     ④ 失败降级: LLM 挂了不阻断对话, 本批留待下次;
//     ⑤ 会话隔离: 两个租户撞同一个 sessionId 不串摘要;
//     ⑥ 配置装配: 3 个 env 键逐个字面量读, 非法值回退种子值;
//     ⑦ prompt 接线: 有摘要才进 prompt, 没有摘要时 prompt 逐字不变.
//
//   为什么"没有摘要时 prompt 逐字不变"是硬断言:
//     摘要是**增强** —— 没产生摘要的会话 (绝大多数) 必须与 WP5 逐字一致,
//     否则这条 WP 就变成了"悄悄改了所有会话的 prompt".
//
//   全 mock, 不起 NestJS, 不发网络:
//     摘要生成器用 stub; 记忆仓储用内核内存实现; 时钟与 id 工厂注入假值.
//
//   V2026-11-04 WP61 (B 层 · 纪要层次化):
//     纪要从"一段流水文字"改成三层结构 (核心议题 / 关键事件 / 情绪转折点).
//     新增 describe ⑨ 覆盖: 三段解析 / 围栏 / 退化口径 / 旧单段格式接住 /
//     三段全空留待下次 / 对外仍是一段字符串 / 空段落渲染「（无）」/
//     记忆存渲染后的文本 / 上一版逐段传 / 提示词里的上一版是三段 / 护栏没丢.
//     既有断言从"摘要是一段字符串"改成"摘要= 渲染后的三行文本" (端口签名未变).
//
//   验证: npx vitest run test/engine-adapters/wp37-rolling-session-summary.spec.ts

import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { vi } from 'vitest';

import {
  DEFAULT_ROLLING_SUMMARY_BATCH_SIZE,
  DEFAULT_ROLLING_SUMMARY_IMPORTANCE,
  RollingSessionSummaryService,
} from '../../src/engine-adapters/persistence/rolling-session-summary.service.js';
import {
  formatRollingSummaryForPrompt,
  formatRollingSummaryInput,
  parseRollingSummaryResponse,
  type RollingSummaryInput,
  type RollingSummaryResult,
} from '../../src/engine-adapters/persistence/rolling-summary.generator.js';
import { buildRenderSpec } from '../../src/engine-adapters/rendering/spec-assembler.js';
import type { StreamingRenderPort } from '../../src/engine-adapters/rendering/streaming-render.port.js';
import {
  TurnRenderOrchestrator,
  buildVisitorMessages,
  type TurnSessionContext,
} from '../../src/engine-adapters/rendering/turn-render-orchestrator.js';
import { resolveSessionSummaryConfig } from '../../src/engine-adapters/wiring/session-summary.config.js';
import { InMemoryMemoryStore } from '../../src/engine-core/in-memory/in-memory-memory.store.js';
import {
  MemorySource,
  MemoryTier,
  createEmptyBdiSnapshot,
  type EngineSessionHandle,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type MemoryStore,
  type RenderResult,
  type RenderTokenBudget,
  type WorkingWindowOverflowEvent,
} from '../../src/engine-core/index.js';

const TENANT = 'tenant-1';
const VISITOR = 'visitor-1';
const SESSION = 'session-1';
const HANDLE_ID = 'handle-1';
const CLOCK = 1_700_000_000_000;
const BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };
const CONTEXT: TurnSessionContext = { tenantId: TENANT, visitorId: VISITOR, sessionId: SESSION };

/** 造一个 ConfigService 桩 (只实现 get). */
function configStub(env: Readonly<Record<string, string>>): ConfigService {
  return {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
}

/**
 * 造一个只填核心议题的纪要 (其余两段为空).
 *
 * 为什么多数用例只填一段: 这批用例关心的是**链路** (攒批 / 滚动 / 落库 / 降级),
 * 不是三段内容本身 —— 三段各自的渲染与解析由 WP61 的用例单独钉.
 */
function summaryOf(coreTopics: string): RollingSummaryResult {
  return { coreTopics, keyEvents: '', emotionalTurningPoints: '' };
}

/** 摘要生成器 stub: 记录入参, 返回固定纪要 (或抛错). */
function generatorStub(options: { readonly summary?: RollingSummaryResult; readonly fail?: boolean }): {
  readonly generate: (input: RollingSummaryInput) => Promise<RollingSummaryResult>;
  readonly calls: RollingSummaryInput[];
} {
  const calls: RollingSummaryInput[] = [];
  return {
    calls,
    generate: async (input) => {
      calls.push(input);
      if (options.fail) throw new Error('llm down');
      return options.summary ?? summaryOf('摘要');
    },
  };
}

/** 造一次溢出事件. */
function overflowEvent(pushedOut: readonly string[], overrides: Partial<WorkingWindowOverflowEvent> = {}): WorkingWindowOverflowEvent {
  return {
    tenantId: TENANT,
    sessionId: SESSION,
    visitorId: VISITOR,
    pushedOut,
    ...overrides,
  };
}

/**
 * 走完一轮"门面上报 + 内核淘汰" (WP55 之后的一轮完整时序).
 *
 * WP37 时这一步只有内核的溢出事件 (咨询师一侧); WP55 起门面还会上报一次轮次记录.
 * 这里把两步合在一起, 让用例只关心"哪一轮被淘汰了", 不关心两条流谁先谁后.
 */
function reportAndEvict(
  service: RollingSessionSummaryService,
  counselor: string,
  options: {
    readonly visitor?: string | null;
    readonly tenantId?: string;
    readonly sessionId?: string;
  } = {},
): void {
  const tenantId = options.tenantId ?? TENANT;
  const sessionId = options.sessionId ?? SESSION;
  const visitor = options.visitor === undefined ? `来访:${counselor}` : options.visitor;
  service.recordRound(tenantId, sessionId, VISITOR, counselor, visitor);
  service.recordOverflow(overflowEvent([counselor], { tenantId, sessionId }));
}

describe('WP37 · 会话级滚动摘要 (适配层)', () => {
  describe('① 攒批: 攒够 N 轮才调 LLM', () => {
    it('不足阈值 → 不调 LLM, 不产生摘要', async () => {
      const generator = generatorStub({ summary: summaryOf('不该出现') });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
      });

      reportAndEvict(service, '第1轮');
      reportAndEvict(service, '第2轮');
      await Promise.resolve();

      expect(generator.calls).toHaveLength(0);
      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
    });

    it('达到阈值 → 调一次 LLM, 产出摘要', async () => {
      const generator = generatorStub({ summary: summaryOf('聊了失眠与工作压力') });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
      });

      reportAndEvict(service, '第1轮');
      reportAndEvict(service, '第2轮');
      reportAndEvict(service, '第3轮');

      await vi.waitFor(() =>
        expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('聊了失眠与工作压力'))),
      );
      expect(generator.calls).toHaveLength(1);
      expect(generator.calls[0]?.rounds.map((round) => round.counselor)).toEqual(['第1轮', '第2轮', '第3轮']);
    });

    it('攒批阈值可配 (batchSize=1 → 第一轮就压)', async () => {
      const generator = generatorStub({ summary: summaryOf('立刻压') });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');

      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('立刻压'))));
    });
  });

  describe('② 滚动: 每一版都覆盖全部已聊内容', () => {
    it('第二版摘要带上第一版 (previousSummary)', async () => {
      const generator = generatorStub({ summary: summaryOf('摘要v2') });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('摘要v2'))));

      reportAndEvict(service, '第2轮');
      await vi.waitFor(() => expect(generator.calls).toHaveLength(2));

      expect(generator.calls[1]?.previousSummary).toEqual(summaryOf('摘要v2'));
      expect(generator.calls[1]?.rounds.map((round) => round.counselor)).toEqual(['第2轮']);
    });
  });

  describe('③ 落库: SHORT_TERM / SUMMARY 记忆条目', () => {
    it('摘要写成短时记忆条目 (契约预留的层级 + 来源)', async () => {
      const memories = new InMemoryMemoryStore();
      const generator = generatorStub({ summary: summaryOf('聊了失眠与工作压力') });
      const service = new RollingSessionSummaryService({
        memories,
        generator,
        batchSize: 1,
        importance: 0.5,
        now: () => CLOCK,
        makeId: () => 'fixed-id',
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() =>
        expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('聊了失眠与工作压力'))),
      );

      const hits = await memories.recall({ tenantId: TENANT, sessionId: SESSION, query: '' });
      expect(hits).toHaveLength(1);
      const entry = hits[0]?.entry;
      expect(entry?.tier).toBe(MemoryTier.SHORT_TERM);
      expect(entry?.source).toBe(MemorySource.SUMMARY);
      expect(entry?.content).toBe(formatRollingSummaryForPrompt(summaryOf('聊了失眠与工作压力')));
      expect(entry?.importance).toBe(0.5);
      expect(entry?.tenantId).toBe(TENANT);
      expect(entry?.sessionId).toBe(SESSION);
      expect(entry?.ttlMs).toBeNull();
    });

    it('不写长时记忆 (那是 WP12 收尾的活, 本服务只管会话中段)', async () => {
      const memories = new InMemoryMemoryStore();
      const service = new RollingSessionSummaryService({
        memories,
        generator: generatorStub({ summary: summaryOf('摘要') }),
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('摘要'))));

      const hits = await memories.recall({ tenantId: TENANT, sessionId: SESSION, query: '' });
      expect(hits.every((hit) => hit.entry.tier === MemoryTier.SHORT_TERM)).toBe(true);
    });
  });

  describe('④ 失败降级: 摘要挂了不阻断对话', () => {
    it('LLM 抛错 → 不产生摘要, 不抛错 (对话继续)', async () => {
      const generator = generatorStub({ fail: true });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      expect(() => reportAndEvict(service, '第1轮')).not.toThrow();
      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));

      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
    });

    it('LLM 抛错 → 本批留待下次 (内容不丢)', async () => {
      const generator = generatorStub({ fail: true });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));

      // 再来一轮 → 失败的那批仍在队列里, 一起再压一次.
      reportAndEvict(service, '第2轮');
      await vi.waitFor(() => expect(generator.calls).toHaveLength(2));
      expect(generator.calls[1]?.rounds.map((round) => round.counselor)).toEqual(['第1轮', '第2轮']);
    });

    it('没装配生成器 → 只攒不压, 不产生摘要, 不抛错', async () => {
      const service = new RollingSessionSummaryService({ memories: new InMemoryMemoryStore() });

      expect(() => reportAndEvict(service, '第1轮')).not.toThrow();
      await Promise.resolve();

      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
    });

    it('记忆写入失败 → 摘要仍然缓存 (本场对话还能用它保持话题连续)', async () => {
      const memories = new InMemoryMemoryStore();
      const failing: MemoryStore = {
        remember: async () => {
          throw new Error('store down');
        },
        recall: async () => [],
      };
      const service = new RollingSessionSummaryService({
        memories: failing,
        generator: generatorStub({ summary: summaryOf('摘要仍然可用') }),
        batchSize: 1,
      });
      void memories;

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('摘要仍然可用'))));
    });
  });

  describe('⑤ 会话隔离', () => {
    it('两个租户撞同一个 sessionId → 不串摘要', async () => {
      const generator = generatorStub({ summary: summaryOf('摘要') });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      reportAndEvict(service, 'A租户的轮次', { tenantId: 'tenant-A', sessionId: 'same-id' });
      await vi.waitFor(() => expect(service.latestSummary('tenant-A', 'same-id')).toBe(formatRollingSummaryForPrompt(summaryOf('摘要'))));

      expect(service.latestSummary('tenant-B', 'same-id')).toBeUndefined();
    });

    it('forgetSession → 状态清掉 (会话结束不留残)', async () => {
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator: generatorStub({ summary: summaryOf('摘要') }),
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('摘要'))));

      service.forgetSession(TENANT, SESSION);
      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
      expect(service.trackedSessionCount()).toBe(0);
    });
  });

  describe('⑥ 配置装配 (env → 服务构造入参)', () => {
    it('没配 env → 回退种子值', () => {
      const config = resolveSessionSummaryConfig(configStub({}));

      expect(config.rollingBatchSize).toBe(DEFAULT_ROLLING_SUMMARY_BATCH_SIZE);
      expect(config.rollingImportance).toBe(DEFAULT_ROLLING_SUMMARY_IMPORTANCE);
      expect(config.finalImportance).toBe(0.9);
    });

    it('配了 → 真的按 env 生效', () => {
      const config = resolveSessionSummaryConfig(
        configStub({
          SESSION_SUMMARY_BATCH_SIZE: '5',
          SESSION_SUMMARY_ROLLING_IMPORTANCE: '0.6',
          SESSION_SUMMARY_FINAL_IMPORTANCE: '0.8',
        }),
      );

      expect(config.rollingBatchSize).toBe(5);
      expect(config.rollingImportance).toBe(0.6);
      expect(config.finalImportance).toBe(0.8);
    });

    it('非法值 → 回退种子值, 不抛错', () => {
      const config = resolveSessionSummaryConfig(
        configStub({
          SESSION_SUMMARY_BATCH_SIZE: '0',
          SESSION_SUMMARY_ROLLING_IMPORTANCE: '2',
          SESSION_SUMMARY_FINAL_IMPORTANCE: '不是数字',
        }),
      );

      expect(config.rollingBatchSize).toBe(DEFAULT_ROLLING_SUMMARY_BATCH_SIZE);
      expect(config.rollingImportance).toBe(DEFAULT_ROLLING_SUMMARY_IMPORTANCE);
      expect(config.finalImportance).toBe(0.9);
    });
  });

  describe('⑦ prompt 接线', () => {
    it('有滚动摘要 → 进 system prompt', async () => {
      const generator = generatorStub({ summary: summaryOf('此前聊了失眠与工作压力') });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });
      reportAndEvict(service, '第1轮');
      await vi.waitFor(() =>
        expect(service.latestSummary(TENANT, SESSION)).toBe(formatRollingSummaryForPrompt(summaryOf('此前聊了失眠与工作压力'))),
      );

      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [{ role: 'counselor', text: '你最近睡得怎么样？' }],
        tokenBudget: BUDGET,
        sessionSummary: service.latestSummary(TENANT, SESSION),
      });
      const messages = buildVisitorMessages(spec);
      const system = messages[0]?.content ?? '';

      expect(system).toContain('此前聊了失眠与工作压力');
    });

    it('没有滚动摘要 → prompt 逐字不变 (零回归)', () => {
      const spec = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [{ role: 'counselor', text: '你最近睡得怎么样？' }],
        tokenBudget: BUDGET,
      });
      const baseline = buildRenderSpec({
        output: buildOutput(),
        recentTurns: [{ role: 'counselor', text: '你最近睡得怎么样？' }],
        tokenBudget: BUDGET,
      });

      expect(spec.sessionSummary).toBeUndefined();
      expect(buildVisitorMessages(spec)).toEqual(buildVisitorMessages(baseline));
    });

    it('门面: 装配了滚动摘要口 → 摘要进本轮渲染规格', async () => {
      const orchestrator = buildOrchestrator({ summary: '此前聊了失眠' });

      const result = await orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });

      expect(result.reply).toBe('来访回复');
      const spec = orchestrator.lastSpec();
      expect(spec?.sessionSummary).toBe('此前聊了失眠');
    });

    it('门面: 没装配滚动摘要口 → 规格里没有这个字段', async () => {
      const orchestrator = buildOrchestrator({});

      await orchestrator.turn(HANDLE_ID, { userText: '你最近睡得怎么样？' });

      expect(orchestrator.lastSpec()?.sessionSummary).toBeUndefined();
    });
  });

  describe('⑧ 摘要提示词输入格式', () => {
    it('显式标注角色 (咨询师: / 来访者:) + 带上上一版摘要', () => {
      const text = formatRollingSummaryInput({
        previousSummary: summaryOf('摘要v1'),
        rounds: [
          { counselor: '第一句', visitor: '第一答' },
          { counselor: '第二句', visitor: '第二答' },
        ],
      });

      expect(text).toContain('[上一版摘要]');
      expect(text).toContain('摘要v1');
      expect(text).toContain('咨询师: 第一句');
      expect(text).toContain('来访者: 第一答');
      expect(text).toContain('咨询师: 第二句');
      expect(text).toContain('来访者: 第二答');
    });

    it('没有上一版摘要 → 不带那一段', () => {
      const text = formatRollingSummaryInput({ rounds: [{ counselor: '第一句', visitor: '第一答' }] });

      expect(text).not.toContain('[上一版摘要]');
      expect(text).toContain('咨询师: 第一句');
    });
  });

  // WP61 (2026-11-04) · 纪要层次化 (核心议题 / 关键事件 / 情绪转折点):
  //   摘要从"一段流水文字"改成三层结构. 覆盖: 三段解析 / 退化口径 / 对外仍是字符串 /
  //   记忆存渲染后的文本 / 上一版逐段传 / 提示词里的上一版是三段.
  describe('⑨ WP61 · 纪要层次化 (核心议题 / 关键事件 / 情绪转折点)', () => {
    const FULL_SUMMARY: RollingSummaryResult = {
      coreTopics: '失眠与工作压力',
      keyEvents: '提到凌晨三点才睡',
      emotionalTurningPoints: '从回避转向表达',
    };

    it('模型回三段 JSON → 解析成结构化对象 (三段都有)', () => {
      const parsed = parseRollingSummaryResponse(
        '{"coreTopics": "失眠与工作压力", "keyEvents": "提到凌晨三点才睡", "emotionalTurningPoints": "从回避转向表达"}',
      );

      expect(parsed).toEqual(FULL_SUMMARY);
    });

    it('带代码块围栏 → 照样解析 (模型很爱加围栏)', () => {
      const parsed = parseRollingSummaryResponse(
        '```json\n{"coreTopics": "失眠", "keyEvents": "加班", "emotionalTurningPoints": "愿意说了"}\n```',
      );

      expect(parsed).toEqual({ coreTopics: '失眠', keyEvents: '加班', emotionalTurningPoints: '愿意说了' });
    });

    it('模型不按 JSON 回 → 整段当核心议题 (退化口径与 WP12 同款)', () => {
      const parsed = parseRollingSummaryResponse('来访者最近总是凌晨三点才睡');

      expect(parsed).toEqual({ coreTopics: '来访者最近总是凌晨三点才睡', keyEvents: '', emotionalTurningPoints: '' });
    });

    it('模型回旧单段格式 → 接住那一段 (不是三段全空)', () => {
      const parsed = parseRollingSummaryResponse('{"summary": "聊了失眠"}');

      expect(parsed).toEqual({ coreTopics: '聊了失眠', keyEvents: '', emotionalTurningPoints: '' });
    });

    it('三段全空 → 本批留待下次 (不产生空纪要, 不覆盖上一版)', async () => {
      const generator = generatorStub({ summary: { coreTopics: '', keyEvents: '', emotionalTurningPoints: '' } });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));

      expect(service.latestSummary(TENANT, SESSION)).toBeUndefined();
      // 本批没丢: 下一批连着一起压.
      reportAndEvict(service, '第2轮');
      await vi.waitFor(() => expect(generator.calls).toHaveLength(2));
      expect(generator.calls[1]?.rounds.map((round) => round.counselor)).toEqual(['第1轮', '第2轮']);
    });

    it('对外仍是**一段字符串** (端口签名不变) → 渲染成三行', async () => {
      const generator = generatorStub({ summary: FULL_SUMMARY });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBeDefined());

      expect(service.latestSummary(TENANT, SESSION)).toBe(
        '核心议题：失眠与工作压力\n关键事件：提到凌晨三点才睡\n情绪转折点：从回避转向表达',
      );
    });

    it('空段落渲染成「（无）」 (不是空白行, 也不是省略)', () => {
      const text = formatRollingSummaryForPrompt(summaryOf('只有核心议题'));

      expect(text).toBe('核心议题：只有核心议题\n关键事件：（无）\n情绪转折点：（无）');
    });

    it('记忆条目存的是渲染后的三行文本 (不是 JSON)', async () => {
      const memories = new InMemoryMemoryStore();
      const service = new RollingSessionSummaryService({
        memories,
        generator: generatorStub({ summary: FULL_SUMMARY }),
        batchSize: 1,
        now: () => CLOCK,
        makeId: () => 'fixed-id',
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(service.latestSummary(TENANT, SESSION)).toBeDefined());

      const hits = await memories.recall({ tenantId: TENANT, sessionId: SESSION, query: '' });
      expect(hits[0]?.entry.content).toBe('核心议题：失眠与工作压力\n关键事件：提到凌晨三点才睡\n情绪转折点：从回避转向表达');
    });

    it('上一版纪要**逐段**传给生成器 (合并是逐段合并)', async () => {
      const generator = generatorStub({ summary: FULL_SUMMARY });
      const service = new RollingSessionSummaryService({
        memories: new InMemoryMemoryStore(),
        generator,
        batchSize: 1,
      });

      reportAndEvict(service, '第1轮');
      await vi.waitFor(() => expect(generator.calls).toHaveLength(1));

      reportAndEvict(service, '第2轮');
      await vi.waitFor(() => expect(generator.calls).toHaveLength(2));

      // 结构化对象, 不是一坨文字 —— 模型才能"核心议题并进核心议题".
      expect(generator.calls[1]?.previousSummary).toEqual(FULL_SUMMARY);
    });

    it('提示词里的上一版纪要是**三段结构** (模型才能逐段并)', () => {
      const text = formatRollingSummaryInput({
        previousSummary: FULL_SUMMARY,
        rounds: [{ counselor: '第一句', visitor: '第一答' }],
      });

      expect(text).toContain('[上一版摘要]');
      expect(text).toContain('核心议题：失眠与工作压力');
      expect(text).toContain('关键事件：提到凌晨三点才睡');
      expect(text).toContain('情绪转折点：从回避转向表达');
    });

    it('提示词要求三段输出 + 保留"不要做临床诊断"护栏', () => {
      const prompt = readFileSync(path.join(process.cwd(), 'src/engine-adapters/persistence/rolling-summary.generator.ts'), 'utf8');

      expect(prompt).toContain('"coreTopics"');
      expect(prompt).toContain('"keyEvents"');
      expect(prompt).toContain('"emotionalTurningPoints"');
      // 护栏不能因为改成三段就丢掉.
      expect(prompt).toContain('不要做临床诊断');
    });
  });
});

/** 构造内核一轮出参. */
function buildOutput(overrides: Partial<EngineTurnOutput> = {}): EngineTurnOutput {
  return {
    reply: '',
    snapshot: createEmptyBdiSnapshot(),
    turnIndex: 1,
    ...overrides,
  };
}

/** 会话端口 stub: 固定出参. */
class StubSession implements EngineSessionPort {
  openSession(input: { sessionId: string }): EngineSessionHandle {
    return { handleId: HANDLE_ID, sessionId: input.sessionId };
  }

  async turn(_handleId: string, _input: EngineTurnInput): Promise<EngineTurnOutput> {
    return buildOutput();
  }

  closeSession(): void {
    /* 门面不调它; 占位以满足端口契约. */
  }
}

/** 渲染端口 stub: 记录规格, 返回固定文本 (形状与内核 RenderResult 一致). */
class StubRenderer {
  readonly specs: { sessionSummary?: string }[] = [];

  async render(spec: { sessionSummary?: string }): Promise<RenderResult> {
    this.specs.push(spec);
    return {
      text: '来访回复',
      taskKind: 'chat',
      usage: { completionTokens: 20, totalTokens: 40 },
      fallbackUsed: false,
    };
  }
}

/** 记忆仓储 stub. */
class StubMemoryStore implements MemoryStore {
  async remember(): Promise<void> {
    /* 占位. */
  }

  async recall(): Promise<never[]> {
    return [];
  }
}

/**
 * 构造门面 (全注入, 无全局状态).
 *
 * `summary` 缺省 = 不装滚动摘要口 (装配缺席时行为与 WP7 逐字一致).
 */
function buildOrchestrator(options: { readonly summary?: string }): TurnRenderOrchestrator & {
  lastSpec: () => { sessionSummary?: string } | undefined;
} {
  const renderer = new StubRenderer();
  const orchestrator = new TurnRenderOrchestrator({
    session: new StubSession(),
    renderer,
    memories: new StubMemoryStore(),
    resolveSession: () => CONTEXT,
    now: () => CLOCK,
    idFactory: () => 'memory-visitor-1',
    ...(options.summary === undefined
      ? {}
      : {
          rollingSummary: {
            latestSummary: () => options.summary,
            recordRound: () => {
              /* 桩: 门面只上报, 不关心. */
            },
          },
        }),
  });
  return Object.assign(orchestrator, {
    lastSpec: () => renderer.specs.at(-1),
  });
}

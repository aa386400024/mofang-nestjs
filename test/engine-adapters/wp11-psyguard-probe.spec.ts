// V2026-10-30 治本 (WP11 · B 层 · PsyGUARD HTTP 风险探测器单测):
//   覆盖任务单 §3 的验收面:
//     ① HTTP probe 四种场景: 成功 / 超时 / 503 / 脏形状;
//     ② 装配开关: 没配 PSYGUARD_BASE_URL → 行为与现状逐字一致 (本地规则兜底);
//     ③ 降级语义: 服务挂掉 → 内核静默回落规则, **绝不阻断对话**;
//     ④ 启动健康检查: 不可达 / 模型未加载 / 标签口径漂移 —— 全部只记 warn.
//
//   全 mock, 不起 NestJS 容器, 不发网络, 不连 Python 服务.
//
//   为什么"内核回落"这条要用**真内核**测而不是 mock 掉内核:
//     降级语义是内核 `assessSafety` 的既有契约 (WP4 交付), 本轮只是多了一个会失败
//     的探测实现. 用真内核跑一遍, 才知道"HTTP 探针抛错"这条新路径确实被兜住了.
//
//   验证: npx jest test/engine-adapters/wp11-psyguard-probe.spec.ts
//   时间戳: 2026-10-30 GMT+8

import { assessSafety, DEFAULT_PROBE_TIMEOUT_MS, PSYGUARD_LEVEL_MAP } from '../../src/engine-core';
import type { RiskProbePort } from '../../src/engine-core';
import { createRiskProbe, createVisitorOutputProbe } from '../../src/engine-adapters/wiring/engine.providers';
import {
  HttpPsyGuardProbe,
  normalizePsyGuardResponse,
  resolvePsyGuardTimeoutMs,
  type PsyGuardFetch,
} from '../../src/engine-adapters/wiring/risk/http-psyguard.probe';
import { LocalCrisisProbe, detectCrisisCategories, normalizeWidth } from '../../src/engine-adapters/wiring/risk/local-crisis.probe';
import { PsyGuardHealthChecker } from '../../src/engine-adapters/wiring/risk/psyguard-health.checker';
import { buildEngineRenderDeps } from '../../src/engine-adapters/wiring/render-config.factory';
import type { ChatCaller } from '../../src/engine-adapters/rendering/llm-render.adapter';
import {
  DEFAULT_RENDER_COOLDOWN_BASE_MS,
  DEFAULT_RENDER_COOLDOWN_MAX_MS,
  DEFAULT_RENDER_FAILURE_THRESHOLD,
  DEFAULT_RENDER_TIMEOUT_MS,
  type RenderAdapterConfig,
} from '../../src/engine-adapters/rendering/render-adapter.config';
import { AIProviderId } from '../../src/llm/common/enums/llm.enums';

/** 假响应的构造入参. */
interface FakeResponseInit {
  readonly ok?: boolean;
  readonly status?: number;
  readonly body?: unknown;
  readonly throwJson?: boolean;
}

/**
 * 造一个假 fetch (记录调用, 可指定返回/抛错).
 *
 * @param init 响应配置
 * @returns 假 fetch + 调用记录
 */
function fakeFetch(init: FakeResponseInit): { readonly impl: PsyGuardFetch; readonly calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const impl: PsyGuardFetch = async (url, requestInit) => {
    calls.push({ url, body: requestInit.body });
    if (init.throwJson) {
      return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      };
    }
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => init.body,
    };
  };
  return { impl, calls };
}

/**
 * 造一个"连接失败/超时"的假 fetch.
 *
 * @param message 错误消息
 * @returns 假 fetch
 */
function failingFetch(message: string): PsyGuardFetch {
  return async () => {
    throw new Error(message);
  };
}

describe('WP11 · PsyGUARD HTTP 风险探测器 (内核 RiskProbePort 实现)', () => {
  describe('① 成功路径', () => {
    it('服务返回 high + 自杀类别 → 内核等级 block', async () => {
      const { impl, calls } = fakeFetch({ body: { level: 'high', categories: ['suicide_plan'], score: 0.93 } });
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      const result = await probe.probe('我想跳楼', 'visitor_output');

      expect(result.level).toBe('block');
      expect(result.categories).toEqual(['suicide_plan']);
      expect(result.score).toBeCloseTo(0.93, 5);
      // 请求打到了正确的端点, 载荷就是 { text }
      expect(calls[0]?.url).toBe('http://127.0.0.1:8100/v1/classify');
      expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ text: '我想跳楼' });
    });

    it('wire 等级 → 内核等级是一一对应 (low/medium/high → pass/warn/block)', () => {
      expect(normalizePsyGuardResponse({ level: 'low', categories: [] })?.level).toBe('pass');
      expect(normalizePsyGuardResponse({ level: 'medium', categories: [] })?.level).toBe('warn');
      expect(normalizePsyGuardResponse({ level: 'high', categories: [] })?.level).toBe('block');
    });

    it('未知类别名被丢弃, 已知类别保留 (服务比内核新时不整条作废)', () => {
      const normalized = normalizePsyGuardResponse({ level: 'medium', categories: ['suicide_plan', 'brand_new_2027'], score: 0.6 });

      expect(normalized?.categories).toEqual(['suicide_plan']);
      expect(normalized?.level).toBe('warn');
    });

    it("'neutral' 不算风险类别, 不进类别清单", () => {
      const normalized = normalizePsyGuardResponse({ level: 'low', categories: ['neutral'] });

      expect(normalized?.categories).toEqual([]);
    });

    it('score 越界/非数字 → 省略 (内核只拿它做展示, 不做阈值)', () => {
      expect(normalizePsyGuardResponse({ level: 'low', categories: [], score: 1.8 })?.score).toBeUndefined();
      expect(normalizePsyGuardResponse({ level: 'low', categories: [], score: 'high' })?.score).toBeUndefined();
    });

    it('空文本不发请求 (探空是纯浪费, 还会淹没"服务挂掉"的日志)', async () => {
      const { impl, calls } = fakeFetch({ body: { level: 'low', categories: [] } });
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      const result = await probe.probe('   ', 'visitor_output');

      expect(result.level).toBe('pass');
      expect(result.categories).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('② 失败路径 (抛错, 由内核兜住回落规则)', () => {
    it('连接失败/超时 → 抛错', async () => {
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: failingFetch('connect ECONNREFUSED') });

      await expect(probe.probe('我想跳楼', 'visitor_output')).rejects.toThrow();
    });

    it('HTTP 503 (模型未加载) → 抛错', async () => {
      const { impl } = fakeFetch({ ok: false, status: 503, body: { detail: '模型未就绪' } });
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      await expect(probe.probe('我想跳楼', 'visitor_output')).rejects.toThrow(/503/);
    });

    it('非 JSON 响应 → 抛错', async () => {
      const { impl } = fakeFetch({ throwJson: true });
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      await expect(probe.probe('我想跳楼', 'visitor_output')).rejects.toThrow(/JSON/);
    });

    it('脏形状 (level 缺失/非法) → 抛错', async () => {
      for (const body of [{ categories: ['suicide_plan'] }, { level: 'critical', categories: [] }, { level: 3, categories: [] }, null, 'ok']) {
        const { impl } = fakeFetch({ body });
        const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });
        await expect(probe.probe('我想跳楼', 'visitor_output')).rejects.toThrow();
      }
    });
  });

  describe('③ 与内核编排串起来 (降级语义)', () => {
    it('探针命中 → 内核判定为 block, 来源 probe', async () => {
      const { impl } = fakeFetch({ body: { level: 'high', categories: ['suicide_plan'], score: 0.9 } });
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      const verdict = await assessSafety({ text: '我想跳楼', side: 'visitor_output', probe });

      expect(verdict.level).toBe('block');
      expect(verdict.categories).toContain('suicide_plan');
      expect(verdict.source).toBe('probe');
    });

    it('服务挂掉 → 内核静默回落规则, **不抛穿** (安全层不是门禁)', async () => {
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: failingFetch('ECONNREFUSED') });

      const verdict = await assessSafety({ text: '我想跳楼', side: 'visitor_output', probe });

      // 规则层对"我想跳楼"判 pass (内核来访侧词典没收这句) → 回落后仍是 pass, 但**没抛**.
      expect(verdict.level).toBe('pass');
      expect(verdict.source).toBe('rule');
    });

    it('探针说 low 但类别是 suicide_plan → 内核取 max 判 block (防御纵深)', async () => {
      const { impl } = fakeFetch({ body: { level: 'low', categories: ['suicide_plan'], score: 0.4 } });
      const probe = new HttpPsyGuardProbe({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      const verdict = await assessSafety({ text: '随便一句', side: 'visitor_output', probe });

      expect(verdict.level).toBe('block');
    });
  });

  describe('④ 装配开关 (配没配服务地址)', () => {
    it('没配地址 → 用本地规则探测器 (行为与现状逐字一致)', () => {
      const probe = createRiskProbe({});

      expect(probe).toBeInstanceOf(LocalCrisisProbe);
    });

    it('配了地址 → 用 HTTP 探测器', () => {
      const probe = createRiskProbe({ baseUrl: 'http://127.0.0.1:8100' });

      expect(probe).toBeInstanceOf(HttpPsyGuardProbe);
    });

    it('地址是空白 → 仍走本地规则 (空白 ≠ 配了)', () => {
      const probe = createRiskProbe({ baseUrl: '   ' });

      expect(probe).toBeInstanceOf(LocalCrisisProbe);
    });

    it('两者不叠加: 配了地址也不会同时挂两个探测器', () => {
      const probe = createRiskProbe({ baseUrl: 'http://127.0.0.1:8100', fallback: new LocalCrisisProbe() });

      expect(probe).not.toBeInstanceOf(LocalCrisisProbe);
    });

    it('超时 env 是字符串 → 显式解析; 非法值回退内核默认值', () => {
      expect(resolvePsyGuardTimeoutMs('300')).toBe(300);
      expect(resolvePsyGuardTimeoutMs('abc')).toBe(DEFAULT_PROBE_TIMEOUT_MS);
      expect(resolvePsyGuardTimeoutMs('0')).toBe(DEFAULT_PROBE_TIMEOUT_MS);
      expect(resolvePsyGuardTimeoutMs(undefined)).toBe(DEFAULT_PROBE_TIMEOUT_MS);
    });
  });

  describe('④-b 来访输出侧接线 (审核后决策 #3)', () => {
    /**
     * 最小渲染配置 (只给一个候选) —— 形状与 wp8-wiring.spec.ts 的 stubRenderConfig 一致.
     *
     * 为什么在这里造一份: `buildEngineRenderDeps` 要一个 `RenderAdapterConfig`,
     * 而这个配置有 8 个必填字段. 复用别处的 stub 会把两个套件耦合起来, 那边一改这里就红.
     */
    function stubRenderConfig(): RenderAdapterConfig {
      return {
        candidates: [{ id: AIProviderId.DEEPSEEK }],
        taskDefaults: {
          chat: { temperature: 0.85 },
          stable: { temperature: 0.2 },
          advanced: { temperature: 0.85 },
        },
        timeoutMs: DEFAULT_RENDER_TIMEOUT_MS,
        failureThreshold: DEFAULT_RENDER_FAILURE_THRESHOLD,
        cooldownBaseMs: DEFAULT_RENDER_COOLDOWN_BASE_MS,
        cooldownMaxMs: DEFAULT_RENDER_COOLDOWN_MAX_MS,
        maxBlockRegen: 1,
        fallbackUtterances: ['……我先缓一下，我们接着说。'],
      };
    }

    /** 不会真被调用的调用出口 (deps 只存不调). */
    const stubCaller = {
      chat: async (): Promise<never> => {
        throw new Error('stub caller 不该被调用');
      },
    } as unknown as ChatCaller;

    it('没配服务地址 → 输出侧不接探测 (维持现状: 只有内核规则层)', () => {
      expect(createVisitorOutputProbe({})).toBeUndefined();
    });

    it('地址是空白 → 输出侧同样不接探测', () => {
      expect(createVisitorOutputProbe({ baseUrl: '   ' })).toBeUndefined();
    });

    it('配了服务地址 → 输出侧接 HTTP 探测器', () => {
      const probe = createVisitorOutputProbe({ baseUrl: 'http://127.0.0.1:8100' });

      expect(probe).toBeInstanceOf(HttpPsyGuardProbe);
    });

    it('输出侧**绝不**接本地词典探测器 (否则 AI 角色的危机台词会被判 block → 场景被换掉)', () => {
      const probe = createVisitorOutputProbe({ baseUrl: 'http://127.0.0.1:8100' });

      // LocalCrisisProbe 的补充词表含 "我想死" / "死了算了" (类别映射到 high → block),
      // 而内核来访侧词典没收这些词 —— 接上去等于 AI 角色说一句"我想死"就被拦下重生成.
      expect(probe).not.toBeInstanceOf(LocalCrisisProbe);
    });

    it('装配出的 guard 真的把渲染文本喂给了探测器 (side=visitor_output)', async () => {
      const seen: { text: string; side: string }[] = [];
      const probe: RiskProbePort = {
        probe: async (text, side) => {
          seen.push({ text, side });
          return { level: 'warn', categories: ['passive_ideation'] };
        },
      };
      const deps = buildEngineRenderDeps(stubCaller, stubRenderConfig(), probe);
      const guard = deps.guard;
      if (!guard) throw new Error('guard 未装配');

      const verdict = await guard('我最近压力很大');

      expect(seen).toHaveLength(1);
      expect(seen[0]?.text).toBe('我最近压力很大');
      expect(seen[0]?.side).toBe('visitor_output');
      // 探测器命中 → 输出侧等级被抬高 (内核最终等级取 max).
      expect(verdict.level).toBe('warn');
      expect(verdict.categories).toContain('passive_ideation');
    });

    it('不传探测器 → guard 不做任何探测 (行为与现状逐字一致)', async () => {
      const deps = buildEngineRenderDeps(stubCaller, stubRenderConfig());
      const guard = deps.guard;
      if (!guard) throw new Error('guard 未装配');

      const verdict = await guard('我最近压力很大');

      expect(verdict.level).toBe('pass');
      expect(verdict.categories).toEqual([]);
    });

    it('探测器抛错 → guard 静默回落规则, 不炸穿渲染', async () => {
      const probe: RiskProbePort = {
        probe: async () => {
          throw new Error('psyguard down');
        },
      };
      const deps = buildEngineRenderDeps(stubCaller, stubRenderConfig(), probe);
      const guard = deps.guard;
      if (!guard) throw new Error('guard 未装配');

      const verdict = await guard('我最近压力很大');

      expect(verdict.level).toBe('pass');
    });
  });

  describe('⑤ 启动健康检查 (失败只记 warn, 不阻断启动)', () => {
    /** 按内核口径构造一份"一致"的标签清单. */
    function kernelAlignedLabels(): { name: string; level: string }[] {
      return Object.entries(PSYGUARD_LEVEL_MAP).map(([name, level]) => ({
        name,
        level: level === 'block' ? 'high' : level === 'warn' ? 'medium' : 'low',
      }));
    }

    it('服务可达 + 模型已加载 + 口径一致 → 三项都真', async () => {
      const { impl } = fakeFetch({
        body: { status: 'ok', model_loaded: true, device: 'cpu', labels: kernelAlignedLabels() },
      });
      const checker = new PsyGuardHealthChecker({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      const result = await checker.check();

      expect(result).toEqual({ reachable: true, modelLoaded: true, contractOk: true });
    });

    it('服务不可达 → reachable=false, **不抛**', async () => {
      const checker = new PsyGuardHealthChecker({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: failingFetch('ECONNREFUSED') });

      const result = await checker.check();

      expect(result.reachable).toBe(false);
      expect(result.modelLoaded).toBe(false);
    });

    it('模型未加载 → reachable=true 但 modelLoaded=false', async () => {
      const { impl } = fakeFetch({ body: { status: 'degraded', model_loaded: false, labels: kernelAlignedLabels() } });
      const checker = new PsyGuardHealthChecker({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      const result = await checker.check();

      expect(result.reachable).toBe(true);
      expect(result.modelLoaded).toBe(false);
    });

    it('标签口径漂移 → contractOk=false (跨仓库漂移的探针)', async () => {
      const labels = kernelAlignedLabels();
      labels[0] = { name: labels[0]?.name ?? '', level: 'low' };
      const { impl } = fakeFetch({ body: { status: 'ok', model_loaded: true, labels } });
      const checker = new PsyGuardHealthChecker({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: impl });

      const result = await checker.check();

      expect(result.contractOk).toBe(false);
    });

    it('启动钩子不 await (不拖慢启动), 也不因异常炸掉', () => {
      const checker = new PsyGuardHealthChecker({ baseUrl: 'http://127.0.0.1:8100', fetchImpl: failingFetch('ECONNREFUSED') });

      expect(() => checker.onApplicationBootstrap()).not.toThrow();
    });
  });

  describe('⑥ WP4 遗留: 本地规则词典补全 (全半角归一 + 常见变体)', () => {
    it('全角 ASCII 与表意空格归一后能命中 (含英文危机表达)', () => {
      expect(normalizeWidth('ＡＢＣ１２３')).toBe('ABC123');
      expect(normalizeWidth('ｋｉｌｌ　ｍｙｓｅｌｆ')).toBe('kill myself');
      // 中文标点不受归一影响 (词典是 includes 匹配, 不受影响).
      expect(normalizeWidth('我活着没意思。')).toBe('我活着没意思。');
    });

    it('全角写法的英文危机表达能命中 active_ideation', () => {
      expect(detectCrisisCategories('ｋｉｌｌ　ｍｙｓｅｌｆ')).toEqual(['active_ideation']);
      expect(detectCrisisCategories('kill myself')).toEqual(['active_ideation']);
    });

    it('倾诉型变体命中 (撑不下去了 / 熬不下去了)', () => {
      expect(detectCrisisCategories('我真的撑不下去了')).toEqual(['passive_ideation']);
      expect(detectCrisisCategories('熬不下去了')).toEqual(['passive_ideation']);
    });

    it('主动意图变体命中 (我想死)', () => {
      expect(detectCrisisCategories('有时候真想知道死了会怎样，我想死')).toContain('active_ideation');
    });

    it('普通咨询对话仍不误报 (宁少勿滥)', () => {
      expect(detectCrisisCategories('最近压力有点大，睡眠不太好')).toEqual([]);
    });

    it("'活着没意思' 由内核词典覆盖, 不需要补充词表重复抄", () => {
      expect(detectCrisisCategories('活着没意思')).toEqual(['passive_ideation']);
    });
  });
});

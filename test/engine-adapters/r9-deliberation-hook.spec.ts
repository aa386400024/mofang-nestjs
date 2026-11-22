// V2026-11-08 治本 (R9 · 适配层 · 生效钩子):
//   目的: 钉死"两拍分离 + 四层兜底"这条生效路径的**全部可见行为** ——
//     ① 两拍分离: 第 N 轮**异步**产出建议 → 第 N+1 轮**同步**读缓存; 同一份建议只用一次;
//     ② 过期判定: 产出拍与消费拍的版本号对不上 → 建议作废 (回退规则 delta);
//     ③ TTL: 建议过期 (超过存活期) → 当作没有建议;
//     ④ 模式三态: shadow / rule_only 下**一次 LLM 都不发** (runner 根本不被调用);
//        llm_active 下名单内生效 / 名单外不跑;
//     ⑤ 四层兜底: 跑审议失败 (runner 抛错 / 返回 null) → 主流程不炸, 建议为空;
//     ⑥ 稀疏补丁转换: 非法维度 / 非有限数被丢掉, 同维度取最后一条;
//     ⑦ 临床可疑维度被剔除 (只剔 warn 级, 且只剔那一维).
//
//   为什么"runner 根本不被调用"要单独钉:
//     名单外的会话如果还去跑审议, 就是"白烧 LLM" —— 灰度期最贵的浪费.
//     断言"runner 调用次数 = 0"比断言"结果没生效"强: 后者可能是"跑了但被丢弃",
//     钱已经花了.
//
//   反依赖污染: 不起 Nest 容器, 不发任何请求; runner 用假实现.
//
//   验证: npx vitest run test/engine-adapters/r9-deliberation-hook.spec.ts

import { vi } from 'vitest';
import { buildTestStructuredInput } from './deliberation-fixtures.js';
import type { DeliberationModeConfig } from '../../src/engine-adapters/deliberation/deliberation-mode.config.js';
import type { DeliberationDeltaEntry } from '../../src/engine-adapters/deliberation/deliberation-types.js';
import {
  LlmDeliberationHook,
  toDeliberationDeltaPatch,
  type DeliberationProduceInput,
  type DeliberationRunner,
} from '../../src/engine-adapters/deliberation/llm-deliberation-hook.js';
import { dropClinicalFlaggedDimensions } from '../../src/engine-adapters/deliberation/llm-deliberation.service.js';
import { createEmptyBdiSnapshot, type DeliberationHookContext, type DeltaVector } from '../../src/engine-core/index.js';

// TD-10 · T-2: 真实 ioredis 不进 import 阶段 (适配层仍是真实现; 替身口径见 test/helpers/sdk-stubs.ts).
vi.mock('ioredis', async () => {
  const { createIoredisStub } = await import('../helpers/sdk-stubs.js');
  return createIoredisStub();
});

const TENANT = 'tenant-r9';
const SESSION = 'session-r9';

/** 11 维零向量. */
function zeroDelta(): DeltaVector {
  return {
    trust: 0,
    safety: 0,
    bond: 0,
    valence: 0,
    arousal: 0,
    verbal: 0,
    depth: 0,
    style: 0,
    positive: 0,
    negative: 0,
    dependency: 0,
  };
}

/** 装配一份模式配置 (缺省 = 影子). */
function modeConfig(overrides: Partial<DeliberationModeConfig> = {}): DeliberationModeConfig {
  return {
    effectiveMode: 'shadow',
    grayscaleSessions: new Set<string>(),
    timeoutMs: 3000,
    scenarioRoutes: { freeform: 'rule_only', full_simulation: 'rule_only', exam: 'rule_only' },
    ...overrides,
  };
}

/** 造一份消费拍的上下文. */
function makeContext(overrides: Partial<DeliberationHookContext> = {}): DeliberationHookContext {
  return {
    snapshot: createEmptyBdiSnapshot(),
    ruleDelta: zeroDelta(),
    counselorText: '嗯，我明白了。',
    tenantId: TENANT,
    sessionId: SESSION,
    turnIndex: 1,
    currentRevision: 7,
    ...overrides,
  };
}

/** 造一份产出拍的入参. */
function makeProduceInput(context: Partial<DeliberationHookContext> = {}): DeliberationProduceInput {
  return {
    context: makeContext(context),
    extras: {
      // WP-A: 结构化输入 (零对话原文) —— 走真实的装配函数.
      structured: buildTestStructuredInput({
        counselorText: '嗯，我明白了。',
        visitorText: '嗯……',
        characterBrief: '依恋型, 低外向',
        ruleStrategy: 'simple_response',
      }),
      userId: 'user-r9',
    },
  };
}

/** 记调用次数的假 runner. */
function fakeRunner(patch: { trust: number } | null): { runner: DeliberationRunner; calls: () => number } {
  let calls = 0;
  return {
    runner: {
      run: async (): Promise<{ trust: number } | null> => {
        calls += 1;
        return patch;
      },
    },
    calls: (): number => calls,
  };
}

describe('R9 · 生效钩子 (适配层)', () => {
  it('① 两拍分离: 产出拍写缓存, 消费拍同步读出; 同一份建议只用一次', async () => {
    const { runner } = fakeRunner({ trust: 0.1 });
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), runner);

    // 第 N 轮: 产出拍 (异步跑审议).
    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    // 第 N+1 轮: 消费拍 (内核同步问) → 拿到建议.
    const patch = hook.applyDeliberation(makeContext({ currentRevision: 7, turnIndex: 2 }));
    expect(patch).toEqual({ trust: 0.1 });
    // 建议取出即用掉 —— 再问一次就是"没有建议".
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7, turnIndex: 3 }))).toBeNull();
  });

  it('② 过期判定: 版本号对不上 → 建议作废, 回退规则 delta', async () => {
    const { runner } = fakeRunner({ trust: 0.1 });
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), runner);

    // 产出拍记下基准版本 7.
    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    // 消费拍内核报的是 8 (状态在两拍之间被动过) → 过期.
    expect(hook.applyDeliberation(makeContext({ currentRevision: 8, turnIndex: 2 }))).toBeNull();
  });

  it('② 版本号一致 → 建议照常生效', async () => {
    const { runner } = fakeRunner({ trust: 0.1 });
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), runner);

    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7, turnIndex: 2 }))).toEqual({ trust: 0.1 });
  });

  it('③ TTL: 建议超过存活期 → 当作没有建议', async () => {
    const { runner } = fakeRunner({ trust: 0.1 });
    let now = 1_000_000;
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), runner, () => now);

    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    // 还没过期.
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toEqual({ trust: 0.1 });

    // 再产出一份, 把时钟推过存活期 (2 分钟).
    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    now += 120_001;
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toBeNull();
  });

  it('④ 模式三态: shadow / rule_only 下**一次 LLM 都不发**', async () => {
    for (const effectiveMode of ['shadow', 'rule_only'] as const) {
      const { runner, calls } = fakeRunner({ trust: 0.1 });
      const hook = new LlmDeliberationHook(modeConfig({ effectiveMode }), runner);

      await hook.produce(makeProduceInput({ currentRevision: 7 }));
      expect(calls()).toBe(0);
      expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toBeNull();
    }
  });

  it('④ llm_active + 名单为空 → 全量生效', async () => {
    const { runner, calls } = fakeRunner({ trust: 0.1 });
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), runner);

    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    expect(calls()).toBe(1);
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toEqual({ trust: 0.1 });
  });

  it('④ llm_active + 名单非空 → 名单内生效, 名单外**不跑** (省 LLM)', async () => {
    const { runner, calls } = fakeRunner({ trust: 0.1 });
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active', grayscaleSessions: new Set([SESSION]) }), runner);

    // 名单外: 产出拍根本不跑.
    await hook.produce(makeProduceInput({ sessionId: 'other-session', currentRevision: 7 }));
    expect(calls()).toBe(0);
    expect(hook.applyDeliberation(makeContext({ sessionId: 'other-session', currentRevision: 7 }))).toBeNull();

    // 名单内: 跑, 且生效.
    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    expect(calls()).toBe(1);
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toEqual({ trust: 0.1 });
  });

  it('⑧ 场景红线 (G-1): 考核场景 → **一次 LLM 都不发** (哪怕在名单内 + 全局 llm_active)', async () => {
    const { runner, calls } = fakeRunner({ trust: 0.1 });
    // 唯一能让普通场次生效的配置: 全局 llm_active + 会话在白名单里.
    const hook = new LlmDeliberationHook(
      modeConfig({ effectiveMode: 'llm_active', grayscaleSessions: new Set([SESSION]) }),
      runner,
      Date.now,
      { resolveScenario: (sessionId: string) => (sessionId === SESSION ? 'exam' : 'full_simulation') },
    );

    // 产出拍被场景红线拦住 → runner 一次都没被调用 (钱没花).
    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    expect(calls()).toBe(0);
    // 消费拍同样被拦住 → 回退规则 delta.
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toBeNull();
  });

  it('⑧ 场景反查查不到 → 回落 full_simulation (不施加场景红线, 行为与接入前一致)', async () => {
    const { runner, calls } = fakeRunner({ trust: 0.1 });
    // 解析器一律返回 undefined (会话没登记场景).
    const hook = new LlmDeliberationHook(
      modeConfig({ effectiveMode: 'llm_active', grayscaleSessions: new Set([SESSION]) }),
      runner,
      Date.now,
      { resolveScenario: () => void 0 },
    );

    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    expect(calls()).toBe(1);
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toEqual({ trust: 0.1 });
  });

  it('⑧ 场景反查逐场生效: 只有被标成考核的那场被拦住', async () => {
    const { runner, calls } = fakeRunner({ trust: 0.1 });
    const hook = new LlmDeliberationHook(
      modeConfig({ effectiveMode: 'llm_active', grayscaleSessions: new Set(['exam-session', 'normal-session']) }),
      runner,
      Date.now,
      { resolveScenario: (sessionId: string) => (sessionId === 'exam-session' ? 'exam' : 'full_simulation') },
    );

    await hook.produce(makeProduceInput({ sessionId: 'exam-session', currentRevision: 7 }));
    expect(calls()).toBe(0);

    await hook.produce(makeProduceInput({ sessionId: 'normal-session', currentRevision: 7 }));
    expect(calls()).toBe(1);
  });

  it('⑤ 兜底①: runner 抛错 → 产出拍吞掉, 主流程不炸, 建议为空', async () => {
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), {
      run: async () => {
        throw new Error('LLM 超时');
      },
    });

    await expect(hook.produce(makeProduceInput({ currentRevision: 7 }))).resolves.toBeUndefined();
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toBeNull();
  });

  it('⑤ 兜底②: runner 返回 null (格式非法 / 超时被上游折掉) → 建议为空', async () => {
    const { runner } = fakeRunner(null);
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), runner);

    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toBeNull();
  });

  it('⑤ 兜底②: runner 返回空补丁 → 不占缓存位 (下一轮直接当"没有建议")', async () => {
    const hook = new LlmDeliberationHook(modeConfig({ effectiveMode: 'llm_active' }), {
      run: async () => ({}),
    });

    await hook.produce(makeProduceInput({ currentRevision: 7 }));
    expect(hook.applyDeliberation(makeContext({ currentRevision: 7 }))).toBeNull();
  });

  it('⑤ 兜底④: 临床可疑维度被剔除, 其余维度照常生效', () => {
    const deltas: DeliberationDeltaEntry[] = [
      { dimension: 'trust', delta: 0.2, operatorTags: ['empathy'], reason: '理由' },
      { dimension: 'safety', delta: 0.1, operatorTags: ['empathy'], reason: '理由' },
    ];
    const flags = [
      {
        rule: 'alliance_positive_spike' as const,
        dimension: 'trust' as const,
        value: 0.2,
        threshold: 0.15,
        severity: 'warn' as const,
      },
    ];

    const kept = dropClinicalFlaggedDimensions(deltas, flags);
    expect(kept.map((entry) => entry.dimension)).toEqual(['safety']);
    // 没有可疑维度时**原样返回** (不多做一遍过滤).
    expect(dropClinicalFlaggedDimensions(deltas, [])).toBe(deltas);
  });

  it('⑤ 兜底④: info 级标记**不剔** (只是"值得看一眼", 不是可疑)', () => {
    const deltas: DeliberationDeltaEntry[] = [{ dimension: 'verbal', delta: 0.12, operatorTags: ['implicit_resistance'], reason: '理由' }];
    const flags = [
      {
        rule: 'resistance_triple_jump' as const,
        dimension: 'verbal' as const,
        value: 0.12,
        threshold: 0.1,
        severity: 'info' as const,
      },
    ];

    expect(dropClinicalFlaggedDimensions(deltas, flags)).toHaveLength(1);
  });

  it('⑥ 稀疏补丁转换: 非法维度 / 非有限数被丢掉, 同维度取最后一条', () => {
    const patch = toDeliberationDeltaPatch([
      { dimension: 'trust', delta: 0.1 },
      { dimension: '不是维度', delta: 0.2 },
      { dimension: 'safety', delta: Number.NaN },
      { dimension: 'trust', delta: 0.3 },
    ]);

    expect(patch).toEqual({ trust: 0.3 });
  });

  it('⑥ 稀疏补丁转换: 空列表 → 空补丁', () => {
    expect(toDeliberationDeltaPatch([])).toEqual({});
  });
});

// V2026-10-28 治本 (WP6 · B 层 · RenderPort LLM 适配 + 主备执行单测):
//   覆盖任务单 §8 单测清单 1-11:
//     1. 主成功        → fallbackUsed=false / providerHint=主id / usage 正确映射
//     2. 主失败切备    → fallbackUsed=true / providerHint=备id
//     3. 失败计数进冷却 → 达阈值后跳过主选备; 假时钟未推进仍跳过
//     4. 冷却到期恢复  → 假时钟推进过 cooldownUntil 后主重新被优先选中
//     5. 全部耗尽降级  → 兜底话术 / fallbackUsed=true / providerHint='degraded' / 不 reject
//     6. block 重生成  → 首返 block 重生成 pass 返回重生成文本; 两次都 block 返回兜底不传原文
//     7. warn 放行     → 文本原样放行且有信号记录
//     8. 空内容切备    → 主返回空串切备
//     9. 鉴权失败不循环 → 401 直接降级, 不对后续候选逐个尝试
//    10. taskKind 参数注入 → stable 低温 / chat 高温 / 候选 overrides 优先
//    11. 零回归        → 内核公开出口不含任何适配层符号 (内核未被污染)
//
//   全 mock, 不起 NestJS, 不发网络:
//     调用出口用 StubChatCaller (脚本化返回/抛错/挂起);
//     输出校验用 StubGuard (脚本化 verdict); 主备冷却用假时钟推进, 不等真实时间.
//
//   验证: npx jest test/engine-adapters/wp6-llm-render.spec.ts
//   时间戳: 2026-10-28 GMT+8

import * as kernel from '../../src/engine-core';
import type { RenderContextTurn, RenderSpec, RenderTaskKind } from '../../src/engine-core';
import {
  LlmRenderAdapter,
  type ChatCaller,
  type RenderGuardVerdict,
} from '../../src/engine-adapters/rendering/llm-render.adapter';
import {
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderAdapterConfigOverrides,
  type RenderCandidate,
} from '../../src/engine-adapters/rendering/render-adapter.config';
import { RenderFailoverRuntime } from '../../src/engine-adapters/rendering/render-failover.runtime';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../../src/llm/common/interfaces/chat-provider.interface';

/** 兜底话术 (与测试配置一致). */
const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';

/** 高危文本 (block 用). */
const UNSAFE_TEXT = '我要去死。';

/** 安全文本 (放行用). */
const SAFE_TEXT = '我在呢，慢慢说。';

/** 脚本化的一次调用结果. */
type ChatOutcome =
  | { readonly ok: true; readonly content: string; readonly completionTokens?: number; readonly totalTokens?: number }
  | { readonly ok: false; readonly error: Error }
  | { readonly hang: true };

/** ChatCaller stub: 按脚本顺序返回; 脚本用尽后重复最后一条. */
class StubChatCaller implements ChatCaller {
  readonly calls: { readonly request: ChatCompletionRequest; readonly providerId?: string }[] = [];
  private index = 0;

  constructor(private readonly script: readonly ChatOutcome[]) {}

  async chat(request: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse> {
    this.calls.push({ request, providerId });
    const outcome = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (!outcome) throw new Error('stub 脚本为空');
    if ('hang' in outcome) return new Promise<ChatCompletionResponse>(() => undefined);
    if (!outcome.ok) throw outcome.error;
    return {
      content: outcome.content,
      usage: {
        promptTokens: 10,
        completionTokens: outcome.completionTokens ?? 20,
        totalTokens: outcome.totalTokens ?? 30,
      },
      model: 'stub-model',
      finishReason: 'stop',
    };
  }
}

/** guard stub: 按调用顺序返回 verdict; 用尽后重复最后一条. */
class StubGuard {
  readonly calls: string[] = [];

  constructor(private readonly verdicts: readonly RenderGuardVerdict[]) {}

  readonly guard = async (text: string): Promise<RenderGuardVerdict> => {
    this.calls.push(text);
    return this.verdicts[Math.min(this.calls.length - 1, this.verdicts.length - 1)];
  };
}

/** 假时钟: 手动推进, 不等真实时间. */
class FakeClock {
  constructor(private current: number) {}

  readonly now = (): number => this.current;

  advance(ms: number): void {
    this.current += ms;
  }
}

/** 构造一份渲染规格 (WP7 负责真实组装, 这里只给消费路径所需字段). */
function buildSpec(taskKind: RenderTaskKind, overrides: Partial<RenderSpec> = {}): RenderSpec {
  return {
    taskKind,
    intention: {
      strategy: 'recounting',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: ['judge'],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.3,
    coreBeliefs: [],
    forbiddenBehaviors: ['judge'],
    recall: [],
    recentTurns: [{ role: 'counselor', text: '最近睡得怎么样？' }],
    tokenBudget: { maxCompletionTokens: 160, contextTokens: 512 },
    ...overrides,
  };
}

/** 构造对话轮. */
function turn(role: RenderContextTurn['role'], text: string): RenderContextTurn {
  return { role, text };
}

/** 构造测试用配置 (全部走工厂, 与生产同一条构造路径). */
function buildConfig(candidates: readonly RenderCandidate[], overrides: RenderAdapterConfigOverrides = {}): RenderAdapterConfig {
  return createRenderAdapterConfig(candidates, {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model' },
      advanced: { temperature: 0.85, model: 'advanced-model' },
    },
    timeoutMs: 100,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    maxBlockRegen: 1,
    fallbackUtterance: FALLBACK_UTTERANCE,
    ...overrides,
  });
}

describe('WP6 · RenderPort LLM 适配 + 主备执行', () => {
  describe('① 主成功', () => {
    it('主一次返回 → 不切备 / providerHint=主id / usage 正确映射', async () => {
      const caller = new StubChatCaller([{ ok: true, content: SAFE_TEXT, completionTokens: 33, totalTokens: 77 }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(SAFE_TEXT);
      expect(result.taskKind).toBe('chat');
      expect(result.fallbackUsed).toBe(false);
      expect(result.providerHint).toBe('primary');
      expect(result.usage).toEqual({ completionTokens: 33, totalTokens: 77 });
      expect(caller.calls).toHaveLength(1);
      expect(caller.calls[0].providerId).toBe('primary');
    });
  });

  describe('② 主失败切备', () => {
    it('主 reject → 备成功 → fallbackUsed=true / providerHint=备id', async () => {
      const caller = new StubChatCaller([{ ok: false, error: new Error('ECONNRESET') }, { ok: true, content: SAFE_TEXT }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }, { id: 'backup' }]),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(SAFE_TEXT);
      expect(result.fallbackUsed).toBe(true);
      expect(result.providerHint).toBe('backup');
      expect(caller.calls.map((call) => call.providerId)).toEqual(['primary', 'backup']);
    });

    it('主调用超时 → 切备 (超时按失败记账, 不炸穿)', async () => {
      const caller = new StubChatCaller([{ hang: true }, { ok: true, content: SAFE_TEXT }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }, { id: 'backup' }], { timeoutMs: 20 }),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(SAFE_TEXT);
      expect(result.providerHint).toBe('backup');
      expect(caller.calls).toHaveLength(2);
    });
  });

  describe('③ 失败计数进冷却', () => {
    it('连续失败达阈值 → 跳过主选备; 假时钟未推进时下一轮仍跳过主', () => {
      const clock = new FakeClock(1_000_000);
      const config = buildConfig([{ id: 'primary' }, { id: 'backup' }]);
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('primary', config);
      expect(runtime.next([])?.id).toBe('primary');

      runtime.markFailure('primary', config);
      expect(runtime.health()['primary'].inCooldown).toBe(true);
      expect(runtime.next([])?.id).toBe('backup');

      // 假时钟未推进 → 冷却仍生效, 下一轮依旧跳过主.
      expect(runtime.next([])?.id).toBe('backup');
      expect(runtime.health()['primary'].consecutiveFailures).toBe(2);
      // 退避是指数的: 连续失败 2 次 → 冷却 = cooldownBaseMs * 2^(2-1).
      expect(runtime.health()['primary'].cooldownUntil - clock.now()).toBe(config.cooldownBaseMs * 2);
    });
  });

  describe('④ 冷却到期恢复切回主', () => {
    it('假时钟推进过 cooldownUntil → 主重新被优先选中', () => {
      const clock = new FakeClock(1_000_000);
      const config = buildConfig([{ id: 'primary' }, { id: 'backup' }]);
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('primary', config);
      runtime.markFailure('primary', config);
      expect(runtime.next([])?.id).toBe('backup');

      // 推进过"实际记录的冷却到期时刻" —— 不写死公式, 直接对着状态走.
      const cooldownUntil = runtime.health()['primary'].cooldownUntil;
      clock.advance(cooldownUntil - clock.now() + 1);

      expect(runtime.health()['primary'].inCooldown).toBe(false);
      expect(runtime.next([])?.id).toBe('primary');
    });

    it('成功后计数与冷却一并清零 (真的恢复了才恢复额度)', () => {
      const clock = new FakeClock(1_000_000);
      const config = buildConfig([{ id: 'primary' }, { id: 'backup' }]);
      const runtime = new RenderFailoverRuntime(config.candidates, clock.now);

      runtime.markFailure('primary', config);
      runtime.markFailure('primary', config);
      runtime.markSuccess('primary');

      expect(runtime.health()['primary'].consecutiveFailures).toBe(0);
      expect(runtime.health()['primary'].inCooldown).toBe(false);
    });
  });

  describe('⑤ 全部耗尽最终降级', () => {
    it('所有候选失败 → 兜底话术 / fallbackUsed=true / providerHint=degraded / 不 reject', async () => {
      const caller = new StubChatCaller([{ ok: false, error: new Error('provider down') }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }, { id: 'backup' }]),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(FALLBACK_UTTERANCE);
      expect(result.fallbackUsed).toBe(true);
      expect(result.providerHint).toBe('degraded');
      expect(result.usage).toEqual({ completionTokens: 0, totalTokens: 0 });
      expect(result.taskKind).toBe('chat');
      expect(caller.calls).toHaveLength(2);
    });
  });

  describe('⑥ block 重生成', () => {
    it('首返 block → 重生成 pass → 返回重生成文本 (且温度下调)', async () => {
      const caller = new StubChatCaller([{ ok: true, content: UNSAFE_TEXT }, { ok: true, content: SAFE_TEXT }]);
      const guard = new StubGuard([{ level: 'block', categories: ['active_ideation'] }, { level: 'pass' }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        guard: guard.guard,
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(SAFE_TEXT);
      expect(result.fallbackUsed).toBe(true);
      expect(result.providerHint).toBe('primary');
      expect(guard.calls).toEqual([UNSAFE_TEXT, SAFE_TEXT]);
      expect(caller.calls).toHaveLength(2);
      // 重生成降温度: 同一候选, 更稳的采样.
      const firstTemperature = caller.calls[0].request.temperature ?? 0;
      const secondTemperature = caller.calls[1].request.temperature ?? 0;
      expect(secondTemperature).toBeLessThan(firstTemperature);
    });

    it('两次都 block → 返回兜底, 高危原文不传出', async () => {
      const caller = new StubChatCaller([{ ok: true, content: UNSAFE_TEXT }, { ok: true, content: UNSAFE_TEXT }]);
      const guard = new StubGuard([{ level: 'block', categories: ['active_ideation'] }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        guard: guard.guard,
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(FALLBACK_UTTERANCE);
      expect(result.text).not.toContain(UNSAFE_TEXT);
      expect(result.fallbackUsed).toBe(true);
      expect(result.providerHint).toBe('degraded');
      // 只重生成一次, 不无限重试.
      expect(caller.calls).toHaveLength(2);
    });
  });

  describe('⑦ warn 放行', () => {
    it('guard 返回 warn → 文本原样放行且有信号记录 (不改写)', async () => {
      const caller = new StubChatCaller([{ ok: true, content: '你应该多休息。' }]);
      const signals: { level: string; categories: readonly string[] }[] = [];
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        guard: async () => ({ level: 'warn', categories: ['value_judgment'] }),
        onSafetySignal: (_text, level, categories) => signals.push({ level, categories }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe('你应该多休息。');
      expect(result.fallbackUsed).toBe(false);
      expect(signals).toEqual([{ level: 'warn', categories: ['value_judgment'] }]);
    });
  });

  describe('⑧ 空内容切备', () => {
    it('主返回空串 → 视为失败并切备', async () => {
      const caller = new StubChatCaller([{ ok: true, content: '   ' }, { ok: true, content: SAFE_TEXT }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }, { id: 'backup' }]),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(SAFE_TEXT);
      expect(result.providerHint).toBe('backup');
      expect(caller.calls.map((call) => call.providerId)).toEqual(['primary', 'backup']);
    });
  });

  describe('⑨ 鉴权失败不循环', () => {
    it('401 → 直接降级, 不对后续候选逐个尝试', async () => {
      const caller = new StubChatCaller([{ ok: false, error: new Error('401 Unauthorized') }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }, { id: 'backup' }]),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.text).toBe(FALLBACK_UTTERANCE);
      expect(result.providerHint).toBe('degraded');
      expect(caller.calls).toHaveLength(1);
      expect(caller.calls[0].providerId).toBe('primary');
    });

    it('缺 apiKey 的错误同样直接降级 (不逐候选重试)', async () => {
      const caller = new StubChatCaller([{ ok: false, error: new Error('API key not found for provider deepseek') }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }, { id: 'backup' }]),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(result.providerHint).toBe('degraded');
      expect(caller.calls).toHaveLength(1);
    });
  });

  describe('⑩ taskKind 参数注入', () => {
    it('stable → 低温参数; chat → 高温参数', async () => {
      const stableCaller = new StubChatCaller([{ ok: true, content: SAFE_TEXT }]);
      const stableAdapter = new LlmRenderAdapter({
        caller: stableCaller,
        config: buildConfig([{ id: 'primary' }]),
        guard: async () => ({ level: 'pass' }),
      });
      await stableAdapter.render(buildSpec('stable'));
      expect(stableCaller.calls[0].request.temperature).toBe(0.2);
      expect(stableCaller.calls[0].request.model).toBe('stable-model');

      const chatCaller = new StubChatCaller([{ ok: true, content: SAFE_TEXT }]);
      const chatAdapter = new LlmRenderAdapter({
        caller: chatCaller,
        config: buildConfig([{ id: 'primary' }]),
        guard: async () => ({ level: 'pass' }),
      });
      await chatAdapter.render(buildSpec('chat'));
      expect(chatCaller.calls[0].request.temperature).toBe(0.85);
      expect(chatCaller.calls[0].request.model).toBe('chat-model');
    });

    it('候选 overrides 优先于分层默认', async () => {
      const caller = new StubChatCaller([{ ok: true, content: SAFE_TEXT }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary', overrides: { chat: { temperature: 0.5, model: 'primary-chat' } } }]),
        guard: async () => ({ level: 'pass' }),
      });

      await adapter.render(buildSpec('chat'));

      expect(caller.calls[0].request.temperature).toBe(0.5);
      expect(caller.calls[0].request.model).toBe('primary-chat');
    });

    it('token 上限取 spec 预算; 咨询师 → user / 来访 → assistant', async () => {
      const caller = new StubChatCaller([{ ok: true, content: SAFE_TEXT }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        guard: async () => ({ level: 'pass' }),
      });

      await adapter.render(
        buildSpec('chat', {
          recentTurns: [turn('counselor', '你最近怎么样'), turn('visitor', '还行吧')],
          tokenBudget: { maxCompletionTokens: 128, contextTokens: 512 },
        }),
      );

      expect(caller.calls[0].request.maxTokens).toBe(128);
      expect(caller.calls[0].request.messages).toEqual([
        { role: 'user', content: '你最近怎么样' },
        { role: 'assistant', content: '还行吧' },
      ]);
    });
  });

  describe('⑪ 零回归', () => {
    it('内核公开出口不含任何适配层符号 (内核未被 B 层污染)', () => {
      const leaked = Object.keys(kernel).filter((key) => /adapter|failoverruntime|chatcaller/i.test(key));
      expect(leaked).toEqual([]);
    });

    it('渲染结果字段集合固定 (无厂商私有字段 / 无安全 verdict 私有字段)', async () => {
      const caller = new StubChatCaller([{ ok: true, content: SAFE_TEXT }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary' }]),
        guard: async () => ({ level: 'pass' }),
      });

      const result = await adapter.render(buildSpec('chat'));

      expect(Object.keys(result).toSorted()).toEqual(['fallbackUsed', 'providerHint', 'taskKind', 'text', 'usage']);
      expect(Object.keys(result.usage).toSorted()).toEqual(['completionTokens', 'totalTokens']);
    });
  });
});

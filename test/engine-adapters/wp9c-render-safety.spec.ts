// V2026-10-29 治本 (WP9-C · B 层 · token 字段 / 截断保护 / 风险路由 单测):
//   覆盖任务单 §2.1 / §2.2 / §2.3 / §2.5 的可测行为:
//     ① 生成长度上限走**新字段** maxCompletionTokens, 不再下发旧字段 maxTokens;
//        思考强度按 taskKind 配置下发 (默认 low).
//     ② 截断保护: 上游 `finish_reason=length` → 丢弃未闭合尾句 (聚合 + 流式),
//        正常收尾时未闭合尾句照常发出 (不误吞短回复).
//     ③ 风险路由: 风险轮次把思考强度抬到 medium / high (只升不降).
//     ④ render prompt: coreBeliefs 真的拼进去了; 轮次权重指令随内核状态变;
//        风险轮次带安全护栏.
//
//   全 mock, 不起 NestJS 容器, 不发网络: 调用出口用 stub.
//
//   验证: npx jest test/engine-adapters/wp9c-render-safety.spec.ts
//   时间戳: 2026-10-29 GMT+8

import {
  LlmRenderAdapter,
  escalateReasoningEffort,
  type ChatCaller,
} from '../../src/engine-adapters/rendering/llm-render.adapter';
import { createRenderAdapterConfig, type RenderCandidate } from '../../src/engine-adapters/rendering/render-adapter.config';
import { dropUnclosedTail, splitClosedPrefix } from '../../src/engine-adapters/rendering/render-truncation';
import { resolveRiskLevel, type AdaptiveRenderSpec } from '../../src/engine-adapters/rendering/render-risk';
import { buildVisitorMessages } from '../../src/engine-adapters/rendering/turn-render-orchestrator';
import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse } from '../../src/llm/common/interfaces/chat-provider.interface';

/** 兜底话术 (与测试配置一致). */
const FALLBACK_UTTERANCE = '我先缓一下，我们接着说。';

/** 构造测试用规格. */
function buildSpec(overrides: Partial<AdaptiveRenderSpec> = {}): AdaptiveRenderSpec {
  return {
    taskKind: 'chat',
    intention: {
      strategy: 'simple_response',
      emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
      resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
      transference: { positive: 0, negative: 0, dependency: 0 },
      forbiddenBehaviors: [],
    },
    emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
    resistance: { verbal: 0.4, depth: 0.4, style: 0.35 },
    transference: { positive: 0, negative: 0, dependency: 0 },
    trust: 0.5,
    coreBeliefs: [],
    forbiddenBehaviors: [],
    recall: [],
    recentTurns: [{ role: 'counselor', text: '最近睡得怎么样？' }],
    tokenBudget: { maxCompletionTokens: 1500, contextTokens: 512 },
    ...overrides,
  };
}

/** 构造测试用配置. */
function buildConfig(candidates: readonly RenderCandidate[]): ReturnType<typeof createRenderAdapterConfig> {
  return createRenderAdapterConfig(candidates, {
    taskDefaults: {
      stable: { temperature: 0.2, model: 'stable-model' },
      chat: { temperature: 0.85, model: 'chat-model', reasoningEffort: 'low' },
      advanced: { temperature: 0.85, model: 'advanced-model', reasoningEffort: 'low' },
    },
    timeoutMs: 100,
    failureThreshold: 2,
    cooldownBaseMs: 1000,
    cooldownMaxMs: 8000,
    maxBlockRegen: 1,
    fallbackUtterances: [FALLBACK_UTTERANCE],
  });
}

/** 聚合调用 stub. */
class StubChatCaller implements ChatCaller {
  readonly calls: { readonly request: ChatCompletionRequest }[] = [];

  constructor(private readonly script: readonly { readonly content: string; readonly finishReason: string }[]) {}

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.calls.push({ request });
    const step = this.script[Math.min(this.calls.length - 1, this.script.length - 1)];
    return {
      content: step?.content ?? '',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'stub',
      finishReason: step?.finishReason ?? 'stop',
    };
  }
}

/** 流式调用 stub (按脚本发 chunk). */
class StubStreamCaller implements ChatCaller {
  readonly calls: { readonly request: ChatCompletionRequest }[] = [];

  constructor(private readonly script: readonly { readonly deltas: readonly string[]; readonly finishReason?: string }[]) {}

  async chat(): Promise<ChatCompletionResponse> {
    return { content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'stub', finishReason: 'stop' };
  }

  stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    this.calls.push({ request });
    const step = this.script[0] ?? { deltas: [] };
    return (async function* iterate(): AsyncIterable<ChatCompletionChunk> {
      let tokenCount = 0;
      for (const delta of step.deltas) {
        tokenCount += 5;
        yield { delta, tokenCount, isFinal: false };
      }
      yield { delta: '', tokenCount, isFinal: true, ...(step.finishReason ? { finishReason: step.finishReason } : {}) };
    })();
  }
}

describe('WP9-C · 渲染路径 token 字段 / 截断保护 / 风险路由', () => {
  describe('① 生成长度上限与思考强度', () => {
    it('只下发新字段 maxCompletionTokens, 不下发旧字段 maxTokens', async () => {
      const caller = new StubChatCaller([{ content: '还行吧。', finishReason: 'stop' }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      await adapter.render(buildSpec());

      expect(caller.calls[0]?.request.maxCompletionTokens).toBe(1500);
      expect(caller.calls[0]?.request.maxTokens).toBeUndefined();
    });

    it('思考强度按 taskKind 配置下发 (默认 low)', async () => {
      const caller = new StubChatCaller([{ content: '还行吧。', finishReason: 'stop' }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      await adapter.render(buildSpec());

      expect(caller.calls[0]?.request.reasoningEffort).toBe('low');
    });

    it('候选 overrides 的思考强度覆盖分层默认', async () => {
      const caller = new StubChatCaller([{ content: '还行吧。', finishReason: 'stop' }]);
      const adapter = new LlmRenderAdapter({
        caller,
        config: buildConfig([{ id: 'primary', overrides: { chat: { reasoningEffort: 'medium' } } }]),
      });

      await adapter.render(buildSpec());

      expect(caller.calls[0]?.request.reasoningEffort).toBe('medium');
    });
  });

  describe('② 截断保护 (半句不出声)', () => {
    it('聚合路径: finish_reason=length → 丢弃未闭合尾句', async () => {
      const caller = new StubChatCaller([{ content: '我最近有点累。晚上老是醒，现在更睡不着了', finishReason: 'length' }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      const result = await adapter.render(buildSpec());

      expect(result.text).toBe('我最近有点累。');
    });

    it('聚合路径: 截断后一句完整话都不剩 → 降级兜底 (不把半句当回复)', async () => {
      const caller = new StubChatCaller([{ content: '现在更睡不着了', finishReason: 'length' }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      const result = await adapter.render(buildSpec());

      expect(result.text).toBe(FALLBACK_UTTERANCE);
      expect(result.providerHint).toBe('degraded');
    });

    it('聚合路径: 正常收尾时原文一字不改', async () => {
      const caller = new StubChatCaller([{ content: '我最近有点累，晚上老是醒。', finishReason: 'stop' }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      const result = await adapter.render(buildSpec());

      expect(result.text).toBe('我最近有点累，晚上老是醒。');
    });

    it('流式路径: 被截断时未闭合尾句不进入下发增量', async () => {
      const caller = new StubStreamCaller([
        { deltas: ['我最近有点累。', '晚上老是醒，现在更睡不着了'], finishReason: 'length' },
      ]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const deltas: string[] = [];

      const outcome = await adapter.streamRender(buildSpec(), { onDelta: (delta) => void deltas.push(delta) });

      expect(deltas).toEqual(['我最近有点累。']);
      expect(outcome.text).toBe('我最近有点累。');
    });

    it('流式路径: 正常收尾时未闭合尾句照常发出 (不误吞短回复)', async () => {
      const caller = new StubStreamCaller([{ deltas: ['嗯'] }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });
      const deltas: string[] = [];

      const outcome = await adapter.streamRender(buildSpec(), { onDelta: (delta) => void deltas.push(delta) });

      expect(deltas).toEqual(['嗯']);
      expect(outcome.text).toBe('嗯');
    });

    it('裁剪纯函数: 没有完整句 → 返回空串 (交由上层降级, 不把半句当回复)', () => {
      expect(dropUnclosedTail('完全没有标点的一段话')).toBe('');
      expect(dropUnclosedTail('前面一句。后面半句')).toBe('前面一句。');
      expect(dropUnclosedTail('前面一句。')).toBe('前面一句。');
      expect(splitClosedPrefix('前面一句。后面半句')).toEqual({ closed: '前面一句。', pending: '后面半句' });
    });
  });

  describe('③ 风险路由 (思考强度只升不降)', () => {
    it('风险等级映射: 只有危机类别才升级, 专业性提示不升级', () => {
      expect(resolveRiskLevel('pass', [])).toBe('none');
      expect(resolveRiskLevel('warn', ['premature_advice'])).toBe('none');
      expect(resolveRiskLevel('warn', ['passive_ideation'])).toBe('medium');
      expect(resolveRiskLevel('block', ['suicide_plan'])).toBe('high');
    });

    it('抬档函数: medium / high 抬档, 且只升不降', () => {
      expect(escalateReasoningEffort('low', 'none')).toBe('low');
      expect(escalateReasoningEffort('low', 'medium')).toBe('medium');
      expect(escalateReasoningEffort('low', 'high')).toBe('high');
      expect(escalateReasoningEffort('high', 'medium')).toBe('high');
      expect(escalateReasoningEffort(undefined, 'high')).toBeUndefined();
    });

    it('风险轮次: 渲染请求的思考强度被抬到 medium', async () => {
      const caller = new StubChatCaller([{ content: '……我先缓一下，我们接着说。', finishReason: 'stop' }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      await adapter.render(
        buildSpec({ riskSignal: { level: 'medium', categories: ['passive_ideation'], source: 'probe' } }),
      );

      expect(caller.calls[0]?.request.reasoningEffort).toBe('medium');
    });

    it('正常轮次: 思考强度仍是 low', async () => {
      const caller = new StubChatCaller([{ content: '还行吧。', finishReason: 'stop' }]);
      const adapter = new LlmRenderAdapter({ caller, config: buildConfig([{ id: 'primary' }]) });

      await adapter.render(buildSpec());

      expect(caller.calls[0]?.request.reasoningEffort).toBe('low');
    });
  });

  describe('④ render prompt 拼装 (coreBeliefs / 轮次权重 / 安全护栏)', () => {
    it('coreBeliefs 真的拼进了 system prompt (确认而非假设)', () => {
      const messages = buildVisitorMessages(
        buildSpec({
          coreBeliefs: [{ theme: 'unlovable', statement: '只要够努力就不会被抛下', activationTags: [] }],
        }),
      );

      const system = messages[0]?.content ?? '';
      expect(system).toContain('只要够努力就不会被抛下');
    });

    it('轮次权重: 高阻抗 + 低信任 → 短、躲闪的指令', () => {
      const messages = buildVisitorMessages(
        buildSpec({
          resistance: { verbal: 0.8, depth: 0.6, style: 0.7 },
          trust: 0.2,
        }),
      );

      const system = messages[0]?.content ?? '';
      expect(system).toContain('这轮你不太想多说');
      expect(system).toContain('把话头交还给咨询师');
    });

    it('轮次权重: 低阻抗 + 高信任 + 探索策略 → 可以多解释几句', () => {
      const messages = buildVisitorMessages(
        buildSpec({
          resistance: { verbal: 0.1, depth: 0.2, style: 0.2 },
          trust: 0.8,
          intention: {
            strategy: 'cognitive_exploration',
            emotion: { label: 'neutral', valence: 0, arousal: 0.3 },
            resistance: { verbal: 0.1, depth: 0.2, style: 0.2 },
            transference: { positive: 0, negative: 0, dependency: 0 },
            forbiddenBehaviors: [],
          },
        }),
      );

      const system = messages[0]?.content ?? '';
      expect(system).toContain('可以多解释几句');
    });

    it('风险轮次: prompt 带安全护栏 (不生成危险操作细节)', () => {
      const messages = buildVisitorMessages(
        buildSpec({ riskSignal: { level: 'medium', categories: ['passive_ideation'], source: 'probe' } }),
      );

      const system = messages[0]?.content ?? '';
      expect(system).toContain('安全提醒');
      expect(system).toContain('不描述任何危险做法');
    });

    it('正常轮次: 不带安全护栏 (不制造多余约束)', () => {
      const messages = buildVisitorMessages(buildSpec());

      expect(messages[0]?.content ?? '').not.toContain('安全提醒');
    });
  });
});

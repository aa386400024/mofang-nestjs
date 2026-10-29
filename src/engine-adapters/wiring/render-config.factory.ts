// V2026-10-28 治本 (WP8-A · B 层 · 渲染配置工厂 + 渲染端口装配):
//   职责: ① 从 ConfigService/env 读出渲染配置 → 构造 `RenderAdapterConfig`;
//         ② 把 WP6 的 `LlmRenderAdapter` 装好 (接上 WP7 的 prompt 缝与 WP6 的输出 guard).
//   边界: 装配层只做「读配置 → 造纯对象 → 注入」; 不写决策、不拼 prompt、
//         不组装 RenderSpec (那些分别在内核 / WP7).
//
//   为什么模型名放在**候选 overrides** 而不是 taskDefaults:
//     模型名是**厂商相关**的 —— deepseek 是 'deepseek-chat', qwen 是 'qwen-plus'.
//     而 taskDefaults 是**全局一层**(不分厂商). 把模型名放全局, 主备两个不同厂商
//     就会共用一个模型名, 切到备候选时必然打错模型. 所以:
//       taskDefaults[kind]  → 温度 / token 上限 (厂商无关)
//       candidate.overrides[kind].model → 该候选该分层的模型 (厂商相关)
//     WP6 的配置结构本来就是为这件事准备的 (候选 overrides 覆盖全局默认).
//
//   反双胞胎:
//     - 不在装配层写死模型名: 模型名从 env 取; 未配置时向 router 问它自己的
//       tier→model 映射 (各厂商模型名只有 router 知道) —— 装配层硬编码一份
//       模型名表, 就等于第二份"厂商有什么模型"的真相, 厂商一改就漂移.
//     - 不在装配层复制温度/阈值的默认值: 一律引用 WP6 导出的种子常量 ——
//       数值散落两处, 改一处忘一处, 于是"配置说 30s、代码说 3s"这类分裂.
//     - 不自己判 provider 是否注册: 未注册时 router 走它既有的回落默认路径.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts 覆盖 env 缺省/覆盖与 deps 装配

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { RenderTaskKind } from '../../engine-core';
import { AIProviderId, LLMTier } from '../../llm/common/enums/llm.enums';
import type { ChatReasoningEffort } from '../../llm/common/interfaces/chat-provider.interface';
import { LlmRouterService } from '../../llm/registry/llm-router.service';
import {
  LlmRenderAdapter,
  createVisitorOutputGuard,
  createVisitorPrecheck,
  type ChatCaller,
  type LlmRenderAdapterDeps,
} from '../rendering/llm-render.adapter';
import {
  DEFAULT_RENDER_COOLDOWN_BASE_MS,
  DEFAULT_RENDER_COOLDOWN_MAX_MS,
  DEFAULT_RENDER_FAILURE_THRESHOLD,
  DEFAULT_RENDER_REASONING_EFFORT,
  DEFAULT_RENDER_TASK_DEFAULTS,
  DEFAULT_RENDER_TIMEOUT_MS,
  createRenderAdapterConfig,
  type RenderAdapterConfig,
  type RenderCandidate,
} from '../rendering/render-adapter.config';
import type { StreamingRenderPort } from '../rendering/streaming-render.port';
import { buildVisitorMessages } from '../rendering/turn-render-orchestrator';

/**
 * 合法的思考强度档位 (上游协议事实, 查表用).
 */
const REASONING_EFFORT_VALUES: ReadonlySet<ChatReasoningEffort> = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * 任务分层 → env 键后缀.
 */
const KIND_ENV_SUFFIX: Readonly<Record<RenderTaskKind, string>> = {
  chat: 'CHAT',
  stable: 'STABLE',
  advanced: 'ADVANCED',
};

/**
 * 渲染配置工厂: env → `RenderAdapterConfig`.
 */
@Injectable()
export class RenderConfigFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly router: LlmRouterService,
  ) {}

  /**
   * 构造渲染配置 (所有键可选, 缺省回 WP6 种子).
   *
   * @returns 渲染适配器配置
   */
  build(): RenderAdapterConfig {
    const candidates = this.buildCandidates();
    const chatTemperature = this.ratioNumber('ENGINE_RENDER_CHAT_TEMPERATURE', DEFAULT_RENDER_TASK_DEFAULTS.chat.temperature);
    const stableTemperature = this.ratioNumber('ENGINE_RENDER_STABLE_TEMPERATURE', DEFAULT_RENDER_TASK_DEFAULTS.stable.temperature);
    // V2026-10-29 治本 (WP9-C): token 上限走**新字段** `maxCompletionTokens`
    //   (thinking token 计入上限). 未配置 env → 不下发, 由 spec.tokenBudget 决定
    //   (默认 1500, 见 turn-render-orchestrator 的 DEFAULT_TURN_TOKEN_BUDGET) ——
    //   这样"上限"只有一个真相: env 覆盖, 否则用内核预算.
    const maxCompletionTokens = this.optionalPositiveNumber('ENGINE_RENDER_MAX_TOKENS');
    // 思考强度: 渲染路径默认 low (内核已把决策做完, LLM 只做翻译);
    //   风险轮次由适配器按内核判定结果强制抬档 (medium/high), 不受这里影响.
    const reasoningEffort = this.reasoningEffort('ENGINE_RENDER_REASONING_EFFORT') ?? DEFAULT_RENDER_REASONING_EFFORT;

    return createRenderAdapterConfig(candidates, {
      taskDefaults: {
        // advanced 本期回退 chat 口径 (本期没有高阶档位, 别假装有).
        chat: { temperature: chatTemperature, maxCompletionTokens, reasoningEffort },
        stable: { temperature: stableTemperature, maxCompletionTokens, reasoningEffort },
        advanced: { temperature: chatTemperature, maxCompletionTokens, reasoningEffort },
      },
      timeoutMs: this.positiveNumber('ENGINE_RENDER_TIMEOUT_MS', DEFAULT_RENDER_TIMEOUT_MS),
      failureThreshold: this.positiveNumber('ENGINE_RENDER_FAILURE_THRESHOLD', DEFAULT_RENDER_FAILURE_THRESHOLD),
      cooldownBaseMs: this.positiveNumber('ENGINE_RENDER_COOLDOWN_BASE_MS', DEFAULT_RENDER_COOLDOWN_BASE_MS),
      cooldownMaxMs: this.positiveNumber('ENGINE_RENDER_COOLDOWN_MAX_MS', DEFAULT_RENDER_COOLDOWN_MAX_MS),
      fallbackUtterances: this.fallbackUtterances(),
    });
  }

  /**
   * 候选序列: 主候选 + 逗号分隔的备候选 (顺序即优先级, 去重).
   */
  private buildCandidates(): RenderCandidate[] {
    const primary = this.text('ENGINE_RENDER_PRIMARY_PROVIDER') ?? this.text('LLM_DEFAULT_CHAT_PROVIDER') ?? AIProviderId.DEEPSEEK;
    const fallbacks = (this.text('ENGINE_RENDER_FALLBACK_PROVIDERS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const ids = [...new Set([primary, ...fallbacks])];
    return ids.map((id) => ({
      id,
      overrides: {
        chat: { model: this.modelFor('chat', id) },
        stable: { model: this.modelFor('stable', id) },
        advanced: { model: this.modelFor('advanced', id) },
      },
    }));
  }

  /**
   * 该候选该分层的模型名: env 优先, 否则问 router 自己的 tier→model 映射.
   */
  private modelFor(kind: RenderTaskKind, providerId: string): string | undefined {
    const explicit = this.text(`ENGINE_RENDER_${KIND_ENV_SUFFIX[kind]}_MODEL`);
    if (explicit) return explicit;
    // advanced 未单独配置时回退 chat (本期 advanced 与 chat 同口径).
    if (kind === 'advanced') {
      const chatModel = this.text(`ENGINE_RENDER_${KIND_ENV_SUFFIX.chat}_MODEL`);
      if (chatModel) return chatModel;
    }
    return this.router.getDefaultModelForTier(LLMTier.RAG, providerId as AIProviderId);
  }

  /** 读字符串 (缺省/空白 → undefined). */
  private text(key: string): string | undefined {
    const raw = this.config.get<string>(key);
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /** 读正数 (非法 → 回落种子). */
  private positiveNumber(key: string, fallback: number): number {
    const parsed = this.parseNumber(key);
    if (parsed === undefined || parsed <= 0) return fallback;
    return parsed;
  }

  /** 读可选正数 (未配置 → undefined, 让下游继续用自己的预算). */
  private optionalPositiveNumber(key: string): number | undefined {
    const parsed = this.parseNumber(key);
    if (parsed === undefined || parsed <= 0) return undefined;
    return parsed;
  }

  /**
   * 读思考强度档位 (非法 → undefined, 让下游回落种子).
   *
   * 用查表而不是"是不是 low/medium/high": 档位集合是**上游协议事实**
   * (MiniMax 还支持 xhigh/max), 写死一份 if 链必然漏档.
   */
  private reasoningEffort(key: string): ChatReasoningEffort | undefined {
    const raw = this.text(key)?.toLowerCase();
    if (!raw) return undefined;
    return REASONING_EFFORT_VALUES.has(raw as ChatReasoningEffort) ? (raw as ChatReasoningEffort) : undefined;
  }

  /**
   * 兜底话术池: env 一行多句 (`|` 分隔) → 数组.
   *
   * 为什么用 `|` 而不是逗号: 兜底话术本身常带逗号 ("……我先缓一下, 我们接着说。"),
   * 用逗号分隔会把一句话切成两半. 未配置 → undefined (回落种子池).
   */
  private fallbackUtterances(): readonly string[] | undefined {
    const raw = this.text('ENGINE_RENDER_FALLBACK_UTTERANCE');
    if (!raw) return undefined;
    const pool = raw
      .split('|')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return pool.length > 0 ? pool : undefined;
  }

  /** 读比率 (温度; 允许 0, 非法 → 回落种子). */
  private ratioNumber(key: string, fallback: number): number {
    const parsed = this.parseNumber(key);
    if (parsed === undefined || parsed < 0) return fallback;
    return parsed;
  }

  /** env 值转数字 (非数字 → undefined). */
  private parseNumber(key: string): number | undefined {
    const raw = this.text(key);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}

/**
 * 装配渲染端口的依赖 (WP6 的 `LlmRenderAdapterDeps`).
 *
 * 单独抽成函数 (而不是塞进 useFactory 里): 这样单测能**直接断言 deps** ——
 * prompt 缝是不是 WP7 的 `buildVisitorMessages`、guard 是不是 WP6 的
 * `createVisitorOutputGuard()` 产物, 一眼可验.
 *
 * @param caller 调用出口
 * @param config 渲染配置
 * @returns 渲染适配器依赖
 */
export function buildEngineRenderDeps(caller: ChatCaller, config: RenderAdapterConfig): LlmRenderAdapterDeps {
  const logger = new Logger('EngineRenderPort');
  return {
    caller,
    config,
    // WP7 留给本期的 prompt 缝: 来访视角的中文 system 模板 + 角色映射.
    buildMessages: buildVisitorMessages,
    // 输出侧伦理校验: 复用内核 WP4 的 guardVisitorOutput (两侧口径永远一致).
    guard: createVisitorOutputGuard(),
    // WP8-B 前置静态预检 (流式专用): 复用内核同一套来访侧规则, 只看 RenderSpec,
    // 不调模型 —— 流式已出声不可撤回, 所以开口前先判一次.
    precheck: createVisitorPrecheck(),
    // 安全信号只进日志 (不进 RenderResult): 文本片段由适配器自己截断记录,
    // 这里只记等级与类别, 避免同一段敏感内容被日志记两遍.
    onSafetySignal: (_text, level, categories) => {
      logger.warn(`渲染输出安全信号 level=${level} categories=${categories.join(',') || '-'}`);
    },
  };
}

/**
 * 装配渲染端口 (WP6 的 `LlmRenderAdapter`).
 *
 * @param caller 调用出口
 * @param config 渲染配置
 * @returns 渲染端口 (带流式扩展)
 */
export function buildEngineRenderPort(caller: ChatCaller, config: RenderAdapterConfig): StreamingRenderPort {
  return new LlmRenderAdapter(buildEngineRenderDeps(caller, config));
}

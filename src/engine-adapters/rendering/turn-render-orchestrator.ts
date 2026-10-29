// V2026-10-28 治本 (WP7 · B 层 · 决策→说话装配门面):
//   职责: 把内核的"决策"接成"一句真实来访口语" —— 调内核 turn → 组装 RenderSpec
//         → 调 RenderPort.render → 回填真实 reply → 问+答成对补写工作记忆.
//         附中文来访风格 system prompt 模板 (仅适配层, 内核零 prompt).
//   边界: 纯类, 可脱离 NestJS 容器 new 出来跑; **零 @nestjs / 零 typeorm**,
//         零网络 (只依赖注入的端口), 零 .env, 零落库 (记忆写入走注入的 MemoryStore 端口).
//
//   为什么"回填 reply"必须在适配层 (第 0 原则):
//     内核零 IO / 零 prompt / 零网络. RenderPort 是**外部能力**, 内核只产出决策状态.
//     "调谁渲染、怎么拼上下文、怎么回填、怎么记记忆"全是装配职责.
//     改内核的 turn 去调 RenderPort = 让内核长出网络依赖 —— 整包搬走就泡汤.
//     所以内核 `reply` 仍恒为 '', 真实话术由本门面产出 (内核出参逐字不动).
//
//   失败语义 (两级, 刻意不同):
//     - 内核 turn 抛错 (ABORTED / INVALID_INPUT / SESSION_NOT_FOUND) → **原样冒泡**.
//       那些是"调用方参数错"或"会话状态错", 该由传输层 (WP8) 处理; 门面的降级出口
//       只管"渲染这块挂了", 越权吞掉内核错误会把参数错误伪装成一次正常对练.
//     - 渲染抛异常 / 文本为空 → **兜底成非空中性话术**, 绝不 reject.
//       渲染是最后一公里, 它挂了不该让整场对练挂掉 (同 WP6 M4).
//
//   V2026-10-29 治本 (WP8-B · 流式出口):
//     新增 `turnStream(handleId, input, handlers)` —— 与 `turn()` **共用**内核决策 /
//     规格组装 / 落账 (settleTurn) 的同一套闭环, 只把"取文"换成流式. 历史与记忆
//     逻辑不复制: 复制一份必然出现"聚合记得、流式忘得"的分裂.
//
//   反双胞胎:
//     - 不重复写咨询师半边记忆: 内核 rememberTurn 已经写了 (source=TURN, tier=WORKING,
//       content=咨询师文本). 门面只补**来访半边**. 重复写 = 工作记忆里同一条出现两次,
//       召回时权重被悄悄翻倍, 而且没人查得出来.
//     - 不改内核 EngineTurnOutput: 门面另起一个 TurnRenderResult, 把内核出参**透传**
//       (snapshot / turnIndex / intention / trajectoryTrace / safety / openingContext),
//       只在外面包一层 render 元信息与真实 reply.
//     - 不把 prompt 写进内核: 模板在本文件, 经 WP6 预留的 buildMessages 缝注入.
//     - 记忆写失败不炸穿: 记忆写不进去是"降级"(这条没被记住), 不是"会话失败"
//       (同 WP2 embedder 的失败语义) —— 让它炸穿等于把一次可降级的抖动升级成整场失败.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp7-turn-render.spec.ts 覆盖映射/裁剪/闭环/成对记忆/降级/冒泡/prompt

import { nanoid } from 'nanoid';

import { buildRenderSpec, type SpecAssemblyInput } from './spec-assembler';
import { splitTextIntoDeltas, type StreamRenderHandlers, type StreamingRenderPort } from './streaming-render.port';
import {
  MemorySource,
  MemoryTier,
  WORKING_MEMORY_WINDOW_TURNS,
  type BehaviorStrategy,
  type BdiSnapshot,
  type EmotionLabel,
  type EngineSessionPort,
  type EngineTurnInput,
  type EngineTurnOutput,
  type Intention,
  type MemoryHit,
  type MemoryStore,
  type RenderContextTurn,
  type RenderSpec,
  type RenderTokenBudget,
  type SafetyVerdict,
  type TrajectoryTrace,
} from '../../engine-core';
import type { ChatMessage } from '../../llm/common/interfaces/chat-provider.interface';

/**
 * 会话归属 (写工作记忆所需的 tenant / visitor / session 三元组).
 *
 * 门面自己**不知道**这些 —— 内核会话端口没有"由句柄反查归属"的方法
 * (句柄是运行时维度, 归属是业务维度). 所以归属由装配层注入解析函数.
 */
export interface TurnSessionContext {
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 业务会话 id. */
  readonly sessionId: string;
  /** 稳定来访者 id. */
  readonly visitorId: string;
}

/**
 * 门面单轮返回.
 */
export interface TurnRenderResult {
  /** 本轮来访口语 (渲染文本; 降级时为中性兜底句). */
  readonly reply: string;
  /** 内核本轮快照 (透传). */
  readonly snapshot: BdiSnapshot;
  /** 本会话累计轮次 (透传). */
  readonly turnIndex: number;
  /** 本轮意图 (透传; 内核未产出时省略). */
  readonly intention?: Intention;
  /** 渲染元信息 (供观测, 不进内核). */
  readonly render: {
    /** 是否走过备用路径 (切过备 / 走过 block 重生成 / 走过降级). */
    readonly fallbackUsed: boolean;
    /** 实际提供服务的候选标识 (降级时为 'degraded'). */
    readonly providerHint?: string;
    /** 用量 (仅供观测, 不作计费依据). */
    readonly usage?: { readonly completionTokens: number; readonly totalTokens: number };
  };
  /** 本轮轨迹观测 (透传; 仅注入剧本的会话携带). */
  readonly trajectoryTrace?: TrajectoryTrace;
  /** 本轮安全判定 (透传; 仅非 pass 时携带). */
  readonly safety?: SafetyVerdict;
  /** 跨会话开场上下文 (透传; 仅 resume 首论携带). */
  readonly openingContext?: readonly MemoryHit[];
}

/**
 * 门面构造依赖.
 */
export interface TurnRenderOrchestratorDeps {
  /** 内核会话端口 (openSession / turn / closeSession). */
  readonly session: EngineSessionPort;
  /** 渲染端口 (WP6 的 LlmRenderAdapter, 或任意实现; 支持流式扩展). */
  readonly renderer: StreamingRenderPort;
  /** 记忆仓储端口 (用于补写来访半边工作记忆). */
  readonly memories: MemoryStore;
  /**
   * 会话归属解析 (多会话门面用).
   *
   * 门面拿不到 tenant / visitor —— 内核会话端口没有"由句柄反查归属"的方法.
   * 由装配层 (WP8) 注入: 门面拿 handleId 去问装配层"这场会话是谁".
   */
  readonly resolveSession?: (handleId: string) => TurnSessionContext | undefined;
  /** 固定会话归属 (单会话门面用; 与 resolveSession 二选一, 解析函数优先). */
  readonly sessionContext?: TurnSessionContext;
  /** 规格组装器 (缺省用 buildRenderSpec). */
  readonly assembler?: (input: SpecAssemblyInput) => RenderSpec;
  /** token 预算种子 (缺省 { maxCompletionTokens: 160, contextTokens: 512 }). */
  readonly tokenBudget?: RenderTokenBudget;
  /** 可注入时钟 (记忆条目发生时刻). */
  readonly now?: () => number;
  /** 可注入 id 工厂 (记忆条目 id). */
  readonly idFactory?: () => string;
  /** 兜底话术 (缺省 DEFAULT_TURN_FALLBACK_UTTERANCE). */
  readonly fallbackUtterance?: string;
}

/**
 * 归一后的渲染结果 (区分"真话术"与"系统兜底产物").
 */
interface NormalizedRender {
  readonly text: string;
  /** 是否走过备用路径. */
  readonly fallbackUsed: boolean;
  /** 文本是否为**系统兜底产物** (不是来访真说的话). */
  readonly degraded: boolean;
  readonly providerHint?: string;
  readonly usage: { readonly completionTokens: number; readonly totalTokens: number };
}

/**
 * 默认 token 预算 (种子值, 未标定).
 *
 * 与内核 WP5 的 DEFAULT_COMPLETION_TOKENS 对齐 (160); 上下文预算 512 是
 * "够放最近 8 轮口语" 的工程估计, WP8 接真实模型后按上下文窗口校准.
 */
export const DEFAULT_TURN_TOKEN_BUDGET: RenderTokenBudget = { maxCompletionTokens: 160, contextTokens: 512 };

/**
 * 来访半边工作记忆的重要度 (中性值, 与内核工作记忆口径一致).
 */
export const VISITOR_MEMORY_IMPORTANCE = 0.5;

/**
 * 兜底话术 (中性、不越界、不给建议、不承诺).
 */
export const DEFAULT_TURN_FALLBACK_UTTERANCE = '……我先缓一下，我们接着说。';

/**
 * 门面保留的最近对话轮数上限 (一问一答算两轮).
 *
 * 与内核工作记忆窗口同源 (8 轮 = 16 半轮): 门面持有的历史只是**给模型看的上下文**,
 * 不是决策依据, 不必比内核的工作记忆窗口更宽 —— 更宽只会让 prompt 更贵、
 * 更稀释当前议题.
 */
export const MAX_HISTORY_TURNS = WORKING_MEMORY_WINDOW_TURNS * 2;

/**
 * 决策→说话装配门面 (纯类, 非 NestJS).
 */
export class TurnRenderOrchestrator {
  private readonly deps: TurnRenderOrchestratorDeps;
  private readonly tokenBudget: RenderTokenBudget;
  private readonly fallbackUtterance: string;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  /** 每个句柄的最近对话序列 (旧 → 新). */
  private readonly histories = new Map<string, RenderContextTurn[]>();

  constructor(deps: TurnRenderOrchestratorDeps) {
    this.deps = deps;
    this.tokenBudget = deps.tokenBudget ?? DEFAULT_TURN_TOKEN_BUDGET;
    this.fallbackUtterance = deps.fallbackUtterance ?? DEFAULT_TURN_FALLBACK_UTTERANCE;
    this.now = deps.now ?? Date.now;
    this.idFactory = deps.idFactory ?? (() => nanoid());
  }

  /**
   * 执行一轮"决策 → 说话".
   *
   * @param handleId 内核会话句柄
   * @param input 本轮入参 (咨询师文本)
   * @returns 本轮来访口语 + 内核出参透传 + 渲染元信息
   * @throws 内核会话端口抛出的错误原样冒泡 (ABORTED / INVALID_INPUT / SESSION_NOT_FOUND)
   */
  async turn(handleId: string, input: EngineTurnInput): Promise<TurnRenderResult> {
    // 1. 内核决策 (错误原样冒泡 —— 门面只兜"渲染这块", 不兜内核).
    const output = await this.deps.session.turn(handleId, input);

    // 2. 组装规格: 历史 = 已累积对话 + 本轮咨询师输入 (当前轮必须在场, 否则模型无从回应).
    const history = this.historyOf(handleId);
    const spec = this.assemble(output, [...history, { role: 'counselor', text: input.userText }]);

    // 3. 渲染 (异常 / 空文本 → 兜底, 永不 reject).
    const rendered = await this.renderSafely(spec);

    // 4. 回填前的落账: 历史 + 来访半边工作记忆.
    await this.settleTurn(handleId, input.userText, rendered);

    // 5. 组装返回 (内核出参逐字透传, 外面包一层 render 元信息与真实 reply).
    return {
      reply: rendered.text,
      snapshot: output.snapshot,
      turnIndex: output.turnIndex,
      ...(output.intention ? { intention: output.intention } : {}),
      render: {
        fallbackUsed: rendered.fallbackUsed,
        ...(rendered.providerHint ? { providerHint: rendered.providerHint } : {}),
        usage: rendered.usage,
      },
      ...(output.trajectoryTrace ? { trajectoryTrace: output.trajectoryTrace } : {}),
      ...(output.safety ? { safety: output.safety } : {}),
      ...(output.openingContext ? { openingContext: output.openingContext } : {}),
    };
  }

  /**
   * 执行一轮"决策 → 说话" (**流式**).
   *
   * 与 `turn()` **共用**同一套闭环: 内核决策 → 组装规格 → 取文 → 落账 → 组装返回.
   * 两者只差"取文的方式": 聚合是一次性拿全文, 流式是边生成边把增量交给消费方.
   * 所以历史 / 记忆 / 落账逻辑**不复制** —— 复制一份必然出现"聚合路径记得、流式
   * 路径忘得"这种只有单测能发现的分裂.
   *
   * 降级语义与聚合路径对齐: 渲染降级 → 只追加咨询师半边, **不写**来访半边记忆
   * (兜底句不是来访真说的话).
   *
   * @param handleId 内核会话句柄
   * @param input 本轮入参 (咨询师文本)
   * @param handlers 增量回调面 (onDelta / signal)
   * @returns 本轮来访口语 + 内核出参透传 + 渲染元信息
   * @throws 内核会话端口抛出的错误原样冒泡 (ABORTED / INVALID_INPUT / SESSION_NOT_FOUND)
   */
  async turnStream(handleId: string, input: EngineTurnInput, handlers: StreamRenderHandlers): Promise<TurnRenderResult> {
    // 1. 内核决策 (与 turn() 同一入口, 错误同样原样冒泡).
    const output = await this.deps.session.turn(handleId, input);

    // 2. 组装规格 (历史 + 本轮咨询师输入).
    const history = this.historyOf(handleId);
    const spec = this.assemble(output, [...history, { role: 'counselor', text: input.userText }]);

    // 3. 流式取文 (增量经 onDelta 转发; 异常 / 空文本 → 兜底, 永不 reject).
    const rendered = await this.streamSafely(spec, handlers);

    // 4. 落账 (与 turn() 共用 settleTurn: 历史 + 来访半边工作记忆).
    await this.settleTurn(handleId, input.userText, rendered);

    // 5. 组装返回 (与 turn() 同构).
    return {
      reply: rendered.text,
      snapshot: output.snapshot,
      turnIndex: output.turnIndex,
      ...(output.intention ? { intention: output.intention } : {}),
      render: {
        fallbackUsed: rendered.fallbackUsed,
        ...(rendered.providerHint ? { providerHint: rendered.providerHint } : {}),
        usage: rendered.usage,
      },
      ...(output.trajectoryTrace ? { trajectoryTrace: output.trajectoryTrace } : {}),
      ...(output.safety ? { safety: output.safety } : {}),
      ...(output.openingContext ? { openingContext: output.openingContext } : {}),
    };
  }

  /**
   * 丢弃某句柄的会话历史 (会话关闭时调用).
   *
   * 门面是长生命周期对象 (一个实例服务多场会话), 历史必须能被显式释放 ——
   * 否则每场会话的对话都留在内存里, 是缓慢的内存泄漏.
   *
   * @param handleId 内核会话句柄
   */
  forgetSession(handleId: string): void {
    this.histories.delete(handleId);
  }

  /**
   * 组装渲染规格 (走注入的组装器, 缺省内核口径的 buildRenderSpec).
   */
  private assemble(output: EngineTurnOutput, recentTurns: readonly RenderContextTurn[]): RenderSpec {
    const assembler = this.deps.assembler ?? buildRenderSpec;
    return assembler({ output, recentTurns, tokenBudget: this.tokenBudget });
  }

  /**
   * 渲染并归一: 成功 → 真实文本; 异常 / 空文本 → 兜底句 (永不 reject).
   */
  private async renderSafely(spec: RenderSpec): Promise<NormalizedRender> {
    try {
      const result = await this.deps.renderer.render(spec);
      const text = (result?.text ?? '').trim();
      if (!text) {
        warn('[turn] 渲染结果为空, 降级为中性兜底句');
        return this.degradedRender();
      }
      return {
        text,
        fallbackUsed: result.fallbackUsed,
        degraded: false,
        ...(result.providerHint ? { providerHint: result.providerHint } : {}),
        usage: { completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens },
      };
    } catch (error) {
      // 理论上 WP6 适配器已不 reject; 这里是防御 —— 换别的 RenderPort 实现时兜住.
      warn(`[turn] 渲染异常, 降级为中性兜底句: ${errorMessage(error)}`);
      return this.degradedRender();
    }
  }

  /**
   * 流式渲染并归一: 成功 → 真实文本; 异常 / 空文本 → 兜底句 (永不 reject).
   *
   * 渲染器没实现流式 (可选方法缺失) → 退化成"聚合取文 + 切段成增量".
   * 那只是**兜底形态** (字幕不再是一整段), 主路径永远是渲染器自己的流式.
   */
  private async streamSafely(spec: RenderSpec, handlers: StreamRenderHandlers): Promise<NormalizedRender> {
    const renderer = this.deps.renderer;
    if (!renderer.streamRender) {
      warn('[turnStream] 渲染端口未实现流式, 回退聚合取文 + 切段成增量');
      const aggregated = await this.renderSafely(spec);
      for (const chunk of splitTextIntoDeltas(aggregated.text)) {
        await handlers.onDelta(chunk);
      }
      return aggregated;
    }
    try {
      const outcome = await renderer.streamRender(spec, handlers);
      const text = (outcome?.text ?? '').trim();
      if (!text) {
        warn('[turnStream] 流式渲染结果为空, 降级为中性兜底句');
        return this.degradedRender();
      }
      // 降级判定: 渲染器自报 degraded, 或兜底 providerHint —— 两者都表示
      // "这不是来访者完整说出来的真话", 不能写进工作记忆.
      const degraded = outcome.degraded || outcome.providerHint === 'degraded';
      return {
        text,
        fallbackUsed: outcome.fallbackUsed,
        degraded,
        ...(outcome.providerHint ? { providerHint: outcome.providerHint } : {}),
        usage: { completionTokens: outcome.usage.completionTokens, totalTokens: outcome.usage.totalTokens },
      };
    } catch (error) {
      // 理论上渲染器的流式出口已不 reject; 这里是防御 —— 换别的渲染实现时兜住.
      warn(`[turnStream] 流式渲染异常, 降级为中性兜底句: ${errorMessage(error)}`);
      return this.degradedRender();
    }
  }

  /**
   * 降级渲染结果 (系统兜底产物).
   */
  private degradedRender(): NormalizedRender {
    return {
      text: this.fallbackUtterance,
      fallbackUsed: true,
      degraded: true,
      providerHint: 'degraded',
      usage: { completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * 落账: 历史追加 + 来访半边工作记忆.
   *
   * 历史与记忆的差别只在**降级**时:
   *   - 成功 → 历史追加"问 + 答", 并写一条来访半边的工作记忆;
   *   - 降级 → 历史只追加"问" (来访半边是系统兜底句, 不是来访真说的话;
   *     把它当"来访说了这句"喂回模型, 等于教模型输出兜底话术),
   *     且**不写**工作记忆 (兜底句不是来访的真实表达).
   */
  private async settleTurn(handleId: string, counselorText: string, rendered: NormalizedRender): Promise<void> {
    const history = this.historyOf(handleId);
    const next: RenderContextTurn[] = [...history, { role: 'counselor', text: counselorText }];
    if (!rendered.degraded) {
      next.push({ role: 'visitor', text: rendered.text });
    }
    this.setHistory(handleId, next);

    if (rendered.degraded) return;
    await this.writeVisitorMemory(handleId, rendered.text);
  }

  /**
   * 写来访半边工作记忆 (内核已写咨询师半边, 这里只补另一半).
   */
  private async writeVisitorMemory(handleId: string, reply: string): Promise<void> {
    const context = this.resolveContext(handleId);
    if (!context) {
      warn('[turn] 未解析到会话归属 (tenant/visitor), 跳过来访半边工作记忆写入');
      return;
    }
    try {
      await this.deps.memories.remember({
        id: this.idFactory(),
        tenantId: context.tenantId,
        visitorId: context.visitorId,
        sessionId: context.sessionId,
        tier: MemoryTier.WORKING,
        source: MemorySource.TURN,
        content: reply,
        importance: VISITOR_MEMORY_IMPORTANCE,
        occurredAt: this.now(),
      });
    } catch (error) {
      warn(`[turn] 来访半边工作记忆写入失败 (不影响本轮回复): ${errorMessage(error)}`);
    }
  }

  /**
   * 解析会话归属: 注入的解析函数优先, 其次固定归属.
   */
  private resolveContext(handleId: string): TurnSessionContext | undefined {
    return this.deps.resolveSession?.(handleId) ?? this.deps.sessionContext;
  }

  /** 取句柄的最近对话序列. */
  private historyOf(handleId: string): readonly RenderContextTurn[] {
    return this.histories.get(handleId) ?? [];
  }

  /** 写入句柄的最近对话序列 (超上限丢最旧). */
  private setHistory(handleId: string, turns: readonly RenderContextTurn[]): void {
    this.histories.set(handleId, turns.slice(-MAX_HISTORY_TURNS));
  }
}

// ────────────────────────────────────────────────────────────────────
// 中文来访风格 system prompt (仅适配层; 内核不含任何 prompt)
// ────────────────────────────────────────────────────────────────────

/**
 * 行为策略 → 中文标签 (穷尽映射).
 *
 * 用穷尽 Record 而不是查表兜底: 新增策略时 TS 会直接报错, 逼着补上中文标签 ——
 * 否则策略名会以英文原样出现在 prompt 里, 模型既看不懂也不该看到.
 */
const STRATEGY_LABEL: Readonly<Record<BehaviorStrategy, string>> = {
  simple_response: '简单回应',
  request: '提出请求',
  recounting: '复述一段经历',
  cognitive_exploration: '探索想法',
  affective_exploration: '探索情绪',
  insight: '产生一点领悟',
  discussing_plans: '讨论下一步打算',
  resistance: '回避与抵抗',
};

/**
 * 情绪标签 → 中文标签 (穷尽映射).
 */
const EMOTION_LABEL: Readonly<Record<EmotionLabel, string>> = {
  neutral: '平静',
  sad: '低落',
  anxious: '焦虑',
  angry: '愤怒',
  hurt: '受伤',
  guarded: '戒备',
  relieved: '松了口气',
  hopeful: '有点希望',
  ashamed: '羞愧',
  empty: '空落',
};

/**
 * 构造来访者视角的消息序列 (system 模板 + 历史).
 *
 * 注入位置: WP6 适配器构造时的 `buildMessages` 缝 —— 渲染端口只收 spec,
 * 消息怎么拼是**渲染执行侧**的事, 所以模板与拼装都在适配层, 内核零 prompt.
 *
 * 角色映射: 咨询师 → `user`, 来访 → `assistant` (模型扮演来访者, 所以咨询师
 * 的话是"对方说的", 来访自己说过的话是"我说过的").
 *
 * @param spec 渲染规格
 * @returns 消息序列
 */
export function buildVisitorMessages(spec: RenderSpec): ChatMessage[] {
  return [
    { role: 'system', content: buildVisitorSystemPrompt(spec) },
    ...spec.recentTurns.map((turn) => ({
      role: turn.role === 'counselor' ? ('user' as const) : ('assistant' as const),
      content: turn.text,
    })),
  ];
}

/**
 * 构造中文来访风格系统提示词.
 *
 * 约束三条: 口语 (像人说话, 不像客服)、克制 (不越出决策目标)、守界 (不给建议/
 * 不承诺治愈/ 不评判咨询师). 状态信息只用来**约束语气与节奏**, 并明确禁止
 * 把这些状态词说出口 —— 否则模型会把"阻抗""策略"这类词直接念出来.
 *
 * @param spec 渲染规格
 * @returns 系统提示词
 */
function buildVisitorSystemPrompt(spec: RenderSpec): string {
  const lines: string[] = [
    '你正在扮演一位来访者，正在和一位咨询师对话。你不是咨询师，也不是助手。',
    '说话方式：用中文口语，短句，像真实的人聊天；可以只说半句、可以停顿。不要写旁白、动作描写、括号补充或列表，不要解释自己。',
    '',
    '你此刻的内在状态（只用来约束你的语气与节奏，绝对不要说出口）：',
    `- 行为策略：${STRATEGY_LABEL[spec.intention.strategy]}`,
    `- 情绪：${EMOTION_LABEL[spec.emotion.label]}（效价 ${formatNumber(spec.emotion.valence)}，唤醒 ${formatNumber(spec.emotion.arousal)}）`,
    `- 阻抗：话量 ${formatNumber(spec.resistance.verbal)}／深度 ${formatNumber(spec.resistance.depth)}／风格 ${formatNumber(spec.resistance.style)}（越高越回避、话越短、语气越疏离）`,
    `- 移情：正向 ${formatNumber(spec.transference.positive)}／负向 ${formatNumber(spec.transference.negative)}／依赖 ${formatNumber(spec.transference.dependency)}`,
    `- 信任：${formatNumber(spec.trust)}（越低越戒备、越不愿多说）`,
  ];

  if (spec.coreBeliefs.length > 0) {
    const statements = spec.coreBeliefs.map((belief) => belief.statement).filter((statement) => statement.length > 0);
    if (statements.length > 0) {
      lines.push(`- 你心里坚信、不会动摇的东西：${statements.join('；')}`);
    }
  }
  if (spec.forbiddenBehaviors.length > 0) {
    lines.push(`- 你绝不会做的事（绝不能出现）：${spec.forbiddenBehaviors.join('、')}`);
  }
  if (spec.trajectoryNote) {
    lines.push(`- 你此刻正经历的事：${spec.trajectoryNote}`);
  }

  lines.push(
    '',
    '硬规则：',
    '1. 只回应咨询师刚说的那一句，别主动换话题，也别追问咨询师自己的经历。',
    '2. 不给建议、不下诊断、不承诺治愈、不评判咨询师。',
    '3. 上面那些状态词（策略／情绪／阻抗／信念等）一个字都不要说出来。',
    '4. 一次最多说一到三句。',
  );
  return lines.join('\n');
}

/**
 * 数字格式化 (两位小数; 非有限数兜底为 0).
 */
function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/**
 * 极简告警日志.
 *
 * 为什么不用 NestJS 的 Logger: 任务单 §2 要求门面**零 `@nestjs/*`** ——
 * 门面必须能脱离 Nest 容器独立 new 出来跑与测; 引一个框架 Logger 就等于
 * 把"框架"带进这个本该纯 TS 的装配单元. 这里的日志量极小 (只在异常路径),
 * 用 console 足够; 真要接统一日志, 后续可把日志器做成注入项, 不影响门面语义.
 */
function warn(message: string): void {
  console.warn(`[TurnRenderOrchestrator] ${message}`);
}

/**
 * 错误转可读文案.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

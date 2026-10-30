// V2026-10-28 治本 (MiniMax chat provider 接入 · src/llm 增补):
//   职责: 把现有 MiniMax 订阅接进 chat 抽象层 —— OpenAI 兼容协议, 继承
//         `OpenAICompatibleChatProvider` 基类, 只声明 (id / name / baseUrl /
//         defaultChatModel), 不重写协议、不重写流式、不重写错误归一.
//   边界: 纯类, 可独立 new 出来跑; 不读 env (基址与模型名由构造参数注入),
//         不注册 embedding (MiniMax embedding 另议), 不碰 voice/agent/counselor
//         的既有 MiniMax 用法.
//
//   为什么走 OpenAI 兼容基类而不是新写一个 provider:
//     MiniMax 的 chat 端点是 `${MINIMAX_BASE_URL}/v1/chat/completions` +
//     `Authorization: Bearer <key>` + OpenAI 风格 messages + SSE —— 与基类
//     假定的协议完全一致. 基类已封装 LangChain `ChatOpenAI` 的聚合 chat /
//     streamChat / testConnection, 新写一份就是**同一个协议的第二个实现**,
//     将来 LangChain 升级要改两处.
//
//   为什么基址与模型名从**构造参数**来而不是 provider 自己读 env:
//     provider 是纯类 (与 deepseek/qwen/doubao 同构), 由启动配置层
//     (`llm.config.ts`) 读 env 后注入. 这样 provider 里没有 IO, 单测能直接
//     构造任意基址/模型, 也让"基址归一"这件事只有一处实现 (provider-env.ts).
//
//   已知上游差异 (按真实返回处理, 不硬塞):
//     1. M3.1-Flash 的 temperature 被上游忽略 (官方固定) —— 基类透传即可,
//        不为它在本类里做特例.
//     2. token 上限字段: 上游思考 token 计入长度上限, 官方口径是
//        `max_completion_tokens`. 基类默认先给 `maxTokens`,
//        真出现 400/截断时再在子类覆盖 `buildLLM` 做字段映射 —— **不预埋**
//        未验证的特例 (那是把猜测写进生产路径).
//
//   V2026-10-29 治本 (WP9-C · 上游字段映射落地):
//     上面的"待落地"现在落地了 —— 实测 (MiniMax-M3.1-Flash, 2026-10-29):
//       · `max_completion_tokens` ✅ 生效; `max_tokens` 也能收, 但**思考 token 同样计入**,
//         所以旧字段不是"更宽松", 只是"老名字";
//       · `reasoning_effort=low` ✅ 生效 (思考 token 94 → 39, 首字延迟 2.4s → 1.9s);
//       · usage 里带 `completion_tokens_details.reasoning_tokens` (可观测"思考吃了多少").
//     所以本类覆盖 `buildRequestOverrides`: **只下发 `max_completion_tokens` 与
//     `reasoning_effort`, 绝不下发 `max_tokens`** ——
//       ① 不同时下发两个上限字段 (语义歧义, 上游可能按旧字段截断);
//       ② LangChain 1.x 只在 `isReasoningModel(model)` 为真时才下发
//          `max_completion_tokens`, 而那个判定**硬编码只认 OpenAI 系模型名**
//          (`o*` / `gpt-5*` / `gpt-6*`) —— MiniMax 走不到那条分支, 除非我们自己把字段
//          放进 `modelKwargs` (它会被原样展开进请求体).
//     代价: 走 `modelKwargs` 意味着**不设** LangChain 的 `maxTokens`
//     (设了它, LangChain 会补一个 `max_tokens` 字段 —— 那就变成两个字段同时下发).
//
//   反双胞胎:
//     - 不在本类里读 process.env / ConfigService: 那是配置层的职责, 混进来
//       就没法脱离 Nest 容器单测.
//     - 不注册 embedding provider: MiniMax 的向量模型与维度口径未核, 占位注册
//       等于给上层一个"能用但会错"的实现.
//     - 不改 `MINIMAX_BASE_URL` 的全局语义: 旧 agent 流式 / voice TTS / ASR
//       仍按"不带 /v1"消费同一个 env 键 —— 本类只在**自己这一层**归一,
//       不去改别人读到的值.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/llm/minimax-provider.spec.ts 覆盖 id / 模型名 / 基址归一 / 注册分支
//        + 上游字段映射 (只下发 max_completion_tokens / reasoning_effort)

import { OpenAICompatibleChatProvider, type OpenAICompatibleConfig } from '../common/base/openai-compatible-chat.provider';
import { AIProviderId } from '../common/enums/llm.enums';
import type { ChatCompletionRequest, ChatReasoningEffort } from '../common/interfaces/chat-provider.interface';
import { resolveMinimaxBaseUrl, resolveMinimaxChatModel } from '../config/provider-env';

/**
 * MiniMax Chat Provider 构造选项.
 */
export interface MinimaxChatProviderOptions {
  /** OpenAI 兼容基址 (缺省 / 空白 = 国内站默认). 内部会归一到 `/v1`. */
  readonly baseUrl?: string;
  /** 默认 chat 模型 (缺省 / 空白 = `MiniMax-M3`). */
  readonly defaultChatModel?: string;
}

/**
 * MiniMax Chat Provider.
 *
 * 只注册 CHAT 能力 (embedding 另议).
 */
export class MinimaxChatProvider extends OpenAICompatibleChatProvider {
  constructor(options: MinimaxChatProviderOptions = {}) {
    const cfg: OpenAICompatibleConfig = {
      id: AIProviderId.MINIMAX,
      name: 'MiniMax',
      baseUrl: resolveMinimaxBaseUrl(options.baseUrl),
      defaultChatModel: resolveMinimaxChatModel(options.defaultChatModel),
    };
    super(cfg);
  }

  /**
   * 上游字段映射 (V2026-10-29 治本 · WP9-C): 只下发 MiniMax 认的新字段.
   *
   * @param request 调用方请求
   * @returns LangChain 构造参数里的额外上游字段
   */
  protected override buildRequestOverrides(request: ChatCompletionRequest): {
    readonly maxTokens?: number;
    readonly reasoningEffort?: ChatReasoningEffort;
    readonly modelKwargs?: Record<string, unknown>;
  } {
    const limit = request.maxCompletionTokens ?? request.maxTokens;
    const modelKwargs: Record<string, unknown> = {};
    if (limit !== undefined) {
      modelKwargs['max_completion_tokens'] = limit;
    }
    if (request.reasoningEffort !== undefined) {
      modelKwargs['reasoning_effort'] = request.reasoningEffort;
    }
    // 不设 maxTokens: 设了 LangChain 会补一个 `max_tokens` 字段, 于是两个上限字段同时下发.
    return { modelKwargs };
  }
}

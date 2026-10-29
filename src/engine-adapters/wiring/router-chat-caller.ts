// V2026-10-28 治本 (WP8-A · B 层 · Router → 窄面 ChatCaller 适配):
//   职责: 把 WP6 的窄面 `ChatCaller` 落到生产调用出口 —— 委托现有
//         `LlmRouterService.chat`, 不复制它的任何能力.
//   边界: 只做"签名对齐"; 不做冷却/重试 (WP6 适配器内部职责),
//         不做 provider 选型 (router 职责), 不读 apiKey (router 职责).
//
//   为什么不直接让 WP6 适配器依赖 LlmRouterService:
//     WP6 的窄面是**刻意**收窄的 (单一 chat 方法, providerId 可选). 直接依赖
//     router 具体类, 就等于把"多 provider 注册 + apiKey 解析 + 未注册回落默认"
//     这整套运行时能力焊死在渲染适配器上, 单测必须造整个 Nest 容器才能跑.
//     走窄面, 单测用 stub, 将来换调用出口 (直连网关 / 换 SDK) 不用动适配器.
//
//   反双胞胎:
//     - 不复制 router 的回落逻辑: "指定 provider 未注册 → 回落默认"是 router 的
//       既有行为, 本层原样透传, 不再自己判一次注册表 —— 两份判断必然漂移.
//     - 不在这里做主备/冷却/重试: 那是 WP6 适配器按内核纯决策执行的职责;
//       在这一层做一遍就等于同一策略两个执行点.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts: req 与 providerId 原样透传, 响应原样返回

import { Injectable } from '@nestjs/common';

import { AIProviderId } from '../../llm/common/enums/llm.enums';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../llm/common/interfaces/chat-provider.interface';
import { LlmRouterService } from '../../llm/registry/llm-router.service';
import type { ChatCaller } from '../rendering/llm-render.adapter';

/**
 * 生产 `ChatCaller`: 把窄面接到 `LlmRouterService.chat`.
 */
@Injectable()
export class RouterChatCaller implements ChatCaller {
  constructor(private readonly router: LlmRouterService) {}

  /**
   * 单轮 chat 调用.
   *
   * @param req 请求 (模型 / 消息 / 温度 / token 上限)
   * @param providerId 目标候选 id (缺省走 router 自己的默认 provider)
   * @returns 厂商响应 (原样返回, 不做字段加工)
   */
  chat(req: ChatCompletionRequest, providerId?: string): Promise<ChatCompletionResponse> {
    // providerId 来自**配置里的候选 id**, 语义上就是已注册的 AIProviderId;
    // 即便配了一个未注册的 id, router 也会走它既有的"回落默认 provider"路径 ——
    // 不在本层再判一次注册表 (见文件头「反双胞胎」).
    return this.router.chat(req, providerId ? { providerId: providerId as AIProviderId } : {});
  }
}

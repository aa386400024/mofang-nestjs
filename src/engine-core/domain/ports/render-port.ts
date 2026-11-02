// V2026-10-28 治本 (WP5 · 引擎内核 · 渲染端口):
//   职责: 定义"渲染"这一**可替换外部能力**的接口形状 —— 内核只依赖接口,
//         不关心是哪个厂商、哪条链路、哪种部署形态.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 本文件**不含任何实现**.
//
//   为什么不直接在内核里调 LLM:
//     内核第 0 原则是纯 TS、零 IO、未来整包搬走成独立微服务. 真调 LLM 会带来:
//       - 内核绑死某个厂商与某个 baseUrl (换模型要改内核代码);
//       - 内核要读 .env 里的 apiKey (内核就没有配置层);
//       - 单测必须 mock 网络才能跑;
//       - 温度 / topP / 流式 / 主备 这些都是**运行时策略**, 与"决策到哪了"无关.
//     走接口后, 内核只回答"要渲染成什么样"(RenderSpec), 适配层回答"用什么渲染".
//
//   失败语义 (关键):
//     端口**不承诺成功**. render 允许 reject —— 由适配层兜住, 并按
//     cognition/rendering/failover.ts 的纯决策切换到备用候选.
//     内核自身不重试、不冷却、不退避、不读时钟.
//
//   与既有 src/llm 路由的关系:
//     仓内已有 LlmRouterService (多 provider + streamChat). 本期**不触碰**它 ——
//     RenderPort 的真实实现由适配层包装它而成 (含主备 fallback 与流式),
//     内核只定义"要什么规格、返回什么结果".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. 本期内核不调用该端口 (turn 管线未改), 装配轮接入

import type { RenderResult, RenderSpec } from '../rendering/render-types';

/**
 * 渲染抽象 (未来 = 适配层包装现有 src/llm 的主备 / 流式实现).
 *
 * 内核只依赖该接口, 不关心模型部署 / 厂商 / 网络.
 * 失败语义: 端口不承诺成功, render 允许 reject —— 由适配层兜住并按 failover
 * 决策切换, 内核自身不重试、不冷却、不读时钟.
 */
export interface RenderPort {
  /** 按规格渲染一段文本. */
  render(spec: RenderSpec): Promise<RenderResult>;
}

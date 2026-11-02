// V2026-10-28 治本 (WP4 · 引擎内核 · 风险探测端口):
//   职责: 定义"风险探测"这一**可替换外部能力**的接口形状 —— 内核只依赖接口,
//         不关心模型部署在哪、怎么部署.
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 本文件**不含任何实现**, 也不含网络代码.
//
//   为什么 probe 走端口而不是直接写 HTTP 调用:
//     探测端未来是独立的 Python 服务 (PsyGUARD-RoBERTa). 如果内核里直接写
//     fetch + 地址 + 超时 + 重试, 那么:
//       - 内核就绑死了 HTTP 与某个具体地址 (内核整包搬走时这条依赖带不走);
//       - 单测要起真服务才能跑;
//       - 换模型/换部署 (本地进程 / 队列 / gRPC) 要改内核.
//     走接口后, 内核只认 "给我一段文本, 给我一个判定", 其余全在装配层.
//
//   失败语义 (关键):
//     端口**不承诺一定成功**. probe 可能超时 / 抛错 / 返回脏形状 —— 这些都由
//     编排层 (cognition/safety/assess-safety.ts) 兜住并回落规则结果.
//     把"失败"留给调用方处理, 是端口设计里最容易做错的一环: 一个假设自己
//     永远成功的依赖, 会把网络抖动直接变成会话失败.
//
//   MindGuard 临床层 (危机升级精算 / 处置建议) 属后期云 API: 此处仅占位,
//   本期不定义其方法、不留行为字段.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp4-safety.spec.ts 用 fake probe 覆盖超时 / 抛错 / 脏形状

import type { SafetyLevel, SafetySide, VisitorRiskCategory } from '../safety/safety-types';

/**
 * 风险探测结果 (由实现方给出, 内核只做归一).
 */
export interface RiskProbeResult {
  /** 归一后的等级. */
  readonly level: SafetyLevel;
  /** 归一后的来访风险类别. */
  readonly categories: readonly VisitorRiskCategory[];
  /** 模型置信度 (0..1), 可选; 内核只归一等级, 不拿它做决策阈值. */
  readonly score?: number;
}

/**
 * 风险探测抽象 (未来 = 独立 PsyGUARD-RoBERTa Python 服务的 HTTP 适配).
 *
 * 内核只依赖该接口, 不关心模型部署 / 网络. 失败语义由实现 / 编排层负责降级,
 * 端口本身不承诺"一定成功".
 */
export interface RiskProbePort {
  /** 探测一段文本的风险等级; 允许 reject (编排层会兜住并回落规则). */
  probe(text: string, side: SafetySide): Promise<RiskProbeResult>;
}

// V2026-10-30 治本 (WP11 · B 层 · 风险探测端口 token):
//   职责: 给内核 `RiskProbePort` 声明一个**可注入的运行时 token** —— 装配层据此
//         决定注入 `HttpPsyGuardProbe` (配了 PSYGUARD_BASE_URL) 还是
//         `LocalCrisisProbe` (没配).
//   边界: 零逻辑, 只有 token 常量.
//
//   为什么必须用 Symbol 而不是接口本身:
//     `RiskProbePort` 是 **interface** —— TypeScript 的 interface 编译后**没有运行时值**,
//     不能当 Nest 的 provider token (`providers: [RiskProbePort]` 会编译失败或运行时
//     undefined). 必须有一个真实可用的 token.
//
//   为什么用 Symbol 而不是字符串:
//     Symbol 不可能与别的 provider 重名; 字符串 token 撞名时 Nest **不报错**, 而是
//     静默注入错的东西 (排查时表现为"某个模块拿到了另一个模块的依赖").
//
//   为什么单独成文件 (不放 engine.tokens.ts):
//     engine.tokens.ts 装的是**引擎装配层**的三个端口; 风险探测是 WP9-C 起就存在的
//     独立能力 (本轮只是把"装哪个"抽成 token), 独立成文件让风险域自洽, 也避免
//     engine.module.ts 同时从两个地方取端口 token.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp11-psyguard-probe.spec.ts 覆盖装配分流

/**
 * 风险探测端口 token (实现 = HttpPsyGuardProbe 或 LocalCrisisProbe).
 */
export const RISK_PROBE = Symbol('RISK_PROBE');

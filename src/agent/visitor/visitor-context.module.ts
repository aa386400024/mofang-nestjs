// V2026-10-21 治本 (V1.2 VS-B2 — 来访者上下文注册表模块):
//   原因: VisitorContextRegistry 要让 **业务模块** (counselor) 往 **agent 模块** 的
//     VisitorService 里注入上下文, 但两边不能互相 import:
//       - agent → business: 破坏 agent 的定位 (agent 是通用能力层)
//       - business → agent: counselor 已经 import 了 AgentModule (取 LlmService),
//         若 agent 再 import counselor 就成**循环依赖**
//     NestJS 的 provider token 直接注入也解决不了: 同名 token 在各自 module 里各有一份,
//     消费方拿到的是**自己 module 里的**那份, 业务实现根本到不了消费者.
//   修法: 走 **@Global() 模块**:
//     - 本模块在 app 启动时只被 import 一次 (由 AgentModule 引入), 之后全局可见
//     - 业务模块 (counselor) 注入 VisitorContextRegistry 时**不需要 import** 它
//     - 业务模块在自己的 provider.onModuleInit 里调 registry.register(贡献者)
//     - 启动顺序: @Global 模块的 provider 先实例化 → 业务 provider 的 onModuleInit 后跑 → 注册成功
//   反双胞胎:
//     - 不做成 @Global 的业务模块: 那就回到"agent import business"的循环依赖
//     - 不用 app.module 手工 providers 数组接线: 那样 agent 侧要认识 counselor 的 provider 类
//   验证:
//     1. tsc 0 错
//     2. 启动日志能看到 counselor 贡献者注册成功
//     3. 非 counselor 的 voice session 不受影响
//   时间戳: 2026-10-21

import { Global, Module } from '@nestjs/common';

import { VisitorContextRegistry } from './visitor-context';

/**
 * 来访者上下文注册表模块 (@Global).
 *
 * 全局可见的业务意图: "任何业务模块都能往 AI 来访者的 prompt 里塞会话级上下文,
 * 而 agent 侧不需要知道有哪些业务".
 */
@Global()
@Module({
  providers: [VisitorContextRegistry],
  exports: [VisitorContextRegistry],
})
export class VisitorContextModule {}

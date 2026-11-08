// V2026-10-28 治本 (WP8-A · B 层 · 引擎装配层 DI token):
//   职责: 给三个**纯接口**端口声明可注入的运行时 token ——
//         内核会话端口 / 记忆仓储端口 / 渲染端口.
//   边界: 零逻辑, 只有 token 常量.
//
//   为什么需要这个文件 (为什么不能直接用接口当 token):
//     内核的 `EngineSessionPort` / `MemoryStore` / `RenderPort` 都是 **interface**,
//     TypeScript 的 interface 在编译后**没有运行时值** —— 不能拿它当 Nest 的
//     provider token (`providers: [EngineSessionPort]` 会直接编译失败或运行时
//     undefined). 所以必须有一个真实可用的 token (symbol 或字符串).
//
//   为什么用 Symbol 而不是字符串:
//     Symbol 不可能与别的 provider 重名 —— 字符串 token 会跟仓库里其它模块的
//     同名字符串撞车, 撞车时 Nest **不报错**, 而是静默注入错的东西,
//     排查时表现为"某个模块拿到了另一个模块的依赖". symbol 把这类事故关在编译期.
//
//   反双胞胎:
//     - 不把 token 放在 engine.module.ts: 装配模块会 import 门面服务, 门面服务
//       又要 import token —— 循环依赖在装饰器求值期会拿到 undefined.
//       独立成文件是打破环的最短路径.
//     - 不在 token 文件里放任何装配逻辑: 这里只声明"叫什么", 不声明"怎么造".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts 覆盖装配链路的 token 贯通

/**
 * 内核会话端口 token (实现 = InMemoryEngineSession).
 */
export const ENGINE_SESSION_PORT = Symbol('ENGINE_SESSION_PORT');

/**
 * 记忆仓储端口 token (实现 = QdrantMemoryStore 或 InMemoryMemoryStore).
 */
export const ENGINE_MEMORY_STORE = Symbol('ENGINE_MEMORY_STORE');

/**
 * 渲染端口 token (实现 = WP6 的 LlmRenderAdapter).
 */
export const ENGINE_RENDER_PORT = Symbol('ENGINE_RENDER_PORT');

/**
 * 滚动摘要清理端口 token (实现 = RollingSessionSummaryService).
 *
 * V2026-11-04 (WP55): 为什么这个 token 是**必需的**而不是可选:
 *   `RollingSummaryCleanupPort` 是 **interface** —— TypeScript 的 interface 编译后
 *   没有运行时值, `emitDecoratorMetadata` 只能把它降级成 `Object`.
 *   而 Nest 正是靠 `design:paramtypes` 决定注入什么: 不给显式 token 的话,
 *   它会去容器里找一个叫 `Object` 的 provider —— 找不到, 就**静默注入 undefined**
 *   (`@Optional()` 还会把这个静默失败变成"看起来正常"的运行结果:
 *   会话关掉了, 但滚动摘要状态永远不释放 —— 正是 WP55 要修的那个泄漏).
 *   这与本文件头记的"启动炸弹"是同一类问题: interface 当 token 的坑.
 */
export const ROLLING_SUMMARY_CLEANUP = Symbol('ROLLING_SUMMARY_CLEANUP');

/**
 * BDI 状态仓储端口 token (实现 = InMemoryBdiStateRepository 或 RedisBdiStateRepository).
 *
 * V2026-11-06 (WP38 补做 · 调试会话恢复): 为什么这个 token 是**必需**的:
 *   调试会话恢复要把"持久化文件里的内核状态快照"**回灌**进内核 —— 而内核
 *   每轮都从 BDI 状态仓储读/写. 恢复器与内核必须指向**同一个实例**:
 *   两个实例 = 两个真相 (恢复器写进去的快照, 内核那一侧读不到),
 *   恢复功能会**静默失效** —— 接口返回成功, 但恢复出来的 BDI 状态对不上.
 *   把仓储提成独立 provider 并导出, 是让"同一份真相"成立的唯一办法.
 */
export const ENGINE_BDI_STATE_REPOSITORY = Symbol('ENGINE_BDI_STATE_REPOSITORY');

/**
 * 审议灰度模式配置 token (V2026-11-08 R9 · 实现 = `DeliberationModeConfig`).
 *
 * ⚠️ 为什么单独一个 token (而不是各工厂自己读 env):
 *   模式判定要喂**三个**决策 (内核要不要挂钩子 / 门面要不要跑生效拍 / 影子旁路挂不挂),
 *   三处必须**读到同一份**. 各读各的 = 三处 env 快照万一不一致 (比如中途改 env),
 *   就会出现"内核在问审议、门面不产出"这种半接上的状态 —— 症状是建议永远不生效,
 *   而日志上什么都看不出来.
 */
export const ENGINE_DELIBERATION_MODE_CONFIG = Symbol('ENGINE_DELIBERATION_MODE_CONFIG');

/**
 * 审议生效钩子 token (V2026-11-08 R9 · 实现 = `LlmDeliberationHook`).
 *
 * ⚠️ 必须是**单例**: 内核会话端口与编排门面必须拿到**同一个**钩子实例 ——
 *   钩子持有"每场会话最近一条建议"的进程内缓存, 两个实例 = 两份缓存 = 建议永远对不上.
 */
export const ENGINE_DELIBERATION_HOOK = Symbol('ENGINE_DELIBERATION_HOOK');

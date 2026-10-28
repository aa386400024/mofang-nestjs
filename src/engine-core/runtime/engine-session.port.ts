// V2026-10-28 治本 (WP0 · 引擎内核 · 会话端口):
//   职责: 定义会话内核的行为契约 (open / turn / close). 这是内核对外**唯一**的
//         行为出口 —— adapter (WS / HTTP / 未来的 gRPC) 只跟这三个方法打交道.
//
//   关键设计决策 (为什么 openSession 是同步的):
//     任务单给的签名是 `openSession(input): EngineSessionHandle` (同步), 而状态仓储
//     的 load 是异步的. 这里**不**把 openSession 改成 async, 原因:
//       - open 的语义是"登记一个运行时句柄" (注册进句柄表), 本身没有 I/O;
//       - 持久状态的读 (load) 与写 (save) 全部收敛在 turn 里 —— 那里本来就是异步;
//       - 若把 load 塞进 openSession, 就得把端口签名改成 async, 而这个端口未来
//         要被独立微服务暴露, 签名越少改越好 (契约稳定性 = 拆服务成本).
//     WP1 落地后, turn 的内部顺序固定为: load 状态 → 事件算子 → 存状态 → 记忆写入.
//
//   反双胞胎:
//     - 不把端口写成"内核具体类" —— 端口是接口, 实现可换 (内存版 / 未来服务调用版).
//     - 不在端口里塞渲染 / 语音相关方法 (speak / stream) —— 渲染属 WP5, 传输属 adapter;
//       端口一膨胀, 内核就跟某个传输协议绑死, 整包搬不动.
//     - 不加"批量轮" / "预热" / "取消会话"等没人用的方法 —— 端口是契约, 不是许愿池.
//     - 不在端口方法上标 NestJS 装饰器 (@Injectable 等) —— 那是 adapter 的事.
//
//   如何验证:
//     1. pnpm build 0 错
//     2. test/engine-core/engine-core.spec.ts: 直接 new 内存实现, 不启动 NestJS 容器
//        跑通 open → turn → close

import type { EngineSessionHandle, EngineTurnInput, EngineTurnOutput, OpenEngineSessionInput } from '../domain/engine-session.types';

/**
 * 会话内核端口.
 *
 * 生命周期: openSession → (turn × N) → closeSession.
 * 三个方法都不接受 / 返回任何 HTTP / WS 帧结构.
 */
export interface EngineSessionPort {
  /**
   * 开启一个内核会话, 登记运行时句柄.
   *
   * 该方法**不做持久化读取** —— 状态在首个 turn 内按需载入
   * (见 runtime/engine-session.port.ts 顶部「为什么 openSession 是同步的」).
   *
   * @param input 开场参数 (sessionId / tenantId / visitorId / seed / resumeFromSessionId)
   * @returns 会话句柄 (handleId + sessionId)
   * @throws EngineCoreError code=INVALID_INPUT sessionId / tenantId / visitorId 为空
   * @throws EngineCoreError code=SESSION_ALREADY_OPEN 同一 sessionId 已 open
   */
  openSession(input: OpenEngineSessionInput): EngineSessionHandle;

  /**
   * 执行一轮对话 (认知决策 → 状态落库).
   *
   * WP0 为占位实现: 不做 BDI 推理, 状态原样透传, reply 恒为空串.
   *
   * @param handleId openSession 返回的句柄 id
   * @param input 本轮入参 (userText / traceId / signal)
   * @returns 本轮出参 (reply / snapshot / turnIndex)
   * @throws EngineCoreError code=SESSION_NOT_FOUND 句柄不存在
   * @throws EngineCoreError code=INVALID_INPUT userText 空白
   * @throws EngineCoreError code=ABORTED signal 已触发
   * @throws EngineCoreError code=STATE_CONFLICT 状态并发写冲突 (乐观锁)
   */
  turn(handleId: string, input: EngineTurnInput): Promise<EngineTurnOutput>;

  /**
   * 关闭会话, 释放运行时句柄.
   *
   * **幂等**: 对未知 / 已关闭的 handleId 调用不抛错 —— 关闭动作常出现在错误处理
   * 与 finally 路径上, 让它抛错会把"清理失败"升级成"主流程失败", 反而掩盖真实错因.
   * 持久状态不受影响 (状态在 turn 里已落库, 由仓储的生命周期管理).
   *
   * @param handleId openSession 返回的句柄 id
   */
  closeSession(handleId: string): void;
}

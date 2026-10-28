// V2026-10-28 治本 (WP0 · 引擎内核 · 错误契约):
//   职责: 给内核一个**框架无关**的机器可读错误码, 供 adapter (NestJS / WS / HTTP)
//         翻译成各自的表现层错误 (BizException / WS close frame / HTTP status).
//   为什么不用 NestJS 的 HttpException:
//     内核未来要整包搬去独立微服务 (见 docs/architecture/ai-engine-roadmap-v1.1.md 第 0 原则),
//     带 HttpException = 把框架契约焊进内核, 恰好违反 WP0 要立的边界.
//     内核只抛"码 + 消息 + 细节", 表现层自己映射 —— 与 ports 目录同一套思路.
//
//   反双胞胎:
//     - 不在每个内核文件里各写一套 Error 子类 —— 错误码散落必然漂移, 消费方无法穷举.
//     - 不用裸 Error 抛错 —— 裸 Error 只能靠 message 字符串匹配, adapter 无法可靠映射.
//     - 不把错误码做成 NestJS BizCode 的子集 —— BizCode 是业务域概念 (HTTP 404 / 403),
//       内核错误是引擎域概念 (状态冲突 / 会话不存在), 两者正交, 强行合并会让内核反向依赖业务域.
//     - 不在 errors 里塞 HTTP status / WS close code —— 那是 adapter 的映射表, 不是内核语义.
//
//   如何验证:
//     1. pnpm build 0 错 (纯 TS, 无框架依赖)
//     2. 每个抛错点都带 code, adapter 可按 code 分支 (不靠 message 字符串匹配)
//     3. instanceof 跨模块边界仍成立 (target es2024 原生 class 继承, 无需 setPrototypeOf 补丁)

/**
 * 内核错误码 —— 框架无关, adapter 按码映射表现层错误.
 *
 * 命名口径: 枚举成员用 UPPER_CASE (跟本仓库既有 enum 如 VisitorMode 一致),
 * wire 值用 `ENGINE_` 前缀 —— 内核错误码与业务错误码同日志时一眼能分出来源.
 */
export enum EngineErrorCode {
  /** 入参非法 (空 sessionId / 空 userText / importance 越界等). */
  INVALID_INPUT = 'ENGINE_INVALID_INPUT',
  /** 会话句柄不存在 (turn 了一个未 open 的 handleId). */
  SESSION_NOT_FOUND = 'ENGINE_SESSION_NOT_FOUND',
  /** 同一 sessionId 重复 open (内核侧会话唯一, 跨实例语义由 adapter 负责). */
  SESSION_ALREADY_OPEN = 'ENGINE_SESSION_ALREADY_OPEN',
  /** 状态并发写冲突 (乐观锁: 传入 revision 不大于已存 revision). */
  STATE_CONFLICT = 'ENGINE_STATE_CONFLICT',
  /** 操作被取消 (AbortSignal 已触发, 对应语音侧 barge-in). */
  ABORTED = 'ENGINE_ABORTED',
  /** 端口不支持该操作 (预留: 未来 trajectory / ethics 端口的未实现分支). */
  UNSUPPORTED = 'ENGINE_UNSUPPORTED',
}

/**
 * 内核统一异常.
 *
 * `details` 是结构化上下文 (sessionId / handleId / revision 等), 供 adapter 决定
 * 是否回传客户端 (例如 SESSION_NOT_FOUND 的 sessionId 无需外泄) 与写日志.
 */
export class EngineCoreError extends Error {
  /** 机器可读错误码. */
  readonly code: EngineErrorCode;
  /** 结构化上下文. 不放敏感内容 —— adapter 会原样写日志. */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EngineErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'EngineCoreError';
    this.code = code;
    this.details = details;
  }
}

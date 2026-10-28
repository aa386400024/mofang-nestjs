// V2026-10-28 治本 (WP0 · 引擎内核 · 会话端口纯 DTO):
//   职责: 定义会话内核的入参 / 出参 / 句柄**纯 DTO** —— 不沾 HTTP / WS 帧,
//         不含 NestJS 的 class-validator 装饰器, 可被任意传输层直接构造.
//   边界: 纯 TS, 零 @nestjs/* / typeorm.
//
//   为什么 DTO 与端口接口分两个文件:
//     domain/engine-session.types.ts  只放"数据形状";
//     runtime/engine-session.port.ts  只放"行为契约".
//     两者耦合方向单向 (port 依赖 types), 换掉端口实现不需要动 DTO, 反之亦然.
//
//   反双胞胎:
//     - 不用 class + @IsString() 之类的 class-validator 装饰器 —— 那是 HTTP 层的
//       入参校验职责; 内核自己校验 (抛 INVALID_INPUT), 否则内核一被非 HTTP 入口
//       (WS / 未来 gRPC / 独立微服务) 调用就失去校验.
//     - 不把 WS 帧字段 (seq / event / ack / sessionKey 等) 塞进 DTO —— 内核不认识
//       传输协议; adapter 负责帧 ⇄ DTO 翻译.
//     - 不复用仓库里的 VisitorTurnOptions —— 那是旧扮演链路 (src/agent/visitor/) 的
//       传输侧类型, 内核不能反向依赖旧链路 (旧链路与内核并列存在, 见任务单 §1).
//
//   如何验证:
//     1. pnpm build 0 错
//     2. runtime/engine-session.port.ts 只 import 本文件的类型, 无循环依赖

import type { BdiSnapshot } from './bdi-snapshot';

/**
 * 开场入参.
 *
 * 字段口径:
 *   - sessionId  内核会话主键 (业务侧唯一). 同一 sessionId 在内核内只能 open 一次.
 *   - tenantId   租户隔离键. 内核自身不鉴权, 但会把 tenantId 一路带进
 *                BdiStateRecord / MemoryEntry —— 隔离写进**数据契约**,
 *                任何持久化实现(MySQL / Qdrant / Redis)都自动带上行级隔离,
 *                不会因为"忘了加 where tenant_id"而串号.
 *   - visitorId  来访者角色标识. 内核**不感知** persona 的实体结构
 *                (5Ps / 情绪基线 / 阻抗基线 属角色内核域, 由 adapter 解析后注入),
 *                内核只认一个稳定 id —— 这样内核未来整包搬走时不必拖着一整套 persona 模型.
 *   - seed       随机种子. 可复现性的入口: 同一 visitorId + 同一 seed + 同一行为序列
 *                必须产出同一 BDI 状态 (WP1 / WP3 "伦理盲盒每次触发点一致" 的前置条件).
 *                省略时由内核按会话生成一次并记入句柄.
 *   - resumeFromSessionId  跨会话接续入口 (WP2). 提供时, 以该会话的持久状态
 *                (情绪 / 阻抗 / 移情) 作为本场初始状态; 省略 = 全新会话.
 *                契约本期就留, 是为了 WP2 落地时**不改已发布的端口签名**.
 */
export interface OpenEngineSessionInput {
  /** 会话主键. 必传, 非空. */
  readonly sessionId: string;
  /** 租户隔离键. 必传, 非空. */
  readonly tenantId: string;
  /** 来访者角色 id. 必传, 非空. */
  readonly visitorId: string;
  /** 可复现性种子. 省略则由内核生成. */
  readonly seed?: number;
  /** 跨会话接续来源会话 id (WP2). 省略 = 全新会话. */
  readonly resumeFromSessionId?: string;
}

/**
 * 会话句柄.
 *
 * `handleId` 是**内核运行时实例标识**, 与业务侧 `sessionId` 是两个概念:
 *   - sessionId 是持久化维度 (状态 / 记忆按它归档);
 *   - handleId 是运行时维度 (进程内句柄表按它索引).
 * 两者分开, 是为了将来多实例部署时 handleId 可以带实例前缀而不污染 sessionId 语义.
 */
export interface EngineSessionHandle {
  /** 内核运行时句柄 id. */
  readonly handleId: string;
  /** 业务会话 id (与 openSession 入参一致). */
  readonly sessionId: string;
}

/**
 * 单轮入参.
 *
 * WP0 只需"咨询师这一轮说了什么"; 事件分类 (共情 / 评判 / 触发) 属 WP1 的算子,
 * 由内核从文本内部推导, 不由 adapter 预判 —— 否则"事件分类"这套语义会泄漏到传输层.
 */
export interface EngineTurnInput {
  /** 咨询师本轮文本 (ASR final). 空白视为非法入参. */
  readonly userText: string;
  /** 链路 trace id, 仅用于可观测 (日志 / 指标关联), 不参与内核决策. */
  readonly traceId?: string;
  /** 中断信号 (语音侧 barge-in). 已触发时内核抛 ABORTED, 不产生状态变更. */
  readonly signal?: AbortSignal;
}

/**
 * 单轮出参.
 *
 * WP0 阶段 `reply` 恒为空串 (语言渲染属 WP5), `snapshot` 为本轮结束后的状态.
 * 形状先定死, WP1/WP5 只往里填值, 不改契约.
 */
export interface EngineTurnOutput {
  /** 本轮渲染文本. WP0 占位恒为 '' (渲染引擎属 WP5). */
  readonly reply: string;
  /** 本轮结束后的 BDI 状态快照 (调用方拿到的已是副本, 可安全持有). */
  readonly snapshot: BdiSnapshot;
  /** 本会话累计轮次 (从 1 起). 用于日志 / 编排对齐, 不参与内核决策. */
  readonly turnIndex: number;
}

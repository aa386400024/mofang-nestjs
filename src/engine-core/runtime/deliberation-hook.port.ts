// V2026-11-08 治本 (R9 · 引擎内核 · 审议钩子端口):
//   职责: 定义"审议可以修正规则 delta"这个**可替换外部能力**的接口形状 ——
//         内核只依赖这个接口, 不关心审议跑在哪 (适配层 / 队列 / 未来的独立服务).
//   边界: 纯 TS, 零 @nestjs/* / typeorm. 本文件**不含任何实现**, 也不含网络代码.
//
//   为什么要在内核加这个口 (而不是让适配层改快照):
//     内核 `turn()` 是**状态落库的唯一入口** —— 适配层拿到的是落库**之后**的快照,
//     想让审议结果生效, 就必须有一道"在落库前改 delta"的口子. 没有这道口子,
//     "审议生效" 只能靠"落库后再改一次快照"实现, 那会破坏"一轮一次落库"的不变量
//     (版本号会跳两跳, 乐观锁语义变味).
//     端口是最小的那道口子: 内核多一个**可选**依赖, 不注入 = 行为逐字不变.
//
//   ⚠️ **同步端口, 不是 async** (这是本文件最重要的设计决策):
//     审议要调 LLM (网络往返, 秒级). 若端口是 async, 内核 `turn()` 就必须 await
//     一个外部调用 —— 语音对练每轮多等一个 LLM 往返, 实时对话直接崩.
//     所以: **审议在适配层异步跑, 结果缓存起来; 内核这边同步地问一句"有没有现成的
//     建议"**. 内核只读缓存, 不等网络. 代价是建议**滞后一轮** (第 N 轮的审议建议
//     在第 N+1 轮生效) —— 这个偏移是刻意的, 写进了本端口的契约说明.
//
//   失败语义 (与 `RiskProbePort` 同款纪律):
//     端口**不承诺一定给出建议**. 审议失败 / 超时 / 格式非法 / 过期 / 临床标记,
//     一律返回 `null` (或抛错) —— 调用方 (内核) 兜住并**回退规则 delta**.
//     把"失败"留给调用方处理, 是端口设计里最容易做错的一环: 一个假设自己永远
//     成功的依赖, 会把网络抖动直接变成会话失败.
//
//   零回归: 内核不注入本端口时, 第 5.5 步整段跳过 —— 决策链与改造前**逐字一致**.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/r9-deliberation-hook.spec.ts 覆盖 "不注入 = 逐字不变" /
//        "注入后建议生效" / "端口抛错 → 回退规则 delta"
//     3. test/engine-core/boundary.spec.ts 全绿 (本文件要登记进内核文件清单)

import type { DeltaVector } from '../cognition/state-transition.js';
import type { BdiSnapshot } from '../domain/bdi-snapshot.js';

/**
 * 审议钩子的调用上下文.
 *
 * ⚠️ 这里**刻意不含** "来访者本轮回应" (visitorText):
 *     审议 prompt 需要它, 但内核 `turn()` 跑在**渲染之前** —— 来访者的话那时候
 *     还不存在. 适配层那边用**上一轮**的来访者回应顶上 (见 `deliberation-prompt.ts`
 *     的同名说明). 内核不该知道这个补偿逻辑, 所以这个字段根本不存在.
 */
export interface DeliberationHookContext {
  /** 本轮**开始时**的 BDI 快照 (审议基于它给出建议). */
  readonly snapshot: BdiSnapshot;
  /** 本轮规则算子算出的 delta (已过 cap) —— 审议建议是**相对它**的修正. */
  readonly ruleDelta: DeltaVector;
  /** 本轮咨询师说的话 (审议的主要输入). */
  readonly counselorText: string;
  /** 归属三件套 (适配层据此定位缓存 / 追溯). */
  readonly tenantId: string;
  readonly sessionId: string;
  /** 本轮轮次号 (从 1 起). */
  readonly turnIndex: number;
  /**
   * 本轮**依据的状态记录版本号**.
   *
   * ⚠️ **为什么内核要把版本号交给适配层**:
   *     审议是**异步**的 —— 建议算完时状态可能已经变了 (会话恢复 / 别的进程改了状态 /
   *     上一轮的建议被压后了). 适配层要判"这份建议还作数吗", 就得知道内核**当下**
   *     看到的是第几版. 这个字段就是那把尺子.
   *
   *     ⚠️ **版本号在"状态记录"上, 不在"快照"上** —— `BdiSnapshot` 刻意不带 revision
   *       (那是持久化记录的职责, 见 `bdi-snapshot.ts` 的说明). 内核取的是本轮**开始时**
   *       载入的那条 `BdiStateRecord` 的版本.
   *
   *     口径 (与 `llm-deliberation.service.ts` 的 `checkStale` **同锚**):
   *     本字段 = 本轮**开始时**载入的版本 (= 上一轮**落库后**的版本, 即 R1).
   *     适配层算建议时记下的"基准版本"必须与它**相等**, 否则建议作废.
   *
   *     ⚠️ 内核**不判**过期 —— 判据在适配层 (它才知道建议怎么算的).
   *        内核只负责把"当下的版本号"如实报出去.
   */
  readonly currentRevision: number;
}

/**
 * 审议建议 (**稀疏**补丁) —— 只含模型明确提到的维度.
 *
 * ⚠️ **为什么是稀疏的, 不是完整的 DeltaVector**:
 *     审议模型通常只对**它有话说**的 2-3 个维度给建议, 其余维度它不提.
 *     若内核把返回值当成"完整 delta"整体替换, 未提及的维度会被**清零** ——
 *     规则算子那轮辛苦算出来的情绪 / 阻抗 / 移情变化会凭空消失.
 *     所以内核的合并语义是"**在规则 delta 之上逐维覆盖**":
 *     建议里没提到的维度 = 保留规则算子的值.
 *
 * 键必须是内核 delta 的合法维度名 —— 适配层负责校验 (非法维度在进内核前就被丢掉).
 */
export type DeliberationDeltaPatch = Readonly<Partial<DeltaVector>>;

/**
 * 审议钩子 (可注入的 delta 修正口).
 *
 * 契约:
 *   · 返回 `null` = 没有可用建议 → 调用方用规则 delta;
 *   · 返回补丁 = **在规则 delta 之上逐维覆盖** (未提及的维度保留规则值);
 *   · 抛错 = 审议炸了 → 调用方回退规则 delta.
 *   三条路径殊途同归: **主流程永远不因为审议而失败**.
 *
 * ⚠️ **同步** —— 内核不 await 任何外部调用 (见文件头"同步端口"一节).
 */
export interface DeliberationHookPort {
  /**
   * 取本轮可用的审议建议.
   *
   * @param context 本轮上下文 (快照 / 规则 delta / 咨询师文本 / 归属 / 轮次)
   * @returns 稀疏补丁 (只含要覆盖的维度); `null` = 无建议 (用规则 delta)
   */
  applyDeliberation(context: DeliberationHookContext): DeliberationDeltaPatch | null;
}

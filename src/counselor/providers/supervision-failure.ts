// V2026-10-26 治本 (督导失败分类 — 永久性 vs 可重试, spec 任务 C):
//   原因: 4 流派反馈是**异步** BullMQ job, 失败默认按 `attempts: 3` 指数退避重试.
//     但有一类失败是**重试也不会变好**的:
//       · 流派缺种子 (supervision_schools 表空 / 该 code 未播种) → 重试 3 次还是找不到
//       · 会话不存在 / 不属于该用户 → 重试 3 次还是不存在
//       · 会话没有对话记录 (空 transcript) → 重试 3 次还是空的
//     这类失败重试的代价是: 刷 3 遍错误日志 + 拖 3 次退避 (秒级~十秒级) + 队列里堆失败 job.
//     而"流派缺种子"是**本轮真实发生过**的 (表建了没播种) —— 它把日志刷成了噪音,
//     反而让真正的故障更难被发现.
//   修法: 把失败分成两类:
//     - **永久性** (重试无意义) → 记一条 warn, 优雅结束 job (该流派反馈留空)
//     - **瞬时性** (重试有意义, 如 LLM 上游不可用 / 网络抖动) → 照旧抛出去, 交给 BullMQ 退避重试
//   反双胞胎:
//     - 不把**所有**异常都吞掉: LLM 上游不可用正是重试最有价值的场景, 吞掉就等于放弃可用性
//     - 不用 error 级别记永久性失败: 它不是故障, 是"这一份流派反馈没有" —— warn 即可
//     - 不在 processor 里散落 if 判断: 分类口径集中在这一个纯函数, 可单测 (retriable 判错
//       的代价是"该重试的不重试"或"不该重试的刷日志")
//   验证:
//     1. tsc 0 错
//     2. 流派缺种子 → 1 条 warn, job completed, 无重试
//     3. LLM 上游不可用 → 仍抛出去, BullMQ 重试 3 次
//   时间戳: 2026-10-26

import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * 判断督导反馈失败是不是**永久性**的 (重试也不会变好).
 *
 * 永久性的三种 (与 `SupervisionService.generateFeedback` 的抛错点 1:1):
 * - `NotFoundException`   流派缺种子 / 会话不存在
 * - `BadRequestException` 会话没有对话记录 / 参数不合法
 *
 * **不包括** `ServiceUnavailableException` (LLM 上游不可用) —— 那是瞬时故障, 重试有意义.
 *
 * @param err 捕获到的异常
 * @returns true = 永久性失败 (不该重试)
 */
export function isPermanentSupervisionFailure(err: unknown): boolean {
  return err instanceof NotFoundException || err instanceof BadRequestException;
}

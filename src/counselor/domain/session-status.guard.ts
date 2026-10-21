// V2026-10-21 治本 (V1.2 VS-A — training session 5 态迁移守卫):
//   原因: v1.2 §10.1 第 4 项「初访分流 (单次结束 / 暂存 / 转长程)」跟 §11.3「暂停休息」都要求
//     服务端能判断状态迁移合法性. V1.1 §4.2.7 只定义了 TrainingSessionStatus 5 态
//     (idle/listening/thinking/speaking/finished), **没有定义谁可以迁到谁**.
//     如果把迁移规则写进 controller 的 if 里, 后面 3 个消费方 (client PATCH / BullMQ 收尾
//     processor / 长程转档 service) 会出现 3 份不一致的判断 → 状态机漂移.
//   修法: 把迁移表做成**纯函数模块** (无 DI / 无 Nest 依赖), 单一真值源:
//     - TRAINING_SESSION_TRANSITIONS: 状态 → 允许的目标状态集合
//     - checkSessionTransition(from, to): 返回 { allowed } 或 { allowed:false, reason }
//     - isTerminalSessionStatus(status): 是否终态 (终态不可再迁出)
//   迁移表按 V0.5 client 的真实对话时序推导 (client TrainingSession 1:1 wire):
//     idle      → listening            (用户开口 / client 调 voice.start)
//     listening → thinking             (ASR final, 文本已提交)
//     thinking  → speaking             (LLM 产出, 开始 TTS)
//     thinking  → listening            (LLM 报错回退, 重新听用户说话)
//     speaking  → listening            (TTS 播完, 下一轮)
//     任意非终态 → finished            (用户主动结束 / 超时收尾 / 转长程归档)
//   反双胞胎:
//     - 不加 paused / abandoned 态: V1.1 §4.2.7 明确「V0.5 stage UI 状态机不需要 pause」,
//       中断 = InterruptVisitor event 走 speaking → idle, 不走 paused (保持 1:1 wire)
//     - 不在 controller 里写 if 判断: 单一真值源, 3 个消费方复用
//     - 不用 class + 依赖注入: 纯函数更好测, 不引入 Nest 依赖
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 PATCH /counselor/training-sessions/:id/status:
//        - idle → listening → 200
//        - idle → speaking → 400 (非法迁移, 返 reason)
//        - finished → listening → 400 (终态不可迁出)
//   时间戳: 2026-10-21

import { TrainingSessionStatus } from '../enums/training-session-status.enum';

/**
 * 状态迁移表: 源状态 → 允许的目标状态集合.
 *
 * finished 是唯一终态 (值为空数组 = 不可迁出).
 */
export const TRAINING_SESSION_TRANSITIONS: Readonly<Record<TrainingSessionStatus, readonly TrainingSessionStatus[]>> = {
  [TrainingSessionStatus.IDLE]: [TrainingSessionStatus.LISTENING, TrainingSessionStatus.FINISHED],
  [TrainingSessionStatus.LISTENING]: [TrainingSessionStatus.THINKING, TrainingSessionStatus.FINISHED],
  [TrainingSessionStatus.THINKING]: [TrainingSessionStatus.SPEAKING, TrainingSessionStatus.LISTENING, TrainingSessionStatus.FINISHED],
  [TrainingSessionStatus.SPEAKING]: [TrainingSessionStatus.LISTENING, TrainingSessionStatus.FINISHED],
  [TrainingSessionStatus.FINISHED]: [],
};

/** 迁移检查结果. */
export type SessionTransitionCheck = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * 是否终态 (不可再迁出).
 *
 * @param status 当前状态
 */
export function isTerminalSessionStatus(status: TrainingSessionStatus): boolean {
  return TRAINING_SESSION_TRANSITIONS[status].length === 0;
}

/**
 * 校验一次状态迁移.
 *
 * @param from 源状态
 * @param to 目标状态
 * @returns allowed=true 表示可迁; allowed=false 时带人话 reason (直接返给 client 展示)
 */
export function checkSessionTransition(from: TrainingSessionStatus, to: TrainingSessionStatus): SessionTransitionCheck {
  if (from === to) {
    return { allowed: false, reason: `状态已是 ${from}, 无需重复迁移` };
  }
  if (isTerminalSessionStatus(from)) {
    return { allowed: false, reason: `状态 ${from} 是终态, 不可再迁移` };
  }
  const allowedTargets = TRAINING_SESSION_TRANSITIONS[from];
  if (!allowedTargets.includes(to)) {
    return {
      allowed: false,
      reason: `非法状态迁移 ${from} → ${to}, 允许的目标状态: ${allowedTargets.join(' / ')}`,
    };
  }
  return { allowed: true };
}

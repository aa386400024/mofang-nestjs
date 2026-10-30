// V2026-10-28 治本 (WP6 · B 层 · 渲染主备运行时):
//   职责: 持有每个候选的**运行时健康状态** (连续失败计数 / 冷却到期时刻),
//         每轮回答"下一个该调谁"; 冷却过滤、失败记账、指数退避、健康恢复
//         切回主, 都在这里.
//   边界: 纯 TS + 可注入时钟, 零网络. "选谁"最终仍走内核纯函数
//         selectFailoverTarget —— 本文件只负责**过滤与记账**.
//
//   为什么"选谁"不能在本文件自己写一遍:
//     WP5 已经把"按当前记录下一个选谁"抽成内核纯函数 selectFailoverTarget,
//     并明确定位: 内核给选择, 适配层给冷却/退避/计时. 若这里再写一遍遍历,
//     就出现两份"谁是下一个"的真相 —— 将来改优先级口径要改两处, 而两处
//     必然漂移, 且漂移方向恰好是"适配层选了个内核没认的候选".
//     所以本文件只做内核做不了的两件事: 剔除冷却中的候选、记账.
//
//   反双胞胎:
//     - 不重排候选: 冷却过滤是**剔除**而不是排序; 剩余候选保持原顺序,
//       于是"冷却到期 → 主回到第 0 位被优先选中"是自然结果, 不需要额外逻辑.
//     - 冷却到期不清零连续失败计数: 计数由**成功**清零 (markSuccess).
//       若到期就清零, 指数退避永远停在第一档, 持续故障的候选会以固定间隔
//       被反复唤醒 —— 退避就白做了. 成功才清零 = "真的恢复了才恢复额度".
//     - 不自己实现退避公式的边界: 封顶用 cooldownMaxMs 夹取, 避免
//       2^(n-1) 溢出成 Infinity.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp6-llm-render.spec.ts 覆盖选主/冷却过滤/退避/恢复切回

import type { RenderAdapterConfig, RenderCandidate } from './render-adapter.config';
import { selectFailoverTarget, type FailoverState } from '../../engine-core';

/**
 * 候选运行时状态 (适配层持有, 内核不存).
 */
interface CandidateRuntime {
  /** 连续失败次数 (成功清零). */
  consecutiveFailures: number;
  /** 冷却到期时刻 (0 = 不在冷却); 到点后候选重新可被选中. */
  cooldownUntil: number;
}

/**
 * 候选健康快照 (供观测/日志; 不参与选择判定).
 */
export interface RenderCandidateHealth {
  readonly consecutiveFailures: number;
  readonly cooldownUntil: number;
  /** 是否当前处于冷却中. */
  readonly inCooldown: boolean;
}

/**
 * 渲染主备运行时.
 *
 * 线程/并发说明: 状态是**实例内**的 (适配器实例 = 进程内一份主备健康度).
 * 任务单 §7 明确本期不做会话级隔离; 并发渲染共享同一份冷却状态是刻意的 ——
 * "这个 provider 刚刚挂了"是**provider 级**事实, 不是会话级事实.
 */
export class RenderFailoverRuntime {
  private readonly candidates: readonly RenderCandidate[];
  private readonly now: () => number;
  private readonly states = new Map<string, CandidateRuntime>();

  /**
   * @param candidates 候选序列 (顺序即优先级, 第 0 位为主)
   * @param now 可注入时钟 (单测用假时钟推进冷却, 不等真实时间)
   */
  constructor(candidates: readonly RenderCandidate[], now: () => number = Date.now) {
    this.candidates = candidates;
    this.now = now;
  }

  /**
   * 本轮下一个候选: 剔除冷却中的候选后, 把剩余序列交给内核纯函数选择.
   *
   * @param attempted 本轮已尝试过的候选 id
   * @returns 下一个候选; 全部冷却 / 全部尝试过 → null (调用方走最终降级)
   */
  next(attempted: readonly string[]): RenderCandidate | null {
    const available = this.candidates.filter((candidate) => !this.inCooldown(candidate.id));
    if (available.length === 0) return null;

    const state: FailoverState = {
      candidates: available.map((candidate) => ({ id: candidate.id })),
      attempted,
      consecutiveFailures: this.failureSnapshot(),
    };
    const target = selectFailoverTarget(state);
    if (!target) return null;

    // 内核按 id 返回, 这里按 id 映射回完整候选 (含 overrides).
    return available.find((candidate) => candidate.id === target.id) ?? null;
  }

  /**
   * 成功: 清零该候选的连续失败计数与冷却 (真的恢复了才恢复额度).
   *
   * @param id 候选 id
   */
  markSuccess(id: string): void {
    const state = this.stateOf(id);
    state.consecutiveFailures = 0;
    state.cooldownUntil = 0;
  }

  /**
   * 失败: 累加计数, 达阈值按指数退避置冷却.
   *
   * @param id 候选 id
   * @param config 退避参数 (基数 / 上限 / 阈值)
   */
  markFailure(id: string, config: RenderAdapterConfig): void {
    const state = this.stateOf(id);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures < config.failureThreshold) return;
    state.cooldownUntil = this.now() + cooldownDuration(config, state.consecutiveFailures);
  }

  /**
   * 候选健康快照 (观测用; 不参与选择判定).
   */
  health(): Readonly<Record<string, RenderCandidateHealth>> {
    const snapshot: Record<string, RenderCandidateHealth> = {};
    for (const candidate of this.candidates) {
      const state = this.states.get(candidate.id);
      snapshot[candidate.id] = {
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        cooldownUntil: state?.cooldownUntil ?? 0,
        inCooldown: this.inCooldown(candidate.id),
      };
    }
    return snapshot;
  }

  /** 该候选是否处于冷却中 (到期即失效, 候选重新回到序列). */
  private inCooldown(id: string): boolean {
    const state = this.states.get(id);
    if (!state) return false;
    return state.cooldownUntil > this.now();
  }

  /** 取 (或建) 候选运行时状态. */
  private stateOf(id: string): CandidateRuntime {
    const existing = this.states.get(id);
    if (existing) return existing;
    const created: CandidateRuntime = { consecutiveFailures: 0, cooldownUntil: 0 };
    this.states.set(id, created);
    return created;
  }

  /** 各候选连续失败计数快照 (随状态一起交给内核, 内核不用它做判定). */
  private failureSnapshot(): Readonly<Record<string, number>> {
    const snapshot: Record<string, number> = {};
    for (const [id, state] of this.states) {
      snapshot[id] = state.consecutiveFailures;
    }
    return snapshot;
  }
}

/**
 * 冷却时长 = cooldownBaseMs * 2^(连续失败-1), 封顶 cooldownMaxMs.
 *
 * 指数退避的意义: 持续故障的 provider 若只等固定冷却, 会被按固定节奏反复唤醒,
 * 每次都失败, 白白吃掉一整轮主备切换; 退避让故障 provider 的重试越来越稀疏,
 * 把调用机会让给还活着的候选.
 *
 * 封顶的意义: 失败次数无上限时 2^(n-1) 会溢出成 Infinity, 冷却时长变成"永久",
 * 候选再也回不来 —— 那是把"临时故障"写成"永久下线", 失败方向不安全.
 */
function cooldownDuration(config: RenderAdapterConfig, consecutiveFailures: number): number {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const raw = config.cooldownBaseMs * 2 ** exponent;
  return Math.min(raw, config.cooldownMaxMs);
}

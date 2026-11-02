// V2026-10-28 治本 (WP5 · 引擎内核 · 主备容灾选择):
//   职责: 给定候选序列与已尝试记录, 回答"下一个该选谁"; 全部尝试过则返回 null.
//         纯函数, 无 IO, 无定时器, 无时钟, 无随机.
//   边界: 只做**选择**; 真实重试 / 退避 / 冷却 / 恢复切回属适配层运行时.
//
//   为什么内核只给"选谁"而不给"怎么重试":
//     "失败几次切备""冷却多久""指数退避""健康后切回主"这四件事都需要**时钟**与
//     **有状态计时**; 放进内核就等于内核要读时间、要在测试里等真实时间过去 ——
//     纯函数做不到可测可复现. 而"按当前记录下一个选谁"是纯推导, 可以被单测锁死.
//
//   反双胞胎:
//     - 候选序列顺序即优先级: 第 0 位是主, 后面是备 —— 适配层与内核对"谁是主"的
//       理解必须一致, 所以顺序**只由适配层给**, 内核不重排、不按健康度排序
//       (按健康度排就等于把冷却/恢复逻辑偷偷搬进内核了).
//     - 状态由适配层持有, 内核不存: 状态放内核就意味着内核有了跨调用的可变状态,
//       整包搬走后没法多实例部署.
//     - "已尝试"按 id 判定, 不按下标: 候选列表可能被适配层动态调整, 按下标会张冠李戴.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-core/wp5-rendering.spec.ts 覆盖选主/切备/耗尽

/**
 * 一个可服务候选 (适配层提供; 内核只做选择).
 */
export interface FailoverCandidate {
  readonly id: string;
}

/**
 * 容灾状态 (纯数据, 由适配层持有; 内核函数只做纯推导).
 */
export interface FailoverState {
  /** 候选序列, 第 0 位为主. */
  readonly candidates: readonly FailoverCandidate[];
  /** 已尝试过的候选 id (按尝试顺序). */
  readonly attempted: readonly string[];
  /**
   * 各候选连续失败计数 (无记录 = 0).
   *
   * 本函数**不用**它做选择 (阈值 / 冷却 / 退避属适配层), 但它随状态一起带过来:
   * 适配层做冷却判定时需要它, 而"状态"就该是状态的完整样子 —— 只挑内核当下用得上的
   * 字段传过来, 等于让内核与适配层各持一份不同的真相.
   */
  readonly consecutiveFailures: Readonly<Record<string, number>>;
}

/**
 * 选择下一个候选: 主失败后按序列切备; 全部尝试过 → 返回 null (exhausted, 适配层降级).
 *
 * 纯函数, 无 IO / 无定时器 / 无冷却; 真实重试、退避、恢复切回由适配层实现.
 *
 * @param state 当前容灾状态
 * @returns 下一个候选; 全部尝试过返回 null
 */
export function selectFailoverTarget(state: FailoverState): FailoverCandidate | null {
  const attempted = new Set(state.attempted);
  for (const candidate of state.candidates) {
    if (!attempted.has(candidate.id)) return candidate;
  }
  return null;
}

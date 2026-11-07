// V2026-11-07 治本 (degraded 会话打标 · 判定规则 · 纯函数):
//   原因: 任务单 `docs/worklog/completed/phase2/session-degraded-flag-2026-11-07.md`
//     §4.2 拍板「会话结束时一次性判定: 失败率 > 30% **或** 连续失败 >= 3 轮 → 打标」.
//     判定是**纯计算** (无 IO / 无 ORM / 无 prompt) → 必须能脱离 Nest 容器单测,
//     不能埋在 service 的 IO 流程里 (那种地方看不出阈值到底对不对).
//
//   **失败轮次的定义 (本单由后端拍板 —— 任务单 §4.4 明说由后端确认)**:
//     失败轮次 = **渲染降级轮次** —— 本轮 AI 来访者说出的是**系统兜底句**, 不是真实回应.
//
//   为什么不是别的 (三条排除, 每条都有理由):
//     · **伦理阻断轮次不算失败**: 那是安全机制**正常工作** (该拦的拦住了) ——
//       它是伦理正贡献, 不是「坏」. 把它算成失败 = 把安全机制打成了故障.
//     · **引擎异常轮次不算失败**: 引擎彻底抛错时, 该轮**根本不进评估台账**
//       (engine-stream-backend.adapter.ts 的 settled.ok 分支直接 return) ——
//       它**没有污染考核数据**, 没污染的东西不需要过滤.
//     · **审议层失败不算失败**: 审议目前是**影子模式** (结果从不生效) ——
//       审议 LLM 超时 / 熔断, 学员这一场**体验完全正常**, 评估完全可信.
//       把它算成失败 = 把好会话从考核里踢掉, 比不打标更糟.
//       (WP67 母版里的「降级状态标记」原指审议层降级; 影子模式下那个口径会误伤好会话,
//        本单按「这场会话到底坏没坏」重新定义 —— 详见交付记录 §三 偏差表.)
//
//   **两条规则的优先级**: 规则 2 (连续失败) **优先于** 规则 1 (失败率).
//     理由: 规则 2 是**特异形态** (中途卡死), 规则 1 是**一般统计** (整体质量差).
//     特异形态诊断力更强; 且任务单 §4.2 给规则 2 的例子
//     (「前 5 轮正常, 后 3 轮连续失败」= 8 轮里 3 轮失败 = 37.5% > 30%)
//     **同时命中两条规则** —— 只有规则 2 优先, 那条例子才落进 consecutive_failures.
//
//   **严格大于**: 失败率阈值是**严格大于** 30% (正好 30% 不打标).
//     比较用**整数交叉相乘** (failed * 10 > total * 3) 而不是浮点除法 ——
//     浮点会引入「3/10 和 0.3 到底是不是同一个数」的隐患, 整数比没有这个问题.
//
//   反双胞胎:
//     - 不在 service 里写判定: 规则只有这一份, service 只负责「取数 → 落库」;
//     - 不实时打标: 只有会话结束的**一次性**判定入口;
//     - 不自动恢复: degraded 是终态 (会话结束后不变);
//     - 不含心理内容: 只出计数与原因码, 不出任何对话原文.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/counselor/session-degraded.spec.ts 覆盖两条规则 + 边界 + 优先级
//
//   时间戳: 2026-11-07

/**
 * degraded 打标原因码 (落库到 `training_sessions.degraded_reason`).
 *
 * 为什么是**字符串码**而不是数字: 这列是给排障 / 报表看的 ——
 *   数字要查表才知道是什么, 字符串看一眼就懂 (与仓库既有 `circuit_open` 错误码同款口径).
 */
export type SessionDegradedReason = 'high_failure_rate' | 'consecutive_failures';

/**
 * 失败率阈值的分子 (3/10 = 30%).
 */
export const SESSION_DEGRADED_FAILURE_RATE_NUMERATOR = 3;

/**
 * 失败率阈值的分母 (3/10 = 30%).
 */
export const SESSION_DEGRADED_FAILURE_RATE_DENOMINATOR = 10;

/**
 * 连续失败轮次阈值 (连续失败达到这么多轮 → 打标).
 */
export const SESSION_DEGRADED_CONSECUTIVE_THRESHOLD = 3;

/**
 * 一轮会话的失败标记 (只看「这一轮是不是坏的」, 不看别的).
 */
export interface SessionDegradedTurnLike {
  /** 本轮是否失败 (渲染降级). 缺省 = 不失败. */
  readonly degraded?: boolean;
}

/**
 * 判定结果 (判别联合: degraded 为 true 时 reason 一定有值).
 */
export type SessionDegradedVerdict =
  | {
      readonly degraded: false;
      readonly reason: null;
      readonly totalTurns: number;
      readonly failedTurns: number;
      readonly failureRate: number;
      readonly maxConsecutiveFailures: number;
    }
  | {
      readonly degraded: true;
      readonly reason: SessionDegradedReason;
      readonly totalTurns: number;
      readonly failedTurns: number;
      readonly failureRate: number;
      readonly maxConsecutiveFailures: number;
    };

/**
 * 判定一场会话要不要打 degraded 标.
 *
 * 规则 (满足任一即打标):
 *   1. 失败率 **严格大于** 30% (整数交叉相乘: failed * 10 > total * 3);
 *   2. **最大连续失败** >= 3 轮.
 *
 * 规则 2 优先于规则 1 (特异形态优先于一般统计).
 *
 * @param turns 逐轮失败标记 (按轮次升序)
 * @returns 判定结果
 */
export function evaluateSessionDegraded(turns: readonly SessionDegradedTurnLike[]): SessionDegradedVerdict {
  const totalTurns = turns.length;
  let failedTurns = 0;
  let currentRun = 0;
  let maxConsecutiveFailures = 0;
  for (const turn of turns) {
    if (turn.degraded === true) {
      failedTurns += 1;
      currentRun += 1;
      if (currentRun > maxConsecutiveFailures) maxConsecutiveFailures = currentRun;
    } else {
      currentRun = 0;
    }
  }
  const failureRate = totalTurns === 0 ? 0 : failedTurns / totalTurns;
  const base = {
    totalTurns,
    failedTurns,
    failureRate,
    maxConsecutiveFailures,
  };

  // 规则 2 先判: 连续失败是**特异形态** (中途卡死), 诊断力强于一般统计.
  if (maxConsecutiveFailures >= SESSION_DEGRADED_CONSECUTIVE_THRESHOLD) {
    return { ...base, degraded: true, reason: 'consecutive_failures' };
  }
  // 规则 1: 严格大于 —— 正好 30% 不打标.
  if (failedTurns * SESSION_DEGRADED_FAILURE_RATE_DENOMINATOR > totalTurns * SESSION_DEGRADED_FAILURE_RATE_NUMERATOR) {
    return { ...base, degraded: true, reason: 'high_failure_rate' };
  }
  // 一轮都没跑 → 没有事实 → 不打标 (与「空场次不写 0 分」同款口径).
  return { ...base, degraded: false, reason: null };
}

// V2026-10-22 治本 (V1.3 §8.5 C1 — 练习 LLM 开关拆成「评判」与「生成」两个口径):
//   原因: spec §8.5 C1 原文「`PRACTICE_LLM_EVALUATION=off` 只关闭 §3.3 评判 LLM
//     (`evaluateWithLlm`); `generateVisitorReaction` (P2 来访者反应) 与 `generateScenario`
//     (§3.5 场景生成) **不读开关**, 仍直接调 LLM」.
//     这是运维口径事故: 运维把 `PRACTICE_LLM_EVALUATION=off` 理解为"把练习引擎的
//     LLM 成本关掉", 实际只关掉了 1/3 的调用量, 生成链路照旧烧钱.
//   修法: 拆成两个**语义正交**的开关, 各自覆盖明确的调用面, 并把覆盖面写进常量名:
//     - PRACTICE_LLM_EVALUATION  : §3.3 评判 (evaluateWithLlm)
//                                 —— 关掉后走确定性关键词路径, 接口形状不变
//     - PRACTICE_LLM_GENERATION  : P2 来访者反应 (generateVisitorReaction)
//                                 + §3.5 / §7.2 场景生成 (generateScenario)
//                                 —— 关掉后走模板降级, 详见 practice-custom-scenario.config.ts
//     两个开关缺省都是 on, 保持既有行为; 置 off 时**不发起任何对应调用**.
//
//   反双胞胎:
//     - 不改全局 LLM 开关: 会影响督导/知情同意/人设生成等其它 counselor 场景
//     - 不把两个开关合成一个 + 一个 mode 字符串: 那等于把"关哪个"的选择推迟到
//       运维读文档, 而运维出错的成本正是本次要消除的
//     - 不用"一个总开关 + 一个例外白名单": 白名单会被后人扩成第二个总开关
//     - 不在缺省时读配置报错: 缺省 on = 保持既有行为, 缺省 off 会让所有人
//       静默失去 LLM 能力而没人发现
//
//   验证:
//     1. tsc 0 错
//     2. env PRACTICE_LLM_EVALUATION=off → 提交作答不产生 LLM 调用, 批注走关键词路径
//     3. env PRACTICE_LLM_GENERATION=off → 场景生成不产生 LLM 调用, 走模板降级
//     4. 两个开关互不影响 (关一个另一个照常)
//
//   时间戳: 2026-10-22

/** 练习**评判** LLM 开关的 env 键 (覆盖 §3.3 evaluateWithLlm). */
export const PRACTICE_LLM_EVALUATION_ENV_KEY = 'PRACTICE_LLM_EVALUATION';

/**
 * 练习**生成** LLM 开关的 env 键.
 *
 * 覆盖面: P2 来访者反应 (§3.3 的 visitorReaction) + §3.5 / §7.2 场景生成.
 * 与评判开关**正交**: 关掉生成不影响评判, 关掉评判不影响生成.
 */
export const PRACTICE_LLM_GENERATION_ENV_KEY = 'PRACTICE_LLM_GENERATION';

/** 练习评判 LLM 开关的缺省值 (缺省走 LLM 主路径, 失败自动降级). */
export const PRACTICE_LLM_EVALUATION_DEFAULT = 'on';

/** 练习生成 LLM 开关的缺省值 (缺省走 LLM 主路径, 失败自动降级). */
export const PRACTICE_LLM_GENERATION_DEFAULT = 'on';

/**
 * 语音微训练的专业语速区间 (字/分).
 *
 * spec §1.1 语音微训练的目标: 「稳定在每分钟 120-140 字」. 该区间同时用于:
 *   - 评判时的语速技术批注 (evaluator)
 *   - 落库时的 speech_rate_wpm 折算口径说明 (attempt service)
 * 放在 config 里而不是各 service 内, 避免两处各写一份魔数后慢慢漂开.
 */
export const SPEECH_RATE_TARGET_LOW = 120;
export const SPEECH_RATE_TARGET_HIGH = 140;

/**
 * 解析一个 on/off 形态的 env 开关.
 *
 * @param raw env 原始值 (可能为 undefined / 空串)
 * @param defaultValue 缺省值
 * @returns true = 开; false = 关
 */
function parseOnOffSwitch(raw: string | undefined, defaultValue: 'on' | 'off'): boolean {
  if (raw === undefined) {
    return defaultValue === 'on';
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return defaultValue === 'on';
  }
  return normalized !== 'off' && normalized !== 'false' && normalized !== '0';
}

/**
 * 解析练习评判 LLM 开关.
 *
 * @param raw env 原始值 (可能为 undefined / 空串)
 * @returns true = 走 LLM 主路径; false = 直接走确定性路径
 */
export function isPracticeLlmEvaluationEnabled(raw: string | undefined): boolean {
  return parseOnOffSwitch(raw, PRACTICE_LLM_EVALUATION_DEFAULT);
}

/**
 * 解析练习生成 LLM 开关.
 *
 * @param raw env 原始值 (可能为 undefined / 空串)
 * @returns true = 允许发起 LLM 生成调用; false = 走模板降级 (不发起任何调用)
 */
export function isPracticeLlmGenerationEnabled(raw: string | undefined): boolean {
  return parseOnOffSwitch(raw, PRACTICE_LLM_GENERATION_DEFAULT);
}

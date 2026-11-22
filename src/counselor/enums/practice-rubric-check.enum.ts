// V2026-10-22 治本 (V1.3 §2.1 — practice_scenarios.rubric.dimensions[].check 3 档 enum):
//   原因: spec §2.1 的 rubric 是「AI 评判 prompt 的结构化锚点」, 同时也是
//     **P0 降级评判** (LLM 未就绪时) 的确定性判定依据. 同一个维度, 判定方式有 3 种:
//       contains_any  —— 命中 positiveKeywords 即视为该动作达成 (子串匹配)
//       contains_none —— 命中 antiKeywords 即提示越位; 未命中视为该动作达成
//       custom_llm    —— 只能由 LLM 判定 (例如"语气是否平稳"这种无法关键词化的维度)
//     若不显式声明 check, 降级逻辑就得靠"关键词数组是否为空"去猜, 结果是:
//       维度 A 配了 antiKeywords 但没配 positiveKeywords → 降级时无法区分
//       "该维度没做" 与 "该维度做错了".
//   修法: 3 档 enum, 应用层强校验; 降级评判时 custom_llm 维度只产出 ℹ️ 技术提示
//     (不下判定), 不猜、不臆断.
//
//   反双胞胎:
//     - 不引入正则表达式维度 (check: 'regex'): 自由正则既不可校验又不可移植,
//       内容编辑者写错一条正则会让整档评判静默失效; 关键词表是内容编辑者
//       能自己维护的最小充分集
//     - 不用自由字符串 check: 内容库 60 条 × 3-4 维度, 拼写漂移必然发生
//
//   验证:
//     1. tsc 0 错
//     2. 60 条 seed 场景每个维度都有合法 check
//     3. 降级评判路径产出的批注条数 = 维度数 (custom_llm 维度产出 ℹ️ 而非跳过)
//
//   时间戳: 2026-10-22

/**
 * rubric 维度判定方式 3 档 (V1.3 §2.1 拍板).
 */
export enum PracticeRubricCheck {
  /** 命中 positiveKeywords 任一即视为动作达成 */
  CONTAINS_ANY = 'contains_any',
  /** 命中 antiKeywords 任一即提示越位; 未命中视为动作达成 */
  CONTAINS_NONE = 'contains_none',
  /** 只能由 LLM 判定; 降级路径只给 ℹ️ 技术提示 */
  CUSTOM_LLM = 'custom_llm',
}

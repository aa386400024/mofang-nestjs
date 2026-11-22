// V2026-10-22 治本 (V1.3 §2.2 — practice_attempts.feedback.source 产出来源 enum):
//   原因: 评判有两条路径 —— LLM 结构化输出 (P1) 与确定性关键词判定 (P0 降级).
//     两条路径产出的**结构完全一致** (spec §3.3「接口形状不变」), 客户端无需感知切换;
//     但运维与排障需要知道某条批注到底是模型写的还是规则判的 (模型抽风时能定位,
//     也能统计降级率). 故在落库的 feedback JSON 里保留一个来源标记.
//   修法: 定义 PracticeFeedbackSource 2 档 enum, 随 feedback 一起落库与下发.
//   反双胞胎:
//     - 不加"降级原因"字段: 降级原因 (模型没调通 / 产出越界 / 条数不合规) 属于
//       服务端内部观测, 写进用户可见的响应体没有价值, 留在日志里即可
//     - 不用 int: 字符串枚举可读可 diff, 与项目其它 enum 风格一致
//   验证:
//     1. tsc 0 错
//     2. 关掉 LLM 提交一次 → feedback.source = 'keyword'
//     3. LLM 正常时提交一次 → feedback.source = 'llm'
//   时间戳: 2026-10-22

/**
 * 反馈产出来源 2 档 (V1.3 §2.2 落库字段 feedback.source).
 */
export enum PracticeFeedbackSource {
  /** 确定性关键词判定 (LLM 未就绪 / 调用失败 / 产出越界时的降级路径) */
  KEYWORD = 'keyword',
  /** LLM 结构化输出 */
  LLM = 'llm',
}

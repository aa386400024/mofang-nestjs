// V2026-10-27 治本 (零压红线守门 — 提升到 counselor/domain 共享层):
//   原因: 仓库里已有一份"零压禁用词表", 但它是 `practice-evaluator.service.ts` 里的
//     **文件私有 const** —— 任何第二个需要"判断产出里有没有评分/评级/评价人措辞"的
//     模块, 都只能靠**复制一份词表**来实现.
//     复制 = 双胞胎: 两份词表必然漂移 (practice 加了"优秀", drills 没加 → drills 的
//     守门网出现一个洞), 而且这类洞只有在线上真实产出里才会暴露.
//     本期新增 `counselor/drills` (边界压力 + 危机识别演练) 恰好需要同一道守门:
//     LLM 润色出来的批注**必须**被同一张表拦下.
//   修法: 把词表 + 判定函数提升到**中立层** `counselor/domain/zero-pressure.guard.ts`,
//     practice-evaluator 与 drills 两侧都从这里 import.
//     放在 domain/ 而不是 practice/ 或 drills/ 下面, 是因为两侧都已经依赖 domain/,
//     共享物不能属于任何一方 (否则会造成反向依赖).
//   反双胞胎:
//     - 不在 drills 里再写一份词表 (双胞胎漂移, 见上)
//     - 不把它塞进 `common/` (那是跨业务域的通用层; 零压口径是 **counselor 教学域**
//       的专属口径, 放到 common 会让别的域(如 AI 对话)莫名其妙被 counseling 词表约束)
//     - 不改 practice 侧的既有行为: 只是把同一个 const 换成 import, 词表内容一字未动,
//       扫描范围仍只限 `items[].text` (见 practice-evaluator 的 §8.5 D1 决策)
//   验证:
//     1. tsc 0 错
//     2. practice 侧行为不变 (同一批输入 → 同一批降级判定)
//     3. drills 侧: LLM 产出含"得分/及格/你不行" → 整份判废 → 降级到关键词路径
//   时间戳: 2026-10-27 19:30 GMT+8

/**
 * 零压红线**禁用词表**.
 *
 * 命中任意一个 → 该份产出判废 (走确定性降级路径).
 *
 * 词表设计原则: 只收"**语义上必然是评级或评价人**"的词, 不收可能出现在正常
 * 技术描述里的词 (如 "正确" —— "正确地命名情绪" 是正常表述, 收进来会误杀).
 */
export const ZERO_PRESSURE_FORBIDDEN_TOKENS: readonly string[] = [
  '分数',
  '得分',
  '评分',
  '打分',
  '正确率',
  '错误率',
  '及格',
  '通过率',
  '评级',
  '等级',
  '不合格',
  '优秀',
  '太差',
  '很差',
  '你不行',
  '水平不够',
  '加油',
  '有进步',
  '太好了',
];

/**
 * 判断一段文本是否触碰零压红线.
 *
 * @param text 待检查文本 (通常是某一条批注的正文)
 * @returns true = 触碰红线 (该产出应判废)
 */
export function hasZeroPressureViolation(text: string): boolean {
  return ZERO_PRESSURE_FORBIDDEN_TOKENS.some((token) => text.includes(token));
}

/**
 * 批量判断: 任意一条触碰红线即整体判废.
 *
 * 语义与 practice-evaluator 的 `violatesZeroPressure` 完全一致 (任一条命中 → 整份判废,
 * 不做局部清洗 —— 局部清洗会留下"半截越界"的文案).
 *
 * @param texts 待检查的文本清单
 * @returns true = 存在越界项
 */
export function hasZeroPressureViolationIn(texts: readonly string[]): boolean {
  return texts.some((text) => hasZeroPressureViolation(text));
}

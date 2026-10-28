// V2026-10-27 治本 (counselor 域共享 · on/off 开关解析):
//   原因: 仓库里已有一份"on/off 形态 env 开关"的解析函数, 但它是
//     `practice-evaluation.config.ts` 里的**文件私有函数**.
//     任何第二个需要"读一个 on/off env 开关"的模块 (本期新增的 drills 就需要)
//     都只能靠**复制一份**来实现 —— 双胞胎, 两份解析语义必然漂移
//     (比如一份把 'no' 当真, 另一份把 'no' 当假), 而这种漂移表现为
//     "某个环境下 LLM 开关没生效, 却没人知道为什么".
//   修法: 把解析函数提升到**中立层** `counselor/config/env-switch.ts`,
//     practice 与 drills 两侧都从这里 import.
//     放 config/ 而不是某一方目录下: config/ 是两个功能都已经在依赖的公共层,
//     共享物不能归属于任何一方 (否则会造成反向依赖).
//   反双胞胎:
//     - 不在 drills 里再写一份 parseOnOffSwitch (双胞胎漂移, 见上)
//     - 不把它塞进 `common/` (那是跨业务域的通用层; "LLM 开关"是 counselor 教学域的口径)
//     - 不改 practice 侧对外行为: `isPracticeLlmEvaluationEnabled` /
//       `isPracticeLlmGenerationEnabled` 两个导出函数签名与语义一字未动,
//       只是把内部实现换成共享函数 (逐字搬运, 不是重写).
//   验证:
//     1. tsc 0 错
//     2. practice 侧行为不变 (同一批 env 输入 → 同一批判定)
//     3. drills 侧: env DRILL_LLM_EVALUATION=off → 不发起任何 LLM 调用
//   时间戳: 2026-10-27 20:20 GMT+8

/**
 * on/off 形态 env 开关的解析函数 (共享实现).
 *
 * 缺省 / 空串 → 取缺省值; 其余按"不是显式关闭就算开"处理.
 * 显式关闭的字面量: `off` / `false` / `0` (大小写与首尾空白不敏感).
 *
 * @param raw env 原始值 (可能为 undefined / 空串)
 * @param defaultValue 缺省值
 * @returns true = 开; false = 关
 */
export function parseOnOffSwitch(raw: string | undefined, defaultValue: 'on' | 'off'): boolean {
  if (raw === undefined) {
    return defaultValue === 'on';
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) {
    return defaultValue === 'on';
  }
  return normalized !== 'off' && normalized !== 'false' && normalized !== '0';
}

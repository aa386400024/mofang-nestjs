// V2026-10-27 治本 (空会话素材判定 — 纯函数, spec 任务 A):
//   原因: 一场 vpt / 单次训练**没产生有效对话内容**就结束时, 后端无条件派发督导 job →
//     空素材抛永久失败 → 什么都不落库 → 列表把它误判成 `pending` (永久"生成中"),
//     用户看到的是"报告一直生成中", 永远等不到.
//     判定"这场到底有没有可分析的素材"必须有一处**唯一口径**: 列表派生、详情派生、
//     结束前置拦截三处都要用同一个判定, 否则会出现"列表说 no_content、详情说 pending"
//     这种自相矛盾的状态 (学员看到的是两张打架的卡片, 比报错还难排查).
//   修法: 本文件放**纯函数** (无 IO / 不依赖 Nest / 不读 DB):
//     - measureEffectiveMaterial: 逐字稿 → 有效轮数 + 有效字数
//     - isInsufficientMaterial: 有效量 vs 阈值 → 是否"空局"
//     阈值 (minTurns / minChars) 由调用方 (service 层) 从 config 注入, **不写死在判定里**.
//   规则 (任务单 D1/D2 拍板, 勿再改):
//     - 有效轮 = text.trim() 非空
//     - 有效字数 = Σ 非空轮 text.trim().length
//     - 空局 = 有效轮 < minTurns(2) **或** 有效字数 < minChars(30)
//       (两者满足其一即不足 —— 避免"2 轮但每轮 3 个字"被误判成合格)
//   反双胞胎:
//     - 不在 service 的 if 里 inline 算: 三处各算一次必然漂移 (本仓历史 bug 的根因)
//     - 不让纯函数读 DB / 读 config: 一旦有了 IO 就没法单测, 而"空局被误判成合格"
//       恰好是那种**不会抛异常、只会安静地错**的 bug
//     - 不把"素材够不够"和"报告状态"揉成一个函数: 素材判定 (本文件) 是**输入事实**,
//       报告状态派生 (session-core.types.ts) 是**输出结论**, 两层职责不能互相吞掉
//     - 不引入 `weak` (极少素材) 独立态: 任务单 D1 拍板并入 `no_content`
//   验证:
//     1. npx jest test/counselor/session-material.spec.ts 全绿
//     2. 故意把"或"改成"且" → "2 轮共 20 字"用例变红
//   时间戳: 2026-10-27 13:30 GMT+8

/**
 * 有效素材量 (一场会话里"真正能被督导分析"的量).
 *
 * 逐字稿条数 ≠ 有效量: 咨询师的寒暄、"嗯"、"好的"这类无信息轮次都会进逐字稿,
 * 但它们对督导结论没有任何贡献 —— 用条数当门槛会把"说了 5 句废话"判成合格.
 */
export interface EffectiveMaterial {
  /** 有效轮数 (text.trim() 非空的轮次). */
  readonly effectiveTurns: number;
  /** 有效字数 (非空轮 text.trim() 长度求和). */
  readonly effectiveChars: number;
}

/**
 * 最小可分析量阈值 (由 service 层从 config 注入).
 */
export interface EffectiveMaterialThresholds {
  /** 至少要有多少轮有效对话. */
  readonly minTurns: number;
  /** 至少要有多少字有效对话. */
  readonly minChars: number;
}

/**
 * 逐字稿里的一轮 (只取本函数需要的字段).
 *
 * 用结构化子类型而不是直接吃 `TrainingTranscriptTurn`: 本层不认识 entity / Nest,
 * 任何"只有 text 字段"的数组 (agent 侧 transcript / ctx.transcript) 都能直接喂进来.
 */
export interface MaterialTranscriptTurn {
  /** 该轮文本 (可能是 undefined / null —— JSON 列里的脏数据不能把整段判定打挂). */
  readonly text?: string | null;
}

/**
 * 运行时守卫: 值是不是"逐字稿数组".
 *
 * 为什么不用 `Array.isArray()` 直接判:
 *   `Array.isArray` 的签名是 `(arg: any) => arg is any[]` —— 对 `readonly T[] | null | undefined`
 *   做判空时, **真分支会被收窄成 `any[]`**, 于是 `for (const turn of transcript)` 里
 *   `turn` 变成 `any` → 下一行 `const text = turn?.text` 就是
 *   `@typescript-eslint/no-unsafe-assignment` (unsafe assignment of an `any` value).
 *   本函数用**显式类型谓词**声明真分支的确切类型, 收窄后仍是 `MaterialTranscriptTurn`,
 *   既没有 `any`, 又保留了"DB 里塞了非数组 JSON"的运行时兜底.
 *
 * @param value 未知值
 * @returns true = 是逐字稿数组
 */
function isMaterialTranscriptArray(value: unknown): value is readonly MaterialTranscriptTurn[] {
  return Array.isArray(value);
}

/**
 * 量有效素材 (纯函数, 无 IO).
 *
 * 判定口径:
 *   - 有效轮 = `text.trim()` 非空的轮次
 *   - 有效字数 = Σ 非空轮 `text.trim().length`
 *
 * @param transcript 逐字稿 (可空 — 老数据 / 手工插入的行可能是 null)
 * @returns 有效量 (全 0 表示"什么都没说")
 */
export function measureEffectiveMaterial(transcript: readonly MaterialTranscriptTurn[] | null | undefined): EffectiveMaterial {
  if (!isMaterialTranscriptArray(transcript)) {
    return { effectiveTurns: 0, effectiveChars: 0 };
  }
  let effectiveTurns = 0;
  let effectiveChars = 0;
  for (const turn of transcript) {
    const text = turn?.text;
    if (typeof text !== 'string') {
      continue;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      continue;
    }
    effectiveTurns += 1;
    effectiveChars += trimmed.length;
  }
  return { effectiveTurns, effectiveChars };
}

/**
 * 是否低于最小可分析量 (= 空局).
 *
 * 规则 (D2): 有效轮数不足 **或** 有效字数不足, 满足其一即算空局.
 * 用"或"而不是"且": "2 轮但每轮 3 个字"这种会话**同样**没有分析价值 ——
 * 若用"且", 它会被判成合格, 然后照样派 job、照样失败, 只是把同一个 bug 推迟一轮.
 *
 * @param material 有效素材量
 * @param thresholds 阈值 (由调用方从 config 注入)
 * @returns true = 空局 (不派督导 job, 报告派生为 `no_content`)
 */
export function isInsufficientMaterial(material: EffectiveMaterial, thresholds: EffectiveMaterialThresholds): boolean {
  return material.effectiveTurns < thresholds.minTurns || material.effectiveChars < thresholds.minChars;
}

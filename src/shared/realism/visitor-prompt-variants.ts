// V2026-11-22 建立 (AF-281 · 来访者 V5 约束单一真相源):
//   职责: 定义来访者 prompt 变体、V5 生产约束正文与严格解析.
//   边界: 纯常量 + 纯函数；不读 env、不依赖 NestJS、不拼 persona、不写日志.
//
//   为什么抽到 shared:
//     旧 VisitorService 与引擎渲染路径（TurnRenderOrchestrator）都要用同一套
//     V5 约束。两处各写一份 = 改一处忘一处，实验结论与生产行为必然漂移。
//
//   为什么不在 prompt 里硬枚举 emotion:
//     V5.1 把标签写成硬枚举后盲评从 4.0/4.0417 掉到 3.625/3.875；格式修复应放
//     投影层，prompt 只约束“说什么”，不约束“标签怎么写”。

/** 来访者 prompt 变体 — shared 是旧链路，seed-v5 只在灰度 env 开启时使用. */
export type VisitorPromptVariant = 'shared' | 'seed-v5';

/** 允许的 prompt 变体（顺序即文档与错误提示顺序）. */
export const VISITOR_PROMPT_VARIANTS: readonly VisitorPromptVariant[] = ['shared', 'seed-v5'];

/** 默认变体：shared，保证未配置时逐字不变. */
export const DEFAULT_VISITOR_PROMPT_VARIANT: VisitorPromptVariant = 'shared';

/**
 * V5 生产约束 — 来源 AF-243 影子实验，去掉实验术语，只保留生产可执行三条：
 *   零抽象标签、接触防御、具体情绪.
 *
 * 优先级：高于上面的行为与情绪段落，低于硬规则。调用方必须把它放在硬规则之后，
 * 让“硬规则优先”在阅读顺序与位置上都成立。
 */
export const SEED_V5_VISITOR_CONSTRAINTS = `## 接触防御与具体情绪 (V5 · 优先级高于上面的行为与情绪段落，低于硬规则)
- 只输出台词；第一个字符不能是“（”“(”“*”“【”，整行禁止任何括号动作、神态、场景、旁白或舞台说明。
- 全场禁止出现这些抽象心理词：不配得感、回避、依恋、防御、创伤、投射、边界、自我价值、内在小孩、共情、压抑、理智化。说出任意一个即视为本轮无效。
- 接触防御：每 2 轮至少 1 轮回应咨询师这句话给你当下的反应（身体、态度或动作），但不确认对方的假设，也不接成自我总结。可以说“你这么一问，我有点烦。”“你别老盯着我，我不习惯。”
- 情绪具体化：只写身体感受或行为冲动，例如胸口闷、手心出汗、想抽烟、想笑、脑子空白、想走；不命名心理机制，不解释为什么。
- 身体感受和行为冲动只能写成台词或语气，不写括号、星号、旁白、舞台说明或动作描写。
- 不把咨询师的话翻译成“我意识到”“原来我”“其实我是因为”；可以只说“你这么说我更乱”。
- 允许重复同一个具体细节，像真人卡住；不新增重大事实、不推进剧情、不设计“防御—领悟—松动”的治疗性弧线。`;

/**
 * 严格解析 prompt 变体.
 *
 * @param raw env 原始值
 * @param key 用于错误文案的键名（默认 VISITOR_PROMPT_VARIANT）
 * @throws 非法取值时 fail fast，错误含键名与允许值
 */
export function parseVisitorPromptVariant(raw: string | null | undefined, key = 'VISITOR_PROMPT_VARIANT'): VisitorPromptVariant {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) return DEFAULT_VISITOR_PROMPT_VARIANT;
  if ((VISITOR_PROMPT_VARIANTS as readonly string[]).includes(trimmed)) {
    return trimmed as VisitorPromptVariant;
  }
  throw new Error(`${key}=${trimmed} 非法，只允许 ${VISITOR_PROMPT_VARIANTS.join(' / ')}`);
}

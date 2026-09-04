// V2026-09-04 治本 (V6.0 §3.5 + audit P0-1):
//   LLM 枚举 — Provider / Capability / Tier.
//   原因: 多厂商可插拔, 需要稳定的字符串 code 标识, 不在 admin 配置里
//         写魔法字符串. Tier 对齐前端 SystemPromptTier (§3.5 三层架构).
//   修复: AIProviderId 枚举字面量跟 moyin-ai-core ProviderId 风格一致
//         (lowercase + underscore). LLMTier.code 与前端 SystemPromptTierX.code 对齐.
//   如何验证: 前端 SystemPromptTierX.fromCode() 解析后端传回的 tier 字符串,
//             双向 round-trip 稳定.

/**
 * Provider 标识 — 对齐 moyin-ai-core ProviderId (lowercase + underscore).
 *
 * - openai: OpenAI 官方 (https://api.openai.com/v1)
 * - deepseek: DeepSeek (https://api.deepseek.com/v1)
 * - doubao: 豆包 / 字节跳动 (火山引擎方舟)
 * - qwen: 通义千问 / 阿里云 (DashScope)
 * - moonshot: 月之暗面 Kimi
 * - zhipu: 智谱 GLM
 * - baichuan: 百川
 * - hunyuan: 腾讯混元
 * - wenxin: 文心一言 / 百度 (注意: 文心有自己的非 OpenAI 协议, 走自定义 adapter)
 * - custom: 自定义 baseUrl (用户填)
 *
 * 反双胞胎: 不引入 'mock' / 'memefast' (那是 moyin-ai-core 桌面端用的,
 *           服务端用 'custom' 表达 dev 环境本地 mock).
 */
export enum AIProviderId {
  OPENAI = 'openai',
  DEEPSEEK = 'deepseek',
  DOUBAO = 'doubao',
  QWEN = 'qwen',
  MOONSHOT = 'moonshot',
  ZHIPU = 'zhipu',
  BAICHUAN = 'baichuan',
  HUNYUAN = 'hunyuan',
  WENXIN = 'wenxin',
  CUSTOM = 'custom',
}

/** 全部 provider id (admin 后台初始化下拉框用). */
export const ALL_PROVIDER_IDS: readonly AIProviderId[] = [
  AIProviderId.OPENAI,
  AIProviderId.DEEPSEEK,
  AIProviderId.DOUBAO,
  AIProviderId.QWEN,
  AIProviderId.MOONSHOT,
  AIProviderId.ZHIPU,
  AIProviderId.BAICHUAN,
  AIProviderId.HUNYUAN,
  AIProviderId.WENXIN,
  AIProviderId.CUSTOM,
] as const;

/**
 * Capability — provider 声明支持的能力.
 *
 * - chat: 文本对话 (LLM 主能力)
 * - embedding: 文本向量化 (知识库 RAG)
 * - vision: 多模态视觉 (图片理解)
 * - rerank: 重排序 (RAG 第二阶段精排)
 * - tts: 语音合成 (V3 增值)
 * - asr: 语音识别 (V3 增值)
 */
export enum LLMCapability {
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  VISION = 'vision',
  RERANK = 'rerank',
  TTS = 'tts',
  ASR = 'asr',
}

/**
 * Tier — V6.0 §3.5 三层架构.
 *
 * - basic: 端侧基础层 — 离线兜底 / 隐私敏感场景, 不发云端
 * - rag: 云端 RAG 层 (默认) — 大模型 + 专业知识库
 * - advanced: 高阶层 (付费) — 深度叙事梳理 / 认知重构辅助
 */
export enum LLMTier {
  BASIC = 'basic',
  RAG = 'rag',
  ADVANCED = 'advanced',
}

export const ALL_TIERS: readonly LLMTier[] = [LLMTier.BASIC, LLMTier.RAG, LLMTier.ADVANCED] as const;

/** 是否付费 tier (advanced). */
export function isPaidTier(tier: LLMTier): boolean {
  return tier === LLMTier.ADVANCED;
}

// V2026-10-09 治本 (Supervisor Prompt 模板 — SPEC §11.2):
//   设计目标:
//     1. 严格输出 JSON 格式, 字段对齐 SupervisionReport (typescript interface)
//     2. 评分客观, 不偏袒 (硬规则)
//     3. 标注必须落到 transcript 真实时间戳
//     4. V0.x 不接 RAG 检索, 留占位字符串, 注释说明 V1.x 接 Qdrant 路径
//
//   关键设计:
//     - renderSystemPrompt(input) 完整渲染: 角色 + 输入变量 + 硬规则 + JSON schema 描述
//     - renderTranscriptBlock(transcript) 单独抽, 拼 transcript 文本, 时间戳 (HH:MM:SS) 对齐
//     - JSON_SCHEMA_DESCRIPTION 字符串常量, 跟 SupervisionReport interface 字段 1:1, 方便 V1.x 改
//
//   反双胞胎:
//     - 不用 template literal 嵌入 history (会膨胀 token) — 走 LlmMessage[] 多轮
//     - 不把 RAG 内容从外部传入 — V0.x ragContext 永远 '', V1.x 改 renderSystemPrompt 签名
//     - 不接具体心理流派 — 让 LLM 用通用心理咨询督导知识
//     - 不存 prompt 到 DB — 模板常量化, V0.x 不需要版本管理
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. renderSystemPrompt 返回字符串含 "JSON" 关键词 (V0.x 验证 prompt 严格约束)
//     3. JSON_SCHEMA_DESCRIPTION 字段名跟 supervisor.types.ts SupervisionReport interface 一致
//     4. transcript 渲染含至少 1 个时间戳, 验证 LLM 知道时间对齐方式

import type { RunReportInput, TranscriptTurn } from './supervisor.types';

/**
 * 渲染督导 system prompt.
 * V0.x: ragContext 留空字符串占位, 不走 RAG 检索
 *   // V2026-10-09 治本: V0.x 跳过 RAG 检索, V1.x 接 Qdrant 向量库, 改本函数签名接收 ragContext 实参
 * @param input runReport 入参 (含 transcript + persona + emotionTimeline)
 * @returns 完整 system prompt 字符串
 */
export function renderSystemPrompt(input: RunReportInput): string {
  // V2026-10-09 治本: V0.x 跳过 RAG 检索, V1.x 接 Qdrant 向量库 (renderSystemPrompt 加 ragContext 实参)
  const ragContext = '';
  const transcriptBlock = renderTranscriptBlock(input.transcript);
  const personaBlock = renderPersonaBlock(input);
  const emotionBlock = renderEmotionBlock(input.emotionTimeline);

  return [
    '# 角色',
    '你是资深心理咨询督导师 (supervisor), 正在评估一位实习咨询师的训练表现.',
    '你的任务是基于以下训练 transcript + 督导标准, 生成结构化督导报告.',
    '评估对象: 实习咨询师 (transcript 中 role="user" 的一方).',
    '来访者 (transcript 中 role="assistant" 的一方) 由 AI 来访者 agent 扮演, 不在评估范围.',
    '',
    '# 来访者画像 (锁定 snapshot, 督导期间不变)',
    personaBlock,
    '',
    '# 督导标准 (RAG 检索结果)',
    ragContext || '(V0.x 未接 RAG, 请用通用心理咨询督导知识评估 — V2026-10-09 治本)',
    '',
    '# 训练 transcript',
    transcriptBlock,
    '',
    '# 情绪时序 (V0.x 留空, V1.x 接 ASR 情绪模型)',
    emotionBlock,
    '',
    '# 评分维度 (六维, 每维 0-100)',
    '- empathy: 共情 (是否理解来访者情绪, 准确反映感受)',
    '- activeListening: 主动倾听 (是否全神贯注, 不打断, 不预设结论)',
    '- questioning: 提问技术 (开放式 vs 封闭式, 是否引导深入)',
    '- boundary: 边界 (伦理边界, 角色定位, 自我暴露克制)',
    '- response: 反应 (及时性, 灵活调整, 不机械套模板)',
    '- professionalism: 专业度 (术语规范, 流程完整, 危机识别)',
    '',
    '# 标注规则',
    '- timestamp 必须是 transcript 中真实存在的 ms 时间戳 (从上面 transcript 复制)',
    '- type 三选一: good (值得肯定的) / warn (可改进) / error (明显错误)',
    '- category 简明分类: 沉默过长 / 急于给建议 / 共情缺失 / 边界越界 / 问句过多 / 引导缺失 / 等',
    '- message 简述问题, 1-2 句话',
    '- suggestion 可选, 给出可执行改进建议',
    '',
    '# 硬规则 (优先级最高)',
    '1. 评分客观, 不偏袒 — 同一表现跨 persona 评分一致',
    '2. 标注必须具体到 transcript 时间戳, 不泛泛而谈',
    '3. 错误分类清晰, 一类问题归一类, 不堆叠',
    '4. 建议可执行, 不空泛 (避免"应该多共情", 写"在来访者说 X 时, 可以 Y")',
    '5. overallScore 取六维均值后四舍五入, 0-100 整数',
    '6. errorPatterns 提练可复用模式 (V1.x 写回 RAG), 3-5 条为宜, 不超过 10 条',
    '7. growthSuggestions 给咨询师 3-5 条成长方向, 不重复 errorPatterns',
    '',
    '# 输出格式',
    '严格输出 JSON, 字段对齐下方 schema, 不要任何额外说明文字.',
    JSON_SCHEMA_DESCRIPTION,
  ].join('\n');
}

/**
 * 渲染 transcript 块 — 拼 userText / assistantText 交替, 时间戳对齐到 HH:MM:SS.
 * V0.x: 时戳用 Date 对象的本地时间, 不做时区换算 (V0.x 训练场景单时区).
 */
function renderTranscriptBlock(transcript: readonly TranscriptTurn[]): string {
  if (transcript.length === 0) {
    return '(空 transcript, 无对话内容)';
  }
  return transcript
    .map((turn, idx) => {
      const speaker = turn.role === 'user' ? '咨询师' : '来访者';
      const stamp = formatTimestamp(turn.at);
      return `[${idx}] ${stamp} ${speaker}: ${turn.content}`;
    })
    .join('\n');
}

/** 渲染 persona 块 — 锁定 snapshot, 督导报告生成时不变. */
function renderPersonaBlock(input: RunReportInput): string {
  const { persona } = input;
  return [
    `- 名字: ${persona.name}`,
    `- 难度: ${persona.difficulty} (L1=入门, L2=进阶, L3=专家防御)`,
    `- persona id: ${persona.id} (V0.x 督导报告锁定 snapshot, 不再变)`,
  ].join('\n');
}

/** 渲染情绪时序 — V0.x 永远空, 函数保留签名 V1.x 接 ASR. */
function renderEmotionBlock(timeline: readonly { readonly timestamp: number; readonly emotion: string }[]): string {
  if (timeline.length === 0) {
    return '(V0.x 无情绪时序, V1.x 接 ASR 情绪识别后填入)';
  }
  return timeline.map((p) => `  - ${formatTimestamp(p.timestamp)}: ${p.emotion}`).join('\n');
}

/** ms timestamp → HH:MM:SS, 督导 prompt 展示用. */
function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * SupervisionReport JSON schema 描述 — 跟 supervisor.types.ts interface 字段 1:1.
 * V1.x 改字段时, 同步改本字符串, 否则 LLM 输出 schema drift.
 */
const JSON_SCHEMA_DESCRIPTION = `
JSON Schema (严格):
{
  "sessionId": "string (跟输入 sessionId 一致, 不要改)",
  "overallScore": number,  // 0-100 整数, 六维均值四舍五入
  "dimensions": {
    "empathy": number,           // 0-100 整数
    "activeListening": number,   // 0-100 整数
    "questioning": number,       // 0-100 整数
    "boundary": number,          // 0-100 整数
    "response": number,          // 0-100 整数
    "professionalism": number    // 0-100 整数
  },
  "annotations": [
    {
      "timestamp": number,      // ms, 必须是 transcript 中真实存在的时间戳
      "type": "good" | "warn" | "error",
      "category": "string",     // 简明分类
      "message": "string",      // 1-2 句话简述
      "suggestion": "string"    // 可选, 可执行改进
    }
    // 0-N 条, 至少 3 条 (覆盖 good/warn/error)
  ],
  "errorPatterns": ["string"],     // 3-5 条, V1.x 写回 RAG
  "growthSuggestions": ["string"]  // 3-5 条, 咨询师成长方向
}
`.trim();

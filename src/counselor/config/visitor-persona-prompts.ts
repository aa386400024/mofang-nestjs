// V2026-10-21 治本 (V1.2 VS-B1 — M1 全量人设生成的 prompt + 输出契约):
//   原因: v1.2 spec §4.1 要求「AI 底层全量人设」是一套**自洽的人生剧本** —— 所有情绪 / 反应 /
//     用词都从 innerWorkingModel.coreBeliefs 派生, 不出现逻辑冲突. 这要求生成时就把 7 大块
//     之间的因果关系写清楚 (成长经历 → 核心信念 → 防御机制 → 关系模式 → 咨询预期),
//     不是 7 个字段各写各的.
//   修法: 本文件集中 3 样东西:
//     - SYSTEM_PROMPT: 生成的 system prompt (含 AI 行为规则, 让剧本自洽)
//     - SCHEMA_DESCRIPTION: 7 大块的 JSON 输出契约 (跟 counselor-llm.config 的结构化输出链配合)
//     - buildUserPrompt: 把用户的种子 (代号 / 主诉种子 / 性别 / 年龄) 拼成 user prompt
//   反双胞胎:
//     - 不把 prompt 写在 service 里: service 属业务编排, prompt 属"可运营的静态资产",
//       放 config/ 跟 supervision-school-presets / training-exercise-seeds 同 pattern
//     - 不复用 4 流派督导的 prompt 模板: 那是"分析来访者", 这里是"创造来访者", 指令相反
//     - 不在 prompt 里塞「上帝视角」相关内容: 本 prompt 只服务于生成端, 上帝视角是读取端开关
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST /counselor/visitor-personas → 返回 7 大块齐全, 且 internalWorkingModel
//        与 developmentalTimeline 互相印证 (如童年被忽视 → avoidant 依恋 + 否认防御)
//     3. 故意把模型名设错 → 返 503 且不落脏数据
//   时间戳: 2026-10-21

/**
 * 全量人设生成的 system prompt.
 *
 * 关键约束 (对应 spec §4.1「AI 行为规则」):
 *   - 剧本必须**自洽**: 内在工作模型由成长时间线推导, 应对模式由内在工作模型推导
 *   - 允许来访自己不知道的事 (如童年被忽视但解释为"父母忙") → 符合真实防御
 *   - 禁忌话题写进 developmentalTimeline.tabooTopics, 供 AI 触发阻抗
 *   - 不写"来访者被诊断为 XX 障碍" 之类的诊断标签: v1.2 §11.1 排除重度精神障碍/人格障碍
 */
export const VISITOR_PERSONA_SYSTEM_PROMPT = `你是一位临床心理学的案例设计专家, 你的任务是为心理咨询师训练设计一位**真实、完整、自洽**的来访者人生剧本.

设计原则:
1. 自洽性优先: 内在工作模型 (依恋类型 / 核心信念 / 防御机制) 必须能从成长时间线推导出来;
   核心信念必须能追溯到具体的早年经历; 防御机制必须与核心信念配套 (如"我不值得被爱" → 回避/否认).
2. 社会关系图谱要与成长时间线呼应: 被忽视的孩子长大后与父母疏离, 与亲密关系也难以建立.
3. 应对模式要分两面: 有适应性资源 (这才是训练的抓手) 也有非适应性策略 (这才是问题所在).
4. 咨询预设要具体到行为: 阻抗模式写"怎样躲开" (转移话题/沉默/否认), 移情倾向写"把咨询师当成谁".
5. 当前主诉要像真实来访者会说的: 口语化, 有具体时间线和情境, 不直接用诊断术语.
6. 禁忌话题必须是"家庭里不能提的话题" (如父亲的酗酒/母亲的出轨/被打), 供来访在会谈中触发回避.
7. 边界: 不涉及自杀自伤 / 性创伤 / 重度精神障碍 / 人格障碍 (本产品的高危议题排除清单).

现在请输出一位来访者的完整剧本.`;

/**
 * 7 大块的 JSON 输出契约.
 *
 * 跟 domain/visitor-persona/visitor-persona.types.ts 的 7 个 TS 类型 1:1.
 */
export const VISITOR_PERSONA_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改, 不要输出任何额外说明文字):
{
  "basics": {
    "age": 数字,
    "gender": "自报性别",
    "occupation": "职业",
    "education": "教育程度",
    "livingStatus": "独居 / 合租 / 与家人同住",
    "somaticHistory": "躯体健康史",
    "psychHistory": "既往精神科就诊或咨询史 (没有就写 '无')"
  },
  "developmentalTimeline": [
    {
      "stage": "0-6" | "7-12" | "13-18" | "19-25" | "26+",
      "parentingStyle": "养育模式",
      "keyEvents": ["重大事件"],
      "tabooTopics": ["家庭禁忌话题"]
    }
  ],
  "innerWorkingModel": {
    "attachmentType": "secure" | "anxious" | "avoidant" | "disorganized",
    "coreBeliefs": ["核心信念"],
    "hiddenTrauma": ["隐性创伤"],
    "unfinishedBusiness": ["未完成情结"],
    "defenseMechanisms": ["防御机制"]
  },
  "socialMap": [
    {
      "relationType": "parent" | "intimate" | "workplace" | "peer",
      "currentStatus": "当前关系状态",
      "conflictPattern": "冲突模式",
      "resourceOrDrain": "resource" | "drain" | "neutral"
    }
  ],
  "coping": {
    "adaptiveResources": ["适应性资源"],
    "maladaptiveStrategies": ["非适应性策略"],
    "emotionTriggers": ["情绪触发点"]
  },
  "therapyExpectation": {
    "biases": ["对咨询的偏见"],
    "expectations": ["对咨询的期待"],
    "transferenceTrend": "潜在移情倾向",
    "resistancePattern": "阻抗模式"
  },
  "presentingIssue": {
    "selfReport": "来访自述症状 (口语化)",
    "duration": "持续时长",
    "sleepAppetite": "睡眠与食欲状况",
    "selfReportedRisk": "low" | "medium" | "high" | "concealed"
  }
}

硬性要求:
- developmentalTimeline 恰好 5 段 (0-6 / 7-12 / 13-18 / 19-25 / 26+), 顺序排列
- socialMap 3-5 条, 必须同时包含 parent (至少 1 条)
- 数组字段至少 1 个元素 (不要输出空数组)
- 所有文本用中文, 不要用占位符 (如 "示例"、"xxx"、"待补充")`;

/**
 * 拼 user prompt (把用户给的种子喂给模型).
 *
 * @param opts.displayName 代号 (可空, 由模型决定)
 * @param opts.complaintSeed 主诉种子 (可空, 由模型自由发挥)
 * @param opts.gender 性别 (可空)
 * @param opts.age 年龄 (可空)
 */
export function buildPersonaGenerationUserPrompt(opts: {
  readonly displayName?: string | undefined;
  readonly complaintSeed?: string | undefined;
  readonly gender?: string | undefined;
  readonly age?: number | undefined;
}): string {
  const lines: string[] = ['请设计一位来访者, 约束如下:'];
  if (opts.displayName) {
    lines.push(`- 来访者代号: ${opts.displayName}`);
  }
  if (opts.gender) {
    lines.push(`- 性别: ${opts.gender}`);
  }
  if (opts.age !== undefined) {
    lines.push(`- 年龄: ${opts.age}`);
  }
  if (opts.complaintSeed) {
    lines.push(`- 主诉方向: ${opts.complaintSeed}`, '  (主诉必须能自然地从这份人生剧本里长出来, 不要生硬贴标签)');
  } else {
    lines.push('- 主诉方向: 由你根据整体剧本决定, 要常见且可信');
  }
  lines.push('- 若某项约束缺失, 由你按剧本自洽性决定, 不要反问.');
  return lines.join('\n');
}

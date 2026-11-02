// V2026-10-23 治本 (AI 模拟来访池 — 公共模板生成的 prompt + 输出契约):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §3.5.1 要求内部 AI 生成走
//     `CounselorLlmJsonClient.requestJson<T>()`, 顶层输出 `{ card, script }`.
//     prompt 与 schema 描述是「可运营的静态资产」, 跟业务编排 (service) 分开放 ——
//     跟仓库既有 `visitor-persona-prompts.ts` / `supervision-school-presets.ts` 同 pattern.
//     两者的区别: 那份生成「一位用户的私有人设」(7 大块, 无表层元字段),
//     这份生成「一条公共模板」(7 大块 + 11 个表层卡片元字段, 且有内容边界硬约束).
//
//   修法: 本文件集中 3 样东西:
//     - SYSTEM_PROMPT: 角色 + 设计原则 + **内容边界硬约束**
//     - SCHEMA_DESCRIPTION: `{ card, script }` 的 JSON 输出契约
//     - buildUserPrompt: 把内部调用方给的方向 (议题/防御类型/难度/目标/代称) 拼成 user prompt
//
//   反双胞胎:
//     - 不复用 `VISITOR_PERSONA_SYSTEM_PROMPT`: 那份的输出**只有 script**, 且没有
//       表层卡片约束 (代称/年龄区间/训练目标) 与公共池的内容边界. 混用会得到
//       "能过 7 大块校验但落不了表" 的产物.
//     - 不把「内容边界」只写在 prompt 里: prompt 是劝告, `VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS`
//       才是拒收闸门 (见 config/visitor-pool.config.ts). 两者共用同一份词表口径.
//     - 不让 LLM 填 `source`: 案例来源是后端的治理字段, 模型自称的来源不可信 ——
//       由后端固定写 official.
//     - 不在 prompt 里写具体人物姓名/地名/机构: 公共库必须匿名化 (§2.1 ageRange 区间、
//       codename 代号), 避免可识别.
//
//   验证:
//     1. tsc 0 错
//     2. 大炮 POST /counselor/admin/visitor-pool/generate → 返回 card + script, 且落 enabled=0 草稿
//     3. 故意让模型写危机内容 → 被校验闸门拒收 (errorCode=schema_validation_failed)
//
//   时间戳: 2026-10-23

import { VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS } from './visitor-pool.config';
import type { TrainingDifficulty } from '../enums/training-difficulty.enum';
import type { VisitorPoolDefenseType, VisitorPoolIssueDomain } from '../enums/visitor-pool.enum';

/**
 * 公共模板生成的 system prompt.
 *
 * 与 `VISITOR_PERSONA_SYSTEM_PROMPT` 的关键差异 (三条硬约束):
 *   ① 产出的是**公共模板**: 必须匿名化 (代号 / 年龄区间 / 无真实姓名地名单位)
 *   ② 产出**表层卡片 + 7 大块剧本**两段, 两者必须互相印证
 *   ③ **内容边界**: 普通池排除性创伤 / 重度精神障碍 / 人格障碍 / 危机内容
 */
export const VISITOR_POOL_SYSTEM_PROMPT = `你是一位临床心理学的案例设计专家, 你的任务是为心理咨询师训练库设计一位**公共来访模板** —— 一位可被所有学员复用的虚构来访者.

产出两部分:
1. card —— 人物卡的表层信息 (代号 / 年龄区间 / 一句话主诉 / 防御类型 / 议题领域 / 训练目标 / 难度 / 配合风格 / 情绪与防御默认值)
2. script —— 这位来访者的完整人生剧本 (7 大块), 是 AI 在会谈中行为的唯一推导基准

设计原则:
1. 自洽性优先: 内在工作模型必须能从成长时间线推导; 防御机制与核心信念配套; 社会关系图谱要与成长经历呼应.
2. card 与 script 必须互相印证: card 的议题领域要能从 socialMap 与主诉看出来; card 的防御类型要能从 innerWorkingModel.defenseMechanisms 看出来; card 的难度要能反映在配合风格与阻抗方式上.
3. 表层要"像来访者第一次见面愿意说的话": 主诉口语化、有具体情境与时间线, 不用诊断术语.
4. 训练目标写**技术动作** (如"练开放式提问"), 不写诊断或治疗目标.
5. 留出可练的抓手: coping.adaptiveResources 是训练的着力点; 禁忌话题 (developmentalTimeline.tabooTopics) 是会谈中触发阻抗的钩子.

公共库的内容边界 (硬约束, 违反即作废):
- 匿名: 只用代号与年龄区间, **不出现真实姓名、地名、单位、机构名**; 不出现可识别个人的细节组合.
- 化名的要求 (违反即作废): 名字要像**现实里一个普通自然的称呼** —— 常见、普通、不出挑;
  **不象征、不剧透性格** (名字不体现这个人的性格/防御方式/难度, 性格只由会谈里的对话与行为体现);
  不带姓、不用法律式全名、不用强性别字 (婷/丽/伟/强等)、不用性格评价字 (强/倔/傲/烈等);
  不用 '来访者 · X' 这类系统视角标签.
- 不写性创伤; 不写重度抑郁、双相等重度精神障碍; 不写人格障碍; 不写精神病性症状.
- 哀伤 (grief) 主题只写**普通丧失** (亲人离世、关系结束、宠物去世), 不写危机干预相关内容.
- 情绪基调是"日常困扰", 不是"需要立即干预的危机". selfReportedRisk 只能是 low 或 medium.
- 禁用词 (出现即作废): ${VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS.join(' / ')}.

现在请输出一位公共来访模板.`;

/**
 * `{ card, script }` 的 JSON 输出契约.
 *
 * 7 大块结构与 `VISITOR_PERSONA_SCHEMA_DESCRIPTION` **完全一致** (同一份剧本结构,
 * 见 domain/visitor-persona/visitor-persona.types.ts) —— 这里重述一遍是为了让
 * 本 prompt 自包含 (LLM 不跨文件读), 但**结构必须保持一致**: 实例化时 7 大块要
 * 原样克隆进私有副本, 两处描述漂移会导致克隆出来的剧本缺块.
 */
export const VISITOR_POOL_SCHEMA_DESCRIPTION = `输出 JSON 结构 (必须严格符合, 字段名不可改, 不要输出任何额外说明文字):
{
  "card": {
    "codename": "现实里常见、普通、不出挑的中性称呼 (如 '小满' / '一一' / '豆豆' / '晚晴'), 1-3 字 (2-3 字为主, 可叠字/单字); 不带姓、不用全名、不用强性别字、不用性格评价字 (强/倔/傲/烈)、不加 '来访者' 之类的系统标签; 不象征性格",
    "ageRange": "年龄区间, 形如 '28-35'",
    "presentingComplaint": "初次见面愿主动说的一句话困扰, 10-60 字",
    "defenseType": "intellectualization" | "avoidance" | "idealization" | "projection" | "regression",
    "issueDomain": "intimate" | "parenting" | "workplace" | "grief" | "self_worth" | "social_anxiety",
    "trainingGoal": "一个可练的技术目标, 5-30 字, 例如 '练开放式提问与情绪反射'",
    "difficulty": "L1" | "L2" | "L3",
    "styleHint": "cooperative" | "defensive" | "resistant" | "avoidant" | "mixed",
    "emotionBaselineDefault": 数字, 0-1,
    "defenseLevelDefault": 数字, 0-1
  },
  "script": {
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
      "selfReportedRisk": "low" | "medium"
    }
  }
}

硬性要求:
- developmentalTimeline 恰好 5 段 (0-6 / 7-12 / 13-18 / 19-25 / 26+), 顺序排列
- socialMap 3-5 条, 必须包含 parent (至少 1 条)
- 数组字段至少 1 个元素 (不要输出空数组)
- card.ageRange 形如 "28-35" (两个整数, 小的在前); script.basics.age 落在该区间内
- card.codename 必须是现实里常见、普通、不出挑的中性称呼: 1-3 字 (可叠字, 可单字), 不带姓、不用法律式全名、不用 '先生/女士/老师' 等称谓、不用 '来访者 · X' 这类系统视角标签; 名字**不象征也不剧透性格** (不要按防御类型/阻抗强度/难度去"配"名字, 名字与人物设定解耦), 且不用性格评价字 (强/倔/傲/烈 等)
- L1 的 emotionBaselineDefault 建议 0.25-0.45, defenseLevelDefault 建议 0.15-0.35
- 所有文本用中文, 不要用占位符 (如 "示例"、"xxx"、"待补充")`;

/**
 * 拼 user prompt (把内部调用方给的方向喂给模型).
 *
 * 全部可选: 缺省由模型按剧本自洽性决定 (spec §3.5「给方向即可, 缺省由 LLM 补全」).
 * 传了的方向是**硬约束** —— 生成后会被校验器比对, 不一致即拒收.
 *
 * @param opts.issueDomain 议题领域
 * @param opts.defenseType 主导防御类型
 * @param opts.difficulty 难度档
 * @param opts.trainingGoal 训练目标方向
 * @param opts.codenameHint 代称方向 (常见中性称呼的方向)
 * @param opts.index 本次是第几条 (同一批多条的区分标识; 从 1 开始)
 */
export function buildVisitorPoolGenerationUserPrompt(opts: {
  readonly issueDomain?: VisitorPoolIssueDomain | undefined;
  readonly defenseType?: VisitorPoolDefenseType | undefined;
  readonly difficulty?: TrainingDifficulty | undefined;
  readonly trainingGoal?: string | undefined;
  readonly codenameHint?: string | undefined;
  readonly index: number;
}): string {
  const lines: string[] = [`请设计第 ${opts.index} 位公共来访模板, 约束如下:`];
  if (opts.issueDomain) {
    lines.push(`- 议题领域: ${opts.issueDomain} (必须严格一致)`);
  }
  if (opts.defenseType) {
    lines.push(`- 主导防御类型: ${opts.defenseType} (必须严格一致, 且要在 innerWorkingModel.defenseMechanisms 里体现)`);
  }
  if (opts.difficulty) {
    lines.push(`- 难度档: ${opts.difficulty} (必须严格一致)`);
  }
  if (opts.trainingGoal) {
    lines.push(`- 训练目标方向: ${opts.trainingGoal}`);
  }
  if (opts.codenameHint) {
    lines.push(`- 代称方向: ${opts.codenameHint} (常见、普通、不出挑的中性称呼; 不带姓, 不要写真实姓名)`);
  }
  lines.push('- 若某项约束缺失, 由你按剧本自洽性决定, 不要反问.', '- 每位模板要彼此不同: 议题、成长经历、关系图谱、阻抗方式都不要雷同.');
  return lines.join('\n');
}

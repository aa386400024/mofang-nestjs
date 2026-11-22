// V2026-10-27 治本 (危机识别专区 — 静态元数据骨架, spec 任务 B):
//   性质: 这是「识别与转介」**教学场景**的壳数据, **不是**真实危机处置能力.
//
//   ── 硬边界 (任务单 B 节; 呼应 docs/README.md §13 / 前端整合版 §17) ──
//   本文件**只**提供:
//     · 风险分级的**教学标签** (不是判定标准, 不含任何阈值/公式)
//     · 识别信号**类别** (描述"咨询师可以留意什么", 不诱导、不展开)
//     · 转介练习的**开放式问句** + 通用资源引导
//     · 边界声明文案 (前端"隔离壳"直接渲染)
//   本文件**不含**:
//     · 危机干预治疗内容 / 转介流转流程 / 任何干预技术动作或步骤
//     · 危机人物剧本 (不建危机人物表, 不接 LLM 生成危机人物)
//     · 任何具体热线号码 / 地址 / 机构名 (号码属于运营内容, 且各地区不同)
//     · 任何临床诊断标准 (不给诊断, 不给风险判定的量化阈值)
//
//   ── 为什么是"静态 TS"而不是落库 ──
//   ① 它是**教学大纲**, 不是业务数据: 不随用户/租户变化, 不需要版本管理
//   ② 落库 = 需要 migration + 读写路径 + 生命周期, 而这份内容**不随运营高频变更**
//      (要改就改代码发版, 审计链完整)
//   ③ 危机内容一旦可被普通业务接口读到, 就是合规事故 —— 静态模块**物理上**进不了
//      `visitor_pool_templates` / 公共图鉴列表 / 普通池 seed (任务单 B3 的物理隔离)
//
//   ── 与普通池的零交集 (B3) ──
//   本文件的文案**刻意避开** `VISITOR_POOL_EXCLUDED_CONTENT_KEYWORDS` 的全部词:
//   只描述"可以留意的现象类别", 不点名任何被普通池拒收的内容类型.
//   `test/counselor/crisis-practice-isolation.spec.ts` 锁死这条不变量 (命中即红).
//
//   验证:
//     1. tsc 0 错
//     2. GET /counselor/crisis-practice/meta → 只含分级/信号类别/话术模板/边界声明
//     3. 公共图鉴列表查不到任何危机条目 (危机数据根本不在那张表里)
//   时间戳: 2026-10-27

/**
 * 风险分级 (教学用).
 *
 * 只用于**教学分档**: 让学员认识"不同强度下, 咨询师该把注意力放在哪".
 * **不是**风险判定标准 —— 本仓库不提供任何量化阈值/评分公式/判定规则,
 * 真实评估由真人专业人员按当地规范完成.
 */
export type CrisisRiskLevel = 'low' | 'medium' | 'high' | 'imminent';

/**
 * 某一风险档的教学元数据.
 */
export interface CrisisRiskLevelMeta {
  /** 风险档 (教学分档). */
  readonly level: CrisisRiskLevel;
  /** 教学标签 (前端展示用, 不是诊断名). */
  readonly label: string;
  /** 一句教学提示: 学员在这个档位该关注什么 (不写处理流程). */
  readonly teachingNote: string;
  /** 该档位对应的识别信号类别 id (见 `CRISIS_SIGNAL_CATEGORIES`). */
  readonly signalCategoryIds: readonly string[];
}

/**
 * 识别信号类别 (教学用).
 *
 * 一条类别 = 一个"咨询师可以留意的现象方向".
 * **不是**诊断标准, 不含判定阈值; `examples` 只描述**观察到的现象**,
 * 不给"如何提问/如何回应"的话术 (那属于话术模板与真人专业判断).
 */
export interface CrisisSignalCategory {
  /** 类别 id (稳定引用). */
  readonly id: string;
  /** 类别名 (教学标签). */
  readonly label: string;
  /** 一句说明: 这个方向上可以留意什么. */
  readonly description: string;
  /** 现象举例 (描述性, 不诱导学员追问). */
  readonly examples: readonly string[];
}

/**
 * 转介练习话术模板 (教学用).
 *
 * - `openQuestions`: 开放式评估问句 (练"问得开", 不给判断式追问)
// - `resourceGuidance`: 通用资源引导 (引导联系专业帮助 / 当地急救或心理援助资源)
 *
 * **不含**具体号码 / 机构名 / 干预步骤 —— 各地资源不同, 由运营按当地规范另行告知.
 */
export interface CrisisReferralScriptTemplate {
  /** 模板 id (稳定引用). */
  readonly id: string;
  /** 模板标题 (教学标签). */
  readonly title: string;
  /** 适用档位 (教学分档). */
  readonly levels: readonly CrisisRiskLevel[];
  /** 开放式评估问句. */
  readonly openQuestions: readonly string[];
  /** 通用资源引导 (不含号码). */
  readonly resourceGuidance: string;
}

/**
 * 边界声明文案 (前端"隔离壳"直接渲染).
 *
 * 固定文案, 不随内容变 —— 它是**免责与预期管理**的一部分, 不是可配置项.
 */
export const CRISIS_PRACTICE_BOUNDARY_NOTICE = '本模块仅练习识别风险信号与转介沟通, 非真实危机干预, 不替代专业帮助。';

/**
 * 风险分档的教学元数据.
 *
 * 分档的教学意义 (不是判定标准):
 * - low: 日常情绪波动范围内, 咨询师留意即可
 * - medium: 状态持续影响生活功能, 需要在会谈里多问一句
 * - high: 出现明确需要优先处理相关表达的信号, 沟通目标转向"陪同求助"
 * - imminent: 出现迫在眉睫相关表达 —— 立即结束角色扮演, 引导现实求助路径
 */
export const CRISIS_RISK_LEVELS: readonly CrisisRiskLevelMeta[] = [
  {
    level: 'low',
    label: '低度关注',
    teachingNote: '常见的情绪波动范围内, 咨询师保持留意、照常推进会谈即可。',
    signalCategoryIds: ['hopelessness_language', 'withdrawal'],
  },
  {
    level: 'medium',
    label: '中度关注',
    teachingNote: '状态持续影响生活功能, 适合在会谈里多问一句"最近这段时间怎么样"。',
    signalCategoryIds: ['hopelessness_language', 'withdrawal', 'self_care_decline', 'sleep_appetite_change'],
  },
  {
    level: 'high',
    label: '高度关注',
    teachingNote: '出现明确需要优先处理的相关表达, 沟通目标从"分析原因"转向"陪同求助"。',
    signalCategoryIds: [
      'hopelessness_language',
      'withdrawal',
      'self_care_decline',
      'sleep_appetite_change',
      'farewell_theme',
      'no_support_anchor',
    ],
  },
  {
    level: 'imminent',
    label: '即时关注',
    teachingNote: '出现迫在眉睫的相关表达时, 立即结束角色扮演, 引导来访者走向现实中的专业求助路径。',
    signalCategoryIds: ['farewell_theme', 'no_support_anchor', 'acute_state_change'],
  },
];

/**
 * 识别信号类别清单.
 *
 * 措辞纪律: 只写"可以留意的现象", 不写"如果出现 X 就判定为 Y",
 * 不写处理动作 —— 处理动作属于真人专业判断与当地规范.
 */
export const CRISIS_SIGNAL_CATEGORIES: readonly CrisisSignalCategory[] = [
  {
    id: 'hopelessness_language',
    label: '言语流露无助与无价值感',
    description: '来访者在叙述中反复出现"没意义""没人在意"这类表达, 且难以被具体处境解释。',
    examples: ['反复说自己做什么都没意义', '把负面评价泛化到整个人生', '对未来不再作任何打算'],
  },
  {
    id: 'withdrawal',
    label: '社交退缩与自我封闭',
    description: '来访者主动减少与人接触, 会谈中出现"谁都不想见"的倾向。',
    examples: ['近期几乎不接电话、不回消息', '推掉原本在意的聚会', '把对话范围缩到只有一两个人'],
  },
  {
    id: 'self_care_decline',
    label: '自我照顾能力下降',
    description: '基本生活照料明显被搁置, 呈现"顾不上自己"的状态。',
    examples: ['很久没有好好吃饭、睡觉', '个人卫生变得随意', '原本在做的事都停下了'],
  },
  {
    id: 'sleep_appetite_change',
    label: '睡眠与食欲明显改变',
    description: '睡眠或食欲出现较自身基线的明显偏移, 并持续一段时间。',
    examples: ['连续多日几乎睡不下', '食欲明显增加或明显下降', '作息完全颠倒'],
  },
  {
    id: 'farewell_theme',
    label: '提及告别或交代后事',
    description: '叙述中开始出现与告别、整理身后事务相关的内容 —— 这类信号值得优先关注。',
    examples: ['主动交代"重要的事都安排好了"', '对身后事或告别做交代式安排', '把身边的东西清点一遍'],
  },
  {
    id: 'no_support_anchor',
    label: '缺少可依靠的关系',
    description: '来访者描述自己没有任何可求助的人, 孤立感明显。',
    examples: ['"我谁都不敢讲"', '把全部关系描述为疏远', '明确表示身边没有能帮忙的人'],
  },
  {
    id: 'acute_state_change',
    label: '状态短时间内骤变',
    description: '在很短时间内出现与既往明显不同的状态变化, 值得优先了解发生了什么。',
    examples: ['几天内一反常态地平静', '突然把所有事情交代完毕', '状态出现明显的好转或恶化'],
  },
];

/**
 * 转介练习话术模板.
 *
 * 只练两件事: ① 开放式评估问句 ② 通用资源引导.
 * **不教**危机干预技术动作 (那是真人专业培训的内容, 不在本仓交付范围).
 */
export const CRISIS_REFERRAL_SCRIPT_TEMPLATES: readonly CrisisReferralScriptTemplate[] = [
  {
    id: 'open_exploration',
    title: '开放式探索',
    levels: ['low', 'medium'],
    openQuestions: [
      '你说的撑不住, 具体是从什么时候开始的?',
      '最近这段时间, 是什么事情让你觉得特别难熬?',
      '如果把现在的心情说成一个画面, 会是什么样的?',
      '这段时间里, 有没有哪一刻是相对好过的?',
    ],
    resourceGuidance: '若来访者主动寻求帮助, 可引导其联系专业帮助, 或当地的心理援助资源。',
  },
  {
    id: 'suicide_risk_assessment',
    title: '安全优先的评估问句',
    levels: ['high', 'imminent'],
    openQuestions: [
      '你刚才提到的那句话, 能不能多说一点, 你指的是什么?',
      '最近有没有过觉得"撑不下去"的时候? 是什么时候?',
      '这样的念头出现的时候, 你通常会做些什么?',
      '有没有什么是你觉得值得再撑一段时间的?',
    ],
    resourceGuidance: '建议引导对方联系专业帮助, 或当地急救、心里援助等公共资源; 涉及即时风险时应结束角色扮演, 引导现实中的求助路径。',
  },
];

/**
 * 危机练习元数据 (端点出参的数据源).
 *
 * 一次性组装, 避免 controller 里到处拼数组 (前端拿到的结构固定).
 */
export interface CrisisPracticeMeta {
  /** 边界声明文案. */
  readonly boundaryNotice: string;
  /** 风险分档的教学元数据. */
  readonly riskLevels: readonly CrisisRiskLevelMeta[];
  /** 识别信号类别清单. */
  readonly signalCategories: readonly CrisisSignalCategory[];
  /** 转介练习话术模板. */
  readonly referralScripts: readonly CrisisReferralScriptTemplate[];
}

/**
 * 组装危机练习元数据 (纯函数, 无 IO).
 *
 * @returns 元数据 (只读, 每次返回的都是同一份常量的引用 —— 调用方不得修改)
 */
export function buildCrisisPracticeMeta(): CrisisPracticeMeta {
  return {
    boundaryNotice: CRISIS_PRACTICE_BOUNDARY_NOTICE,
    riskLevels: CRISIS_RISK_LEVELS,
    signalCategories: CRISIS_SIGNAL_CATEGORIES,
    referralScripts: CRISIS_REFERRAL_SCRIPT_TEMPLATES,
  };
}

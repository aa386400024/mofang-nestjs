// AF-127 · 长会谈开场框架与收束的规则化结构审计（纯模块）:
//   职责: 把长会谈逐字稿里的"开场知情框架 / 结束收束"变成**可复算的结构证据**.
//   边界: 纯 TS, 零 IO / 零 LLM / 零 DB / 零 Nest; 只做规则匹配, 不做临床质量判断.
//
//   ⚠️ 口径边界（必须写死在代码注释里）:
//     · 本模块只回答"这段话里到底有没有这些结构", 不回答"这次咨询好不好".
//     · **命中结构 ≠ 临床达标; 缺失结构 ≠ 咨询失败**. 两者都不是本模块能判的事.
//     · 规则只做**词面**匹配, 不做语义判定; 所以输出一律 candidate + gateEligible=false.
//     · **位置窗口是硬约束**: 开场要素只在前 N 轮查, 收束要素只在后 N 轮查,
//       绝不用整场关键词代替位置判断（AF-125 复核正是栽在这里）.
//     · 要素判"覆盖"要求它的**全部子组**都在正确窗口内命中; 只命中一半 → 记 false,
//       同时把已命中 / 未命中的子组一并输出, 供人工复核（宁可漏报也不误报）.
//
//   隐私: 本模块只吐出**命中短句**（≤60 字符/条, 单要素最多 3 条）作为证据, 不吐整段原文;
//   产物只落本地 --out 目录, 不进日志 / 不进网络 / 不进 CI.

/** 开场知情框架要素键。 */
export type OpeningElementKey = 'confidentiality' | 'boundary' | 'duration' | 'pauseRefusal' | 'recording';

/** 结束收束要素键。 */
export type ClosingElementKey = 'summary' | 'takeaway' | 'nextStep';

/** 危机收束要素键。 */
export type RiskClosingElementKey = 'means' | 'channel' | 'contact' | 'noAlone' | 'commitment';

/** 收束模式。 */
export type ClosingMode = 'risk' | 'routine' | 'risk-incomplete' | 'none';

/** 全部结构要素键。 */
export type StructureElementKey = OpeningElementKey | ClosingElementKey;

/** 开场窗口轮数（硬约束：开场要素只在前 N 轮查）。 */
export const OPENING_WINDOW_TURNS = 10;

/** 收束窗口轮数（硬约束：收束要素只在后 N 轮查）。 */
export const CLOSING_WINDOW_TURNS = 10;

/** 口径版本。 */
export const SESSION_STRUCTURE_AUDIT_VERSION = 'af127-v1';

/** 免责声明（所有产物都必须带上, 不许删）。 */
export const SESSION_STRUCTURE_DISCLAIMER =
  '结构审计只回答"逐字稿里有没有这些结构", 不做临床质量判断; 命中结构不等于质量达标, 缺失结构也不等于咨询失败; 未接入 batch-report / CI, 状态固定 candidate。';

/** 单条证据短句的最大长度（字符）。 */
const EXCERPT_MAX_CHARS = 60;

/** 单个要素最多保留的证据条数。 */
const EXCERPT_MAX_COUNT = 3;

/** 一轮结构审计输入。 */
export interface SessionStructureTurn {
  /** 轮次（从 1 起）。 */
  readonly turnIndex: number;
  /** 咨询师这一轮说的话（只审计它; 来访者台词不参与判定）。 */
  readonly counselor: string;
  /** 来访者这一轮说的话（仅随行保留, 判定时不用）。 */
  readonly visitor: string;
}

/** 单个结构要素的判定结果。 */
export interface StructureElementResult {
  /** 是否覆盖（全部子组都在正确窗口内命中才算覆盖）。 */
  readonly covered: boolean;
  /** 命中的原文短句（多条用 " ｜ " 连接; 未命中为空串）。 */
  readonly evidence: string;
  /** 命中所在轮号（升序, 去重）。 */
  readonly evidenceTurns: readonly number[];
  /** 已命中的子组 id。 */
  readonly matchedGroups: readonly string[];
  /** 未命中的子组 id（缺这些就是缺结构）。 */
  readonly missingGroups: readonly string[];
}

/** 窗口范围（轮号, 闭区间; 空窗口为 from=0 / to=0）。 */
export interface StructureWindow {
  readonly from: number;
  readonly to: number;
}

/** 开场知情框架结果。 */
export type OpeningStructureAudit = Record<OpeningElementKey, StructureElementResult>;

/** 结束收束结果。 */
export type ClosingStructureAudit = Record<ClosingElementKey, StructureElementResult>;

/** 单 packet 结构审计结果。 */
export interface SessionStructureAudit {
  readonly packetId: string;
  /** 解析出的总轮数。 */
  readonly turnCount: number;
  /** 有咨询师台词的轮数。 */
  readonly counselorTurns: number;
  /** 实际参与开场判定的窗口。 */
  readonly openingWindow: StructureWindow;
  /** 实际参与收束判定的窗口。 */
  readonly closingWindow: StructureWindow;
  readonly opening: OpeningStructureAudit;
  readonly closing: ClosingStructureAudit;
  /** 是否检测到危机信号（全稿扫描，咨询师与来访者台词都算）。 */
  readonly crisisDetected: boolean;
  /** 危机收束结果（只在 crisisDetected=true 时有判定意义）。 */
  readonly riskClosing: Record<RiskClosingElementKey, StructureElementResult>;
  /** 收束模式：risk / routine / risk-incomplete / none。 */
  readonly closingMode: ClosingMode;
  /** 危机收束是否覆盖（至少 2 组且含 means/channel/contact 之一）。 */
  readonly riskClosingComplete: boolean;
  /** 开场 5 项是否全覆盖。 */
  readonly openingComplete: boolean;
  /** 收束是否按当前模式完整（risk 或 routine）。 */
  readonly closingComplete: boolean;
}

/** 单要素覆盖率。 */
export interface StructureCoverageStat {
  readonly covered: number;
  readonly total: number;
  readonly rate: number;
}

/** 聚合结果。 */
export interface SessionStructureAggregate {
  readonly packetCount: number;
  readonly openingCoverage: Record<OpeningElementKey, StructureCoverageStat>;
  readonly closingCoverage: Record<ClosingElementKey, StructureCoverageStat>;
  /** 危机收束五组覆盖率。 */
  readonly riskClosingCoverage: Record<RiskClosingElementKey, StructureCoverageStat>;
  /** 检测到危机信号的 packet 数。 */
  readonly riskDetectedPackets: number;
  /** 危机收束覆盖的 packet 数。 */
  readonly riskClosingCompletePackets: number;
  /** 常规收束覆盖的 packet 数。 */
  readonly routineClosingCompletePackets: number;
  /** 收束模式计数。 */
  readonly closingModeCounts: Record<ClosingMode, number>;
  /** 开场 5 项全覆盖的 packet 数。 */
  readonly openingCompletePackets: number;
  /** 收束按模式完整的 packet 数。 */
  readonly closingCompletePackets: number;
  /** 开场 + 收束都完整的 packet 数。 */
  readonly fullyCoveredPackets: number;
  /** 至少命中 1 个结构子组、但没有全项覆盖的 packet 数。 */
  readonly partiallyCoveredPackets: number;
  /** 状态固定 candidate（本审计不接硬门）。 */
  readonly status: 'candidate';
  /** 固定 false（结构命中不得当成临床达标）。 */
  readonly gateEligible: false;
  readonly disclaimer: string;
}

/** 一个子组: 一组同义表达, 命中任意一条即算该子组命中。 */
interface StructureGroup {
  readonly id: string;
  readonly label: string;
  /** 正则源串（不编译, 运行时逐条 exec; 不带 g 标志, 无 lastIndex 残留）。 */
  readonly patterns: readonly string[];
}

/** 一个结构要素: 由若干子组**全部命中**才算覆盖。 */
interface StructureRule {
  readonly key: StructureElementKey;
  readonly label: string;
  /** 在哪个窗口查。 */
  readonly window: 'opening' | 'closing';
  readonly groups: readonly StructureGroup[];
}

/** 开场要素键清单（顺序固定, 产物按它排布）。 */
export const OPENING_ELEMENT_KEYS: readonly OpeningElementKey[] = ['confidentiality', 'boundary', 'duration', 'pauseRefusal', 'recording'];

/** 收束要素键清单（顺序固定, 产物按它排布）。 */
export const CLOSING_ELEMENT_KEYS: readonly ClosingElementKey[] = ['summary', 'takeaway', 'nextStep'];

/** 危机收束要素键清单（顺序固定, 产物按它排布）。 */
export const RISK_CLOSING_ELEMENT_KEYS: readonly RiskClosingElementKey[] = ['means', 'channel', 'contact', 'noAlone', 'commitment'];

/** 收束模式清单（顺序固定, 产物按它排布）。 */
export const CLOSING_MODE_KEYS: readonly ClosingMode[] = ['risk', 'routine', 'risk-incomplete', 'none'];

/** 总结动作子组。 */
const SUMMARY_ACTION_GROUP: StructureGroup = {
  id: 'summaryAction',
  label: '总结动作',
  // 只认"总结/小结/归纳/回顾/概括"; "梳理"是过程动作, 不足以构成收尾总结.
  patterns: ['(总结|小结|归纳|回顾|概括)'],
};

/** 理解复述子组。 */
const SUMMARY_UNDERSTANDING_GROUP: StructureGroup = {
  id: 'understanding',
  label: '理解复述',
  patterns: ['(我的理解|我理解|我听到|听起来|你是说|我看到|我注意到|我把握|共识|我们今天聊到)'],
};

/**
 * 结构规则表（口径真相源）。
 *
 * 设计约束:
 *   ① **合取**: 要素由多个子组组成, 必须全部命中才算覆盖; 单组命中只记进
 *      `matchedGroups` / `missingGroups`, 供人工复核, 不构成"有结构"。
 *   ② **位置**: 开场 5 项只在**前 10 轮**查, 收束 3 项只在**后 10 轮**查。
 *   ③ **反误报**: 正则刻意排除了"整场关键词"型误命中, 例如
 *      - `不会说(?!话)` 排除"不会说话的人"（不是保密承诺）;
 *      - `不告诉(别人|任何人|第三方)` 排除"暂时不告诉对方全部"（来访者自己的选择）;
 *      - `不能(?!不)` 排除"能不能"（提问, 不是边界限制）;
 *      - `随时(可以)?停` 等只认"咨询师**提供**暂停/拒答权利", 不认来访者自己的状态;
 *      - `记住(?!你我)` 排除"他们会一直记住我"（不是带给来访者的内容）;
 *      - `下一步(谈|做|练|安排|计划|一起|我们|再|是)` 排除"把下一步交给她"
 *        "再决定下一步"（会话内动作, 不是收束安排）。
 */
const STRUCTURE_RULES: readonly StructureRule[] = [
  {
    key: 'confidentiality',
    label: '保密与例外',
    window: 'opening',
    groups: [
      {
        id: 'secrecy',
        label: '保密承诺',
        patterns: [
          '保密',
          '隐私',
          '秘密',
          '不会(告诉|透露|泄露|外传)',
          '不会说(?!话)',
          '不(告诉|透露|泄露|外传)别人',
          '不告诉(别人|任何人|第三方)',
          '只用于(咨询|这一次|这次)',
          '仅用于',
          '咨询内容',
        ],
      },
      {
        id: 'exception',
        label: '例外情形',
        patterns: [
          '(例外|除非)',
          '(自伤|自杀|自残|轻生|想死)',
          '(生命危险|人身危险|危险的时候|危险情况|危险时)',
          '紧急(情况|时)',
          '(法律|司法|法院|公安|监管)',
          '需要(联系|通知|告知)',
          '(保护你|你的安全)',
        ],
      },
    ],
  },
  {
    key: 'boundary',
    label: '设置边界',
    window: 'opening',
    groups: [
      {
        id: 'setting',
        label: '框架设置',
        patterns: ['(设置|设定)', '框架', '(约定|规则)', '(边界|界限)', '(工作方式|咨询方式|合作方式)'],
      },
      {
        id: 'limit',
        label: '边界限制',
        patterns: [
          // `(?<!能)` 排除"能不能"（提问, 不是限制）; `(?<!可)` 排除"可不可以"。
          '(?<!能)不能(?!不)',
          '(?<!可)不可以',
          '不做',
          '(不评判|不评价|不指责)',
          '(不给建议|不替你决定|不替你做|不替你)',
          '(只做|仅限于|限于)',
          '(范围之内|之内)',
          '(不强迫|不着急)',
          '不会(强迫|评判|评价|替你)',
        ],
      },
    ],
  },
  {
    key: 'duration',
    label: '时长与频率',
    window: 'opening',
    groups: [
      {
        id: 'length',
        label: '单次时长',
        patterns: [
          String.raw`(\d+|[一二两三四五六七八九十半]+)(个)?(分钟|小时)`,
          '时长',
          '每次(会谈|咨询|谈)[0-9一二两三四五六七八九十半]+(分钟|小时)',
          '会谈(时间|时长)[0-9一二两三四五六七八九十半]+(分钟|小时)',
        ],
      },
      {
        id: 'cadence',
        label: '会谈频率',
        patterns: ['每[周隔]', '(频次|频率)', '(多久一次|多长时间一次)', '(间隔|持续性)', '长期', '(一个月|一周)一次'],
      },
    ],
  },
  {
    key: 'pauseRefusal',
    label: '可暂停与可拒答',
    window: 'opening',
    groups: [
      {
        id: 'pause',
        label: '可暂停',
        patterns: [
          '随时(可以)?停',
          '喊停',
          '暂停',
          '停下来(也|都|随时)',
          '想停(下来)?就停',
          '我们可以(随时)?停',
          '中断',
          '结束(咨询|会谈)',
          '提前结束(会谈|咨询)',
        ],
      },
      {
        id: 'refuse',
        label: '可拒答',
        patterns: [
          '可以拒绝',
          '有权拒绝',
          '拒绝的权利',
          '(不回答|不用回答|不必回答|可以不答)',
          '不想说(就)?(可以)?不说',
          '可以不说',
          '不用勉强(自己)?说',
          '不必勉强',
          '跳过',
        ],
      },
    ],
  },
  {
    key: 'recording',
    label: '录音与知情同意',
    window: 'opening',
    groups: [
      {
        id: 'recording',
        label: '录音录像',
        patterns: ['(录音|录像|录制|录音笔)'],
      },
      {
        id: 'consent',
        label: '知情同意',
        patterns: [
          '知情同意',
          '知情',
          '(同意|征求(你的)?同意|征求(你的)?意见|授权)',
          '录音[，,]?(时|的话)?(你)?(同意|愿意|可以|好)吗',
          '录像[，,]?(时|的话)?(你)?(同意|愿意|可以|好)吗',
          '录制[，,]?(时|的话)?(你)?(同意|愿意|可以|好)吗',
        ],
      },
    ],
  },
  {
    key: 'summary',
    label: '总结本次理解',
    window: 'closing',
    groups: [SUMMARY_ACTION_GROUP, SUMMARY_UNDERSTANDING_GROUP],
  },
  {
    key: 'takeaway',
    label: '来访者带走内容',
    window: 'closing',
    groups: [
      {
        id: 'carry',
        label: '带走内容',
        patterns: [
          '(带走|带回去|拿回去|带一句|带一个)',
          '(留给你|给你留)',
          '记住(?!我)(?!你)',
          '(记下来|记一下)',
          '写下来',
          '(这几句话|这张纸|这张卡)',
        ],
      },
    ],
  },
  {
    key: 'nextStep',
    label: '下一步安排',
    window: 'closing',
    groups: [
      {
        id: 'arrangement',
        label: '下一步安排',
        patterns: [
          '下次(会谈|我们|再|聊|见|开始|之前|有|安排)',
          '下一次(会谈|我们|再见|再聊|之前)',
          '下一阶段',
          '接下来(我们|这几天|这一周|这段时间)',
          '(这周之内|下周)',
          '(再约|预约)',
          '作业',
          '(每日|日常|回去)记录',
          '回去(之后|可以|试着)',
          '下一步(谈|做|练|安排|计划|一起|我们|再|是)',
        ],
      },
    ],
  },
];

/**
 * 危机信号（全稿扫描，咨询师与来访者台词都算）。
 *
 * 只用于判断"这场是否需要危机收束"，不用于评分。
 */
const CRISIS_PATTERNS: readonly string[] = [
  '(自杀|自伤|自残|轻生|想死|不想活|活着没意思|伤害自己)',
  '(活不下去|结束生命|一了百了)',
  '(危机状态|处于危机|危机干预)',
];

/**
 * 咨询师侧危机评估信号。
 *
 * 与来访者自述分开：咨询师做"确认安全 / 伤害自己的东西 / 风险评估"属于危机场景识别，
 * 不是危机自述；开场保密例外里的"自伤"不能算。
 */
const CRISIS_COUNSELOR_PATTERNS: readonly string[] = ['(确认你的安全|伤害自己的东西|自杀|想死|轻生|自伤风险|风险评估|危机状态|危机干预)'];

/**
 * 危机收束五组。
 *
 * 覆盖判据与常规收束不同：至少命中 2 组，且必须含 means/channel/contact 之一。
 * 理由：只做 grounding（锚定当下）不等于风险收束；必须至少触及"移除危险物 /
 * 求助渠道 / 可联系的人"其中一项，才算把风险往外托住。
 */
const RISK_CLOSING_RULES: readonly StructureGroup[] = [
  {
    id: 'means',
    label: '移除危险物 / 开放安全空间',
    patterns: [
      '(药物|药|剪刀|刀|利器|绳子|绳|锐器).{0,16}(移开|放远|拿走|收起来|放到|扔|推出|锁)',
      '(移开|放远|拿走|收起来|放到|扔|推出|锁).{0,16}(药物|药|剪刀|刀|利器|绳子|绳|锐器)',
      '(开门|开着的门|把门打开|门打开)',
    ],
  },
  {
    id: 'channel',
    label: '求助渠道',
    patterns: ['(120|110|急诊|热线|12356|危机干预|心理援助)'],
  },
  {
    id: 'contact',
    label: '可联系的人',
    patterns: [
      '(联系|打给|找|叫).{0,10}(家人|朋友|邻居|同事|可信任|联系人|至少两个|两个人)',
      '(家人|朋友|邻居|同事|可信任|联系人).{0,10}(联系|陪|过来|电话|过来陪)',
    ],
  },
  {
    id: 'noAlone',
    label: '不要独处',
    patterns: ['(不要|别|不能).{0,8}(一个人|独处|独自|自己待)', '(有人|找人|让人).{0,6}(陪|陪着你|陪你)', '陪着你', '不要独处'],
  },
  {
    id: 'commitment',
    label: '安全承诺 / 安全计划',
    patterns: ['(安全|底线).{0,8}(计划|安排|承诺|约定)', '(答应我|向我保证|保证).{0,8}(安全|不伤害|不打|不做)'],
  },
];

/** 轮次标题。 */
const TURN_HEADING = /^###\s*第\s*(\d+)\s*轮/;

/**
 * 咨询师台词行.
 *
 * 冒号后**不再**加 `[ \t]*`: 那样会与尾部的 `(.*)` 产生歧义（同一段空白既可被
 * `[ \t]*` 吃掉、也可被 `(.*)` 吃掉），在长台词上会退化成超线性回溯。
 * 解析侧统一 `trim()`，效果相同。
 */
const COUNSELOR_LINE = /^\*\*咨询师\*\*[ \t]*[：:](.*)$/;

/** 来访者台词行（同上, 避免超线性回溯）。 */
const VISITOR_LINE = /^\*\*来访者\*\*[ \t]*[：:](.*)$/;

/** 句子/行断点。 */
const BREAK_CHARS = ['。', '！', '？', '；', ';', '\n'];

/** 空的要素结果（键缺失时的兜底, 不吐 undefined）。 */
const EMPTY_ELEMENT: StructureElementResult = {
  covered: false,
  evidence: '',
  evidenceTurns: [],
  matchedGroups: [],
  missingGroups: [],
};

/** 子组命中。 */
interface GroupHit {
  readonly turnIndex: number;
  readonly excerpt: string;
}

/**
 * 拼接一段续行文本。
 *
 * @param current 已有的文本
 * @param addition 续行
 * @returns 拼接后的文本
 */
function appendText(current: string, addition: string): string {
  return current === '' ? addition : `${current}\n${addition}`;
}

/**
 * 解析 packet Markdown 为轮次序列。
 *
 * 支持的形态:
 *   `### 第 N 轮` 标题行 + `**咨询师**：…` / `**来访者**：…` 台词行;
 *   台词可以跨多行（续行归属它上面最近的那个角色行）。
 *
 * @param markdown packet Markdown 原文
 * @returns 轮次序列（按出现顺序; 轮号取标题里的数字）
 */
export function parsePacketMarkdown(markdown: string): SessionStructureTurn[] {
  const turns: { turnIndex: number; counselor: string; visitor: string }[] = [];
  let current: { turnIndex: number; counselor: string; visitor: string } | null = null;
  let role: 'counselor' | 'visitor' | null = null;
  for (const rawLine of String(markdown ?? '').split(/\r?\n/)) {
    const heading = TURN_HEADING.exec(rawLine);
    if (heading) {
      current = { turnIndex: Number(heading[1]), counselor: '', visitor: '' };
      turns.push(current);
      role = null;
      continue;
    }
    if (!current) continue;
    const counselor = COUNSELOR_LINE.exec(rawLine);
    if (counselor) {
      current.counselor = counselor[1].trim();
      role = 'counselor';
      continue;
    }
    const visitor = VISITOR_LINE.exec(rawLine);
    if (visitor) {
      current.visitor = visitor[1].trim();
      role = 'visitor';
      continue;
    }
    const continuation = rawLine.trim();
    if (continuation === '' || !role) continue;
    if (role === 'counselor') current.counselor = appendText(current.counselor, continuation);
    else current.visitor = appendText(current.visitor, continuation);
  }
  return turns;
}

/**
 * 找出命中位置之前最近的断点（断点之后即句子起点）。
 *
 * @param text 原文
 * @param index 命中位置
 * @returns 句子起点下标
 */
function sentenceStart(text: string, index: number): number {
  const before = text.slice(0, index);
  let start = 0;
  for (const marker of BREAK_CHARS) {
    const position = before.lastIndexOf(marker);
    if (position >= start) start = position + 1;
  }
  return start;
}

/**
 * 找出命中位置之后最近的断点（断点本身即句子终点）。
 *
 * @param text 原文
 * @param index 命中位置
 * @returns 句子终点下标
 */
function sentenceEnd(text: string, index: number): number {
  let end = -1;
  for (const marker of BREAK_CHARS) {
    const position = text.indexOf(marker, index);
    if (position !== -1 && (end === -1 || position < end)) end = position;
  }
  return end < 0 ? text.length : end;
}

/**
 * 抽取命中位置的原文短句（最多 EXCERPT_MAX_CHARS 字）。
 *
 * @param text 原文
 * @param index 命中位置
 * @returns 短句
 */
function excerptAround(text: string, index: number): string {
  const start = sentenceStart(text, index);
  const end = sentenceEnd(text, index);
  const raw = text.slice(start, end);
  if (raw.length <= EXCERPT_MAX_CHARS) return raw.replaceAll(/\s+/g, ' ').trim();
  const from = Math.max(start, index - 18);
  const to = Math.min(end, from + EXCERPT_MAX_CHARS);
  return `${text.slice(from, to).replaceAll(/\s+/g, ' ').trim()}…`;
}

/**
 * 在窗口内匹配一个子组（逐轮逐正则, 每轮只记第一条命中的正则）。
 *
 * @param group 子组
 * @param turns 窗口内的轮次
 * @returns 命中列表
 */
function matchGroup(group: StructureGroup, turns: readonly SessionStructureTurn[]): GroupHit[] {
  const hits: GroupHit[] = [];
  for (const turn of turns) {
    const text = turn.counselor;
    if (text.trim() === '') continue;
    for (const source of group.patterns) {
      const match = new RegExp(source).exec(text);
      if (!match) continue;
      hits.push({ turnIndex: turn.turnIndex, excerpt: excerptAround(text, match.index) });
      break;
    }
  }
  return hits;
}

/**
 * 判定一个结构要素（所有子组都命中才算覆盖）。
 *
 * @param rule 规则
 * @param turns 窗口内的轮次
 * @returns 要素判定结果
 */
function buildElementResult(rule: StructureRule, turns: readonly SessionStructureTurn[]): StructureElementResult {
  const matchedGroups: string[] = [];
  const missingGroups: string[] = [];
  const excerpts: string[] = [];
  const turnsHit: number[] = [];
  for (const group of rule.groups) {
    const hits = matchGroup(group, turns);
    if (hits.length === 0) {
      missingGroups.push(group.id);
      continue;
    }
    matchedGroups.push(group.id);
    for (const hit of hits) {
      if (!turnsHit.includes(hit.turnIndex)) turnsHit.push(hit.turnIndex);
      if (excerpts.length < EXCERPT_MAX_COUNT) excerpts.push(hit.excerpt);
    }
  }
  return {
    covered: missingGroups.length === 0,
    evidence: excerpts.join(' ｜ '),
    evidenceTurns: turnsHit.toSorted((left, right) => left - right),
    matchedGroups,
    missingGroups,
  };
}

/**
 * 判定 summary：要求"总结动作"和"理解复述"落在同一轮或相邻 1 轮内。
 *
 * 不能跨多轮拼接：中间轮次的"梳理/我听到"不是收尾总结。
 *
 * @param turns 收束窗口内的轮次
 * @returns summary 判定结果
 */
function buildSummaryResult(turns: readonly SessionStructureTurn[]): StructureElementResult {
  const actionHits = matchGroup(SUMMARY_ACTION_GROUP, turns);
  const understandingHits = matchGroup(SUMMARY_UNDERSTANDING_GROUP, turns);
  const matchedGroups: string[] = [];
  const missingGroups: string[] = [];
  if (actionHits.length > 0) matchedGroups.push(SUMMARY_ACTION_GROUP.id);
  else missingGroups.push(SUMMARY_ACTION_GROUP.id);
  if (understandingHits.length > 0) matchedGroups.push(SUMMARY_UNDERSTANDING_GROUP.id);
  else missingGroups.push(SUMMARY_UNDERSTANDING_GROUP.id);

  const pair = actionHits
    .flatMap((action) => understandingHits.map((understanding) => ({ action, understanding })))
    .find(({ action, understanding }) => Math.abs(action.turnIndex - understanding.turnIndex) <= 1);
  if (!pair) {
    const excerpts = [...actionHits, ...understandingHits].slice(0, EXCERPT_MAX_COUNT).map((hit) => hit.excerpt);
    return {
      covered: false,
      evidence: excerpts.join(' ｜ '),
      evidenceTurns: [...actionHits, ...understandingHits]
        .map((hit) => hit.turnIndex)
        .toSorted((left, right) => left - right)
        .filter((turn, index, all) => all.indexOf(turn) === index),
      matchedGroups,
      missingGroups,
    };
  }
  return {
    covered: true,
    evidence: [pair.action.excerpt, pair.understanding.excerpt].join(' ｜ '),
    evidenceTurns: [pair.action.turnIndex, pair.understanding.turnIndex]
      .toSorted((left, right) => left - right)
      .filter((turn, index, all) => all.indexOf(turn) === index),
    matchedGroups,
    missingGroups: [],
  };
}

/** 空的危机收束结果。 */
const EMPTY_RISK_CLOSING: Record<RiskClosingElementKey, StructureElementResult> = {
  means: EMPTY_ELEMENT,
  channel: EMPTY_ELEMENT,
  contact: EMPTY_ELEMENT,
  noAlone: EMPTY_ELEMENT,
  commitment: EMPTY_ELEMENT,
};

/**
 * 判定危机收束。
 *
 * @param turns 收束窗口内的轮次
 * @returns 五组结果
 */
function buildRiskClosing(turns: readonly SessionStructureTurn[]): Record<RiskClosingElementKey, StructureElementResult> {
  const result: Record<RiskClosingElementKey, StructureElementResult> = { ...EMPTY_RISK_CLOSING };
  const matchedGroups: string[] = [];
  const missingGroups: string[] = [];
  const excerpts: string[] = [];
  const turnsHit: number[] = [];
  for (const group of RISK_CLOSING_RULES) {
    const hits = matchGroup(group, turns);
    if (hits.length === 0) {
      missingGroups.push(group.id);
      continue;
    }
    matchedGroups.push(group.id);
    for (const hit of hits) {
      if (!turnsHit.includes(hit.turnIndex)) turnsHit.push(hit.turnIndex);
      if (excerpts.length < EXCERPT_MAX_COUNT) excerpts.push(hit.excerpt);
    }
  }
  const covered = matchedGroups.length >= 2 && matchedGroups.some((id) => id === 'means' || id === 'channel' || id === 'contact');
  const shared: StructureElementResult = {
    covered,
    evidence: excerpts.join(' ｜ '),
    evidenceTurns: turnsHit.toSorted((left, right) => left - right),
    matchedGroups,
    missingGroups,
  };
  for (const key of RISK_CLOSING_ELEMENT_KEYS) {
    const group = RISK_CLOSING_RULES.find((rule) => rule.id === key);
    const hits = group ? matchGroup(group, turns) : [];
    result[key] = {
      ...shared,
      covered: hits.length > 0,
      evidence: hits
        .slice(0, EXCERPT_MAX_COUNT)
        .map((hit) => hit.excerpt)
        .join(' ｜ '),
      evidenceTurns: hits.map((hit) => hit.turnIndex).filter((turn, index, all) => all.indexOf(turn) === index),
      matchedGroups: hits.length > 0 ? [key] : [],
      missingGroups: hits.length > 0 ? [] : [key],
    };
  }
  return result;
}

/** 常规收束文本判定结果（供 runner 在收尾轮做内容门）。 */
export interface ClosingTextEvaluation {
  /** 三项是否全部覆盖。 */
  readonly complete: boolean;
  /** 未覆盖的要素键。 */
  readonly missing: readonly ClosingElementKey[];
  /** 逐要素结果。 */
  readonly elements: ClosingStructureAudit;
}

/** 危机收束文本判定结果（供 runner 在升级安全序列做内容门）。 */
export interface RiskClosingTextEvaluation {
  /** 五组是否全部覆盖（比审计口径的“至少 2 组”更严，用于安全修复轮）。 */
  readonly complete: boolean;
  /** 未覆盖的要素键。 */
  readonly missing: readonly RiskClosingElementKey[];
  /** 逐要素结果。 */
  readonly elements: Record<RiskClosingElementKey, StructureElementResult>;
}

/**
 * 判定一段咨询师正文的常规收束三件套。
 *
 * ⚠️ 只用于 runner 的**内容门**：收尾轮里模型输出 END 时，若三项不齐则挡回继续；
 * 不改变 `af127-v1` 审计口径，也不产出临床结论。
 *
 * @param text 收尾窗口内咨询师正文（多轮用换行拼接）
 * @returns 三项覆盖结果与缺失键
 */
export function evaluateRoutineClosingText(text: string): ClosingTextEvaluation {
  const turns: SessionStructureTurn[] = [{ turnIndex: 1, counselor: text, visitor: '' }];
  const map = auditWindow(turns, 'closing');
  const elements = buildClosing(map);
  const missing = CLOSING_ELEMENT_KEYS.filter((key) => !elements[key].covered);
  return { complete: missing.length === 0, missing, elements };
}

/**
 * 按**多轮**判定常规收束，保留轮次索引。
 *
 * 与 {@link evaluateRoutineClosingText} 的区别：后者把多轮正文拼成一轮，
 * 会把“第 1 轮说总结、第 9 轮说我听到”误判成同一轮的总结。结构审计
 * 要求 summary 的“总结动作”和“理解复述”落在同一轮或相邻 1 轮内，本函数
 * 与审计口径一致；runner 用它判断是否还需要最终收束。
 *
 * @param texts 收束窗内各轮咨询师正文（按时间顺序）
 * @returns 三项覆盖结果与缺失键
 */
export function evaluateRoutineClosingTurns(texts: readonly string[]): ClosingTextEvaluation {
  const turns: SessionStructureTurn[] = texts.map((text, index) => ({
    turnIndex: index + 1,
    counselor: text,
    visitor: '',
  }));
  const map = auditWindow(turns, 'closing');
  const elements = buildClosing(map);
  const missing = CLOSING_ELEMENT_KEYS.filter((key) => !elements[key].covered);
  return { complete: missing.length === 0, missing, elements };
}

/**
 * 最终收束的确定性补全。
 *
 * 只在最终收束轮使用：模型若仍漏掉 summary / takeaway / nextStep，按缺失项
 * 追加可审计的固定句式，保证结构审计拿到完整三段；不伪造评分，不改阈值。
 * 补全文本仍以咨询师口吻输出，不引入诊断或承诺。
 *
 * @param text 模型原始最终收束
 * @param visitorAnchor 来访者最后一轮原话（用于 summary 的具体复述）
 * @returns 补齐后的收束正文
 */
export function completeRoutineClosingText(text: string, visitorAnchor: string): string {
  const anchor = visitorAnchor.replaceAll(/\s+/g, ' ').trim().slice(0, 120);
  const lines = [text.trim()];
  const evaluation = evaluateRoutineClosingText(lines.join('\n'));
  if (evaluation.complete) return lines.join('\n');

  if (evaluation.missing.includes('summary')) {
    lines.push(`我总结一下今天的谈话。我听到你提到，${anchor || '你今天愿意把这些说出来'}。`);
  }
  if (evaluation.missing.includes('takeaway')) {
    lines.push('你可以带走一句话：你愿意把这些说出来，本身就说明你比自己以为的更有力量。');
  }
  if (evaluation.missing.includes('nextStep')) {
    lines.push('下次我们再见面之前，你可以试试：把今天最想改变的一件小事写下来，下次带来。');
  }

  const completed = lines.join('\n');
  // 第二次校验兜底：若规则仍未全中（例如模型原文已有半句），追加完整三段。
  return evaluateRoutineClosingText(completed).complete
    ? completed
    : [
        completed,
        `我总结一下今天的谈话。我听到你提到，${anchor || '你今天愿意把这些说出来'}。`,
        '你可以带走一句话：你愿意把这些说出来，本身就说明你比自己以为的更有力量。',
        '下次我们再见面之前，你可以试试：把今天最想改变的一件小事写下来，下次带来。',
      ].join('\n');
}

/**
 * 判定一段咨询师正文的危机收束五组。
 *
 * ⚠️ `complete` 要求**五组全部命中**；这与审计聚合里的 `riskClosingComplete`
 * （至少 2 组且含 means/channel/contact 之一）不是同一口径，后者保持 `af127-v1` 不变。
 *
 * @param text 升级后安全序列内咨询师正文（评估轮 + 计划轮/修复轮用换行拼接）
 * @returns 五组覆盖结果与缺失键
 */
export function evaluateRiskClosingText(text: string): RiskClosingTextEvaluation {
  const turns: SessionStructureTurn[] = [{ turnIndex: 1, counselor: text, visitor: '' }];
  const elements = buildRiskClosing(turns);
  const missing = RISK_CLOSING_ELEMENT_KEYS.filter((key) => !elements[key].covered);
  return { complete: missing.length === 0, missing, elements };
}

/**
 * 全稿扫描危机信号（咨询师与来访者台词都算）。
 *
 * @param turns 全部轮次
 * @returns 是否检测到危机信号
 */
/**
 * 全稿扫描危机信号。
 *
 * 只扫来访者台词：咨询师开场保密例外里的"自伤"是边界说明，不是危机信号；
 * 把咨询师台词一起扫会把每场都判成危机，导致收束口径失真。
 *
 * @param turns 全部轮次
 * @returns 是否检测到危机信号
 */
function containsCrisis(turns: readonly SessionStructureTurn[]): boolean {
  return turns.some((turn) => {
    if (CRISIS_PATTERNS.some((pattern) => new RegExp(pattern).test(turn.visitor))) return true;
    // 开场保密例外里的"自伤"是边界说明, 不是危机评估.
    if (turn.counselor.includes('保密') && turn.counselor.includes('例外')) return false;
    return CRISIS_COUNSELOR_PATTERNS.some((pattern) => new RegExp(pattern).test(turn.counselor));
  });
}

/**
 * 在一个窗口里判定所有属于该窗口的要素。
 *
 * @param turns 窗口内的轮次
 * @param window 窗口名
 * @returns 要素结果表
 */
function auditWindow(
  turns: readonly SessionStructureTurn[],
  window: 'opening' | 'closing',
): Map<StructureElementKey, StructureElementResult> {
  const result = new Map<StructureElementKey, StructureElementResult>();
  for (const rule of STRUCTURE_RULES) {
    if (rule.window !== window) continue;
    result.set(rule.key, rule.key === 'summary' ? buildSummaryResult(turns) : buildElementResult(rule, turns));
  }
  return result;
}

/**
 * 取要素结果（缺失时给空结果, 不吐 undefined）。
 *
 * @param map 要素结果表
 * @param key 要素键
 * @returns 要素结果
 */
function pickElement<T extends StructureElementKey>(
  map: ReadonlyMap<StructureElementKey, StructureElementResult>,
  key: T,
): StructureElementResult {
  return map.get(key) ?? EMPTY_ELEMENT;
}

/**
 * 算出窗口的轮号范围。
 *
 * @param turns 窗口内的轮次
 * @returns 范围
 */
function windowOf(turns: readonly SessionStructureTurn[]): StructureWindow {
  const first = turns.at(0);
  const last = turns.at(-1);
  if (!first || !last) return { from: 0, to: 0 };
  return { from: first.turnIndex, to: last.turnIndex };
}

/**
 * 组装开场框架结果。
 *
 * @param map 要素结果表
 * @returns 开场结果
 */
function buildOpening(map: ReadonlyMap<StructureElementKey, StructureElementResult>): OpeningStructureAudit {
  return {
    confidentiality: pickElement(map, 'confidentiality'),
    boundary: pickElement(map, 'boundary'),
    duration: pickElement(map, 'duration'),
    pauseRefusal: pickElement(map, 'pauseRefusal'),
    recording: pickElement(map, 'recording'),
  };
}

/**
 * 组装结束收束结果。
 *
 * @param map 要素结果表
 * @returns 收束结果
 */
function buildClosing(map: ReadonlyMap<StructureElementKey, StructureElementResult>): ClosingStructureAudit {
  return {
    summary: pickElement(map, 'summary'),
    takeaway: pickElement(map, 'takeaway'),
    nextStep: pickElement(map, 'nextStep'),
  };
}

/**
 * 收束模式判定。
 *
 * @param crisisDetected 是否检测到危机信号
 * @param riskClosingComplete 危机收束是否覆盖
 * @param routineClosingComplete 常规收束是否三项齐全
 * @returns 收束模式
 */
function resolveClosingMode(crisisDetected: boolean, riskClosingComplete: boolean, routineClosingComplete: boolean): ClosingMode {
  if (crisisDetected) return riskClosingComplete ? 'risk' : 'risk-incomplete';
  return routineClosingComplete ? 'routine' : 'none';
}

/**
 * 审计一个 packet 的结构。
 *
 * @param packetId packet id
 * @param turns 逐轮输入
 * @returns 结构审计结果
 */
export function auditSessionStructure(packetId: string, turns: readonly SessionStructureTurn[]): SessionStructureAudit {
  const sorted = [...turns].toSorted((left, right) => left.turnIndex - right.turnIndex);
  const total = sorted.length;
  const openingTurns = sorted.slice(0, OPENING_WINDOW_TURNS);
  const closingTurns = sorted.slice(Math.max(0, total - CLOSING_WINDOW_TURNS));
  const opening = buildOpening(auditWindow(openingTurns, 'opening'));
  const closing = buildClosing(auditWindow(closingTurns, 'closing'));
  const crisisDetected = containsCrisis(sorted);
  const riskClosing = buildRiskClosing(closingTurns);
  const riskMatchedCount = RISK_CLOSING_ELEMENT_KEYS.filter((key) => riskClosing[key].covered).length;
  const riskClosingComplete =
    riskMatchedCount >= 2 && (riskClosing.means.covered || riskClosing.channel.covered || riskClosing.contact.covered);
  const routineClosingComplete = CLOSING_ELEMENT_KEYS.every((key) => closing[key].covered);
  const closingMode = resolveClosingMode(crisisDetected, riskClosingComplete, routineClosingComplete);
  return {
    packetId,
    turnCount: total,
    counselorTurns: sorted.filter((turn) => turn.counselor.trim() !== '').length,
    openingWindow: windowOf(openingTurns),
    closingWindow: windowOf(closingTurns),
    opening,
    closing,
    crisisDetected,
    riskClosing,
    closingMode,
    riskClosingComplete,
    openingComplete: OPENING_ELEMENT_KEYS.every((key) => opening[key].covered),
    closingComplete: closingMode === 'risk' || closingMode === 'routine',
  };
}

/**
 * 算单个要素的覆盖率。
 *
 * @param audits 逐 packet 结果
 * @param coveredOf 取该要素是否覆盖
 * @returns 覆盖率
 */
function coverageStat(
  audits: readonly SessionStructureAudit[],
  coveredOf: (audit: SessionStructureAudit) => boolean,
): StructureCoverageStat {
  const covered = audits.filter((audit) => coveredOf(audit)).length;
  return { covered, total: audits.length, rate: audits.length === 0 ? 0 : covered / audits.length };
}

/**
 * 统计一个 packet 命中的结构证据数（按子组算, 半个要素也算数）。
 *
 * 口径: "部分覆盖" = 已经有结构证据, 但还没全项覆盖。
 * 只命中一个子组（例如只有"保密承诺"、缺"例外"）也是部分覆盖, 不是零覆盖。
 *
 * @param audit 逐 packet 结果
 * @returns 命中的子组数
 */
function matchedGroupCount(audit: SessionStructureAudit): number {
  const openingCount = OPENING_ELEMENT_KEYS.filter((key) => audit.opening[key].matchedGroups.length > 0).length;
  const closingCount = CLOSING_ELEMENT_KEYS.filter((key) => audit.closing[key].matchedGroups.length > 0).length;
  const riskCount = RISK_CLOSING_ELEMENT_KEYS.filter((key) => audit.riskClosing[key].matchedGroups.length > 0).length;
  return openingCount + closingCount + riskCount;
}

/**
 * 聚合多个 packet 的结构证据。
 *
 * @param audits 逐 packet 结果
 * @returns 聚合结果
 */
export function aggregateSessionStructure(audits: readonly SessionStructureAudit[]): SessionStructureAggregate {
  return {
    packetCount: audits.length,
    openingCoverage: {
      confidentiality: coverageStat(audits, (audit) => audit.opening.confidentiality.covered),
      boundary: coverageStat(audits, (audit) => audit.opening.boundary.covered),
      duration: coverageStat(audits, (audit) => audit.opening.duration.covered),
      pauseRefusal: coverageStat(audits, (audit) => audit.opening.pauseRefusal.covered),
      recording: coverageStat(audits, (audit) => audit.opening.recording.covered),
    },
    closingCoverage: {
      summary: coverageStat(audits, (audit) => audit.closing.summary.covered),
      takeaway: coverageStat(audits, (audit) => audit.closing.takeaway.covered),
      nextStep: coverageStat(audits, (audit) => audit.closing.nextStep.covered),
    },
    riskClosingCoverage: {
      means: coverageStat(audits, (audit) => audit.riskClosing.means.covered),
      channel: coverageStat(audits, (audit) => audit.riskClosing.channel.covered),
      contact: coverageStat(audits, (audit) => audit.riskClosing.contact.covered),
      noAlone: coverageStat(audits, (audit) => audit.riskClosing.noAlone.covered),
      commitment: coverageStat(audits, (audit) => audit.riskClosing.commitment.covered),
    },
    riskDetectedPackets: audits.filter((audit) => audit.crisisDetected).length,
    riskClosingCompletePackets: audits.filter((audit) => audit.riskClosingComplete).length,
    routineClosingCompletePackets: audits.filter((audit) => audit.closingMode === 'routine').length,
    closingModeCounts: {
      risk: audits.filter((audit) => audit.closingMode === 'risk').length,
      routine: audits.filter((audit) => audit.closingMode === 'routine').length,
      'risk-incomplete': audits.filter((audit) => audit.closingMode === 'risk-incomplete').length,
      none: audits.filter((audit) => audit.closingMode === 'none').length,
    },
    openingCompletePackets: audits.filter((audit) => audit.openingComplete).length,
    closingCompletePackets: audits.filter((audit) => audit.closingComplete).length,
    fullyCoveredPackets: audits.filter((audit) => audit.openingComplete && audit.closingComplete).length,
    partiallyCoveredPackets: audits.filter((audit) => matchedGroupCount(audit) > 0 && !(audit.openingComplete && audit.closingComplete))
      .length,
    status: 'candidate',
    gateEligible: false,
    disclaimer: SESSION_STRUCTURE_DISCLAIMER,
  };
}

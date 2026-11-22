// V2026-11-12 Phase3 P0 (文字层真人度 · 不流利词表与数值契约 · 纯模块):
//   职责: 六类不流利的词表 / 正则基元 / 叠词白名单 + 归一化函数 + 纯数值契约
//         (类型与聚合函数). analyzer / compute / 测试都只从这里取, 不复制第二份.
//   边界: 零 IO / 零框架 / 零随机; 纯函数, 同输入逐字节相同.
//
//   为什么「数值契约」也放在这里 (而不是只放在 analyzer):
//     隐私分层 (蓝图 §5.2.3): 纯计算层 batch-metrics.compute.ts 只允许 import
//     不含文本处理的数值契约, **不得 import analyzer** (analyzer 是唯一接触
//     台词原文的模块). 所以类型 + 聚合函数住在本模块, analyzer 原样 re-export ——
//     对外 API 形状仍与蓝图 §5.2.1 一致 (可从 disfluency-analyzer.js 导入).
//
//   词表性质: **工程种子值, 非临床标定** (与 visitor-quality-lexicon.ts 同款纪律);
//   P1 跑完基线批次后再校准 (见蓝图 §6 P1).
//
// ── AF-204 · 自我修正 (repair) 口径纠偏 ────────────────────────────────────
//   旧口径 (REPAIR_TRIGGERS 子串命中) 把「是不是」「我不是本地人」这类**否定判断**
//   误计为自我修正, 导致 repair_per_turn 系统性虚高. 现拆成两套:
//     · 严格口径 (主口径): STRICT_REPAIR_* + REPAIR_NEGATION_* 规则集,
//       只有真正的改口/重述才计 (「不对，我是……」「应该是……」「换个说法」);
//     · 宽松口径 (仅审计): REPAIR_TRIGGERS 原样保留, 供口径对照.

import { round6 } from './round.js';

/** 六类不流利的计数 (纯数值). */
export interface DisfluencyCounts {
  readonly filler: number;
  readonly pause: number;
  readonly repetition: number;
  readonly repair: number;
  readonly trailoff: number;
  readonly elongation: number;
}

/** 单轮的不流利度量 (纯数值, 无任何文本引用). */
export interface DisfluencyMetrics {
  readonly counts: DisfluencyCounts;
  /** 不流利事件总数 (六类之和). */
  readonly events: number;
  /** 本轮是否含至少一次不流利 (聚合层用它算轮次占比). */
  readonly hasEvent: boolean;
  /** 文本归一化字符数 (密度分母; 不暴露原文). */
  readonly normalizedLength: number;
}

/** 零值结构 (未命中 visitor 台词时的兜底: 六类计数 0 / events 0 / hasEvent false / 长度 0). */
export const EMPTY_DISFLUENCY_METRICS: DisfluencyMetrics = {
  counts: { filler: 0, pause: 0, repetition: 0, repair: 0, trailoff: 0, elongation: 0 },
  events: 0,
  hasEvent: false,
  normalizedLength: 0,
};

/**
 * 填充词词表 (位置敏感) —— ⚠️ 工程种子值, 非临床标定.
 *
 * 口径纪律 (蓝图 §5.1 第 3 条): 「然后 / 其实 / 就是 / 那个」既是填充词也是正常词,
 * 只统计**句首**或**被标点隔离**的命中, 句中正常承接不计入, 避免系统性高估.
 */
export const FILLER_WORDS: readonly string[] = ['嗯', '呃', '那个', '就是', '然后', '其实', '怎么说', '你让我想想', '我想想', '怎么讲'];

/**
 * 自我修正触发词 (宽松口径 · 历史遗留, ⚠️ 不再用于主口径).
 *
 * AF-204 之前的口径是**子串命中即计一次**自我修正, 已知假阳性:
 *   · 「是不是」       → 疑问句被当成改口;
 *   · 「我不是本地人」 → 普通否定判断被当成改口;
 *   · 「不是什么 / 否定判断」类表达 → 同上.
 *
 * 本词表**保留导出**仅供口径审计对照 (见 disfluency-analyzer 的 countLooseRepairs),
 * 主口径改用下面的严格规则集 (STRICT_REPAIR_* / REPAIR_NEGATION_*).
 */
export const REPAIR_TRIGGERS: readonly string[] = ['不对', '等等', '不是', '应该是', '换个说法', '算了', '其实也不是'];

/**
 * 严格改口标记 (无条件计) —— 自我修正的**显式**标记.
 *
 * 「应该是 / 换个说法」只可能是说话人在改口, 不会被正常口语占用.
 */
export const STRICT_REPAIR_MARKERS: readonly string[] = ['应该是', '换个说法'];

/**
 * 严格改口标记 (子句开头 **或** 后接纠正线索时才计) —— 「不对 / 算了」.
 *
 * 「你说得不对」「这不对」是评价而不是改口, 所以只在
 *   ① 位于子句开头 (文本起点或紧跟标点), 或
 *   ② 同一子句后文出现纠正线索 ("这不对，应该是这样")
 * 时才计.
 */
export const STRICT_REPAIR_BOUNDARY_MARKERS: readonly string[] = ['不对', '算了'];

/**
 * 等待型标记 (必须后接纠正线索才计) —— 「等等」.
 *
 * 「等等」本身是话语标记 ("等一下"), 只有后面接了改述才构成自我修正
 * ("等等，我刚说错了").
 */
export const STRICT_REPAIR_WAIT_MARKERS: readonly string[] = ['等等'];

/**
 * 纠正线索: 出现在改口标记之后、同一子句内 → 该标记构成真正的改口.
 */
export const REPAIR_FOLLOWUP_CUES: readonly string[] = ['不对', '不是', '其实', '应该', '说错', '搞错', '改成', '重来', '我是说', '或者说'];

/**
 * 否定词「不是」后接这些引导词时算自我修正 (不限位置) —— 「不是 A 而是 B」.
 */
export const REPAIR_NEGATION_STRONG_FOLLOWERS: readonly string[] = ['而是'];

/**
 * 否定词「不是」后接这些引导词时, **还必须**位于子句开头才算自我修正 —— 「不是这样」.
 */
export const REPAIR_NEGATION_WEAK_FOLLOWERS: readonly string[] = ['这样', '那样'];

/**
 * 否定词「不是」后接这些标点时算自我修正 —— 「不是，其实……」.
 *
 * ⚠️ 不含句号与问号: 「不是。」是独立否定回答, 「不是？」是反问, 都不是改口.
 */
export const REPAIR_NEGATION_PUNCTUATION: ReadonlySet<string> = new Set(['，', ',', '、', '；', ';', '：', ':', '…']);

/**
 * 前瞻边界 (找「后接纠正线索」时遇到这些字符就停) —— 句末标点 + 省略号.
 *
 * 与 SENTENCE_END_PUNCTUATION 的区别: 后者只用于「句首」判定; 本表服务于
 * 「改口标记后面同一子句里还有没有纠正线索」的前瞻搜索.
 */
export const LOOKAHEAD_STOP_CHARS: ReadonlySet<string> = new Set(['。', '！', '？', '；', '…', '.', '!', '?', ';']);

/**
 * 叠词白名单 (不计 repetition) —— ⚠️ 工程种子值.
 *
 * 前 12 个取自蓝图附录 A; 后 6 个是常见合法叠词, 补进来是为了避免把
 * 「刚刚 / 渐渐 / 常常 / 往往 / 偏偏 / 仅仅」这类正常词误判成口吃式重复.
 */
export const REPETITION_WHITELIST: ReadonlySet<string> = new Set([
  '妈妈',
  '爸爸',
  '宝宝',
  '慢慢',
  '一点点',
  '看看',
  '想想',
  '说说',
  '聊聊',
  '试试',
  '好好',
  '轻轻',
  '刚刚',
  '渐渐',
  '常常',
  '往往',
  '偏偏',
  '仅仅',
]);

/**
 * 拖音词干 (保守识别) —— ⚠️ 工程种子值.
 *
 * 只认蓝图附录 A 列的显式形态 (嗯—— / 哎——); 其他破折号是正常破折号,
 * 不当拖音 (避免把「我——」这种打断用法误判成拖音).
 */
export const ELONGATION_STEMS: readonly string[] = ['嗯', '哎'];

/**
 * 标点字符类 —— **与 scripts/ops/quality/visitor-quality-audit.ts:266 的字符类逐字一致**.
 *
 * 这是「归一化口径对齐」的事实源: audit 的 normalize 是脚本内私有函数、未 export,
 * 纯模块无法 import, 故此处照抄同一张表 (见交付记录「归一化逐项对照」).
 */
export const PUNCTUATION_CHARS = '，。！？、,.!?；;：:"“”\'‘’()（）…—-';

/** 由标点字符类构造的正则 (字符类里没有右方括号 / 反斜杠 / 插入符, 破折号在末尾, 无需转义). */
const PUNCTUATION_PATTERN = new RegExp('[' + PUNCTUATION_CHARS + ']', 'g');

/** 句末标点 (用于「句首」判定: 前一个字符是句末标点即视为新句开头). */
export const SENTENCE_END_PUNCTUATION: ReadonlySet<string> = new Set(['。', '！', '？', '；']);

/** 所有标点 (用于「被标点隔离」判定). */
export const PUNCTUATION_SET: ReadonlySet<string> = new Set(PUNCTUATION_CHARS);

/** 匹配「相邻 1-2 个汉字重复」的正则基元 (只认汉字, 不碰拉丁字母与数字). */
export const REPETITION_PATTERN = /([\u4E00-\u9FFF]{1,2})\1/g;

/** 匹配「拖音词干 + 破折号拖长」的正则基元. */
export const ELONGATION_PATTERN = new RegExp('(' + ELONGATION_STEMS.join('|') + ')——', 'g');

/**
 * 半截话启发式阈值: 句末停顿前那一截的**最小字数**.
 *
 * 低于阈值视为普通句末停顿 (pause), 达到阈值视为「话说一半没说完」 (trailoff).
 * ⚠️ 工程种子值, 待 P1 基线校准.
 */
export const TRAILOFF_MIN_CHARS = 4;

/**
 * 归一化 (长度口径) —— 与 audit :266-268 **逐字等价**: 去空白 → 去标点.
 *
 * 用途: normalizedLength (密度分母). 与审计脚本的字符统计口径一致, 两边可比.
 *
 * @param text 原始文本
 * @returns 归一化后的文本
 */
export function normalizeForLength(text: string): string {
  return text.replaceAll(/\s+/g, '').replaceAll(PUNCTUATION_PATTERN, '');
}

/**
 * 归一化 (识别口径) —— 去空白 + 标点**归一** (保留可识别标记).
 *
 * 与长度口径的差别 (为什么必须分两个):
 *   长度口径按 audit :266 把标点全删 (含省略号与破折号), 适合算字符数;
 *   识别口径必须**保留**省略号 (停顿) 与破折号 (拖音) 这两个可识别标记 ——
 *   若用删标点的口径, pause / elongation 永远命中不了.
 *
 * 归一化动作:
 *   ① 去所有空白 (与 audit 同款);
 *   ② 连续句点 / 省略号 / 句号串 → 单个省略号 (停顿合并);
 *   ③ 破折号 (单破折号 / 双破折号 / 连字符) → 双破折号 (拖音标记统一).
 *
 * @param text 原始文本
 * @returns 识别用归一化文本
 */
export function normalizeForDetection(text: string): string {
  return text
    .replaceAll(/\s+/g, '')
    .replaceAll(/\.{2,}|…+|。{2,}/g, '…')
    .replaceAll(/-{2,}|—+/g, '——');
}

/**
 * 聚合一轮组的不流利数值 (纯数值, 不碰文本).
 *
 * 口径 (蓝图附录 B):
 *   eventsPerTurn      = 事件总数 ÷ 纳入轮数;
 *   eventTurnRate      = 含事件轮次 ÷ 纳入轮数;
 *   densityPer100Chars = 事件总数 ÷ 归一化总字符数 × 100;
 *   typeCounts         = 六类各自的事件总数.
 *
 * @param turns 逐轮度量
 * @returns 聚合结果
 */
export function aggregateDisfluency(turns: readonly DisfluencyMetrics[]): {
  readonly eventsPerTurn: number;
  readonly eventTurnRate: number;
  readonly densityPer100Chars: number;
  readonly typeCounts: DisfluencyCounts;
} {
  let totalEvents = 0;
  let totalChars = 0;
  let eventTurns = 0;
  const typeCounts: { filler: number; pause: number; repetition: number; repair: number; trailoff: number; elongation: number } = {
    filler: 0,
    pause: 0,
    repetition: 0,
    repair: 0,
    trailoff: 0,
    elongation: 0,
  };
  for (const turn of turns) {
    totalEvents += turn.events;
    totalChars += turn.normalizedLength;
    if (turn.hasEvent) eventTurns += 1;
    typeCounts.filler += turn.counts.filler;
    typeCounts.pause += turn.counts.pause;
    typeCounts.repetition += turn.counts.repetition;
    typeCounts.repair += turn.counts.repair;
    typeCounts.trailoff += turn.counts.trailoff;
    typeCounts.elongation += turn.counts.elongation;
  }
  const turnCount = turns.length;
  return {
    eventsPerTurn: turnCount > 0 ? round6(totalEvents / turnCount) : 0,
    eventTurnRate: turnCount > 0 ? round6(eventTurns / turnCount) : 0,
    densityPer100Chars: totalChars > 0 ? round6((totalEvents / totalChars) * 100) : 0,
    typeCounts,
  };
}

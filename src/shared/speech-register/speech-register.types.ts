// AF-462 · 来访者语域指纹（Speech Register）类型契约.
// 边界: 纯类型 + 常量, 零 IO / 零 Nest / 零 engine-core 改动.
// 语域属于"怎么说", 不属于 BDI 的"想不想说 / 说多少 / 什么情绪".

export const SPEECH_REGISTER_VERSION = 'speech-register-v1';

export const SPEECH_REGISTER_MODES = ['off', 'audit', 'active'] as const;

export type SpeechRegisterMode = (typeof SPEECH_REGISTER_MODES)[number];

export const EDUCATION_BANDS = ['basic', 'vocational', 'undergraduate', 'postgraduate'] as const;

export type EducationBand = (typeof EDUCATION_BANDS)[number];

export const REGION_MACROS = ['north', 'east', 'south', 'central', 'northeast', 'west', 'unknown'] as const;

export type RegionMacro = (typeof REGION_MACROS)[number];

export const SOCIAL_CONTEXTS = [
  'urban_salaried',
  'shift_work',
  'service_sector',
  'student',
  'part_time',
  'caregiver',
  'small_town',
  'rural_migrant',
  'retired',
  'unemployed',
] as const;

export type SocialContext = (typeof SOCIAL_CONTEXTS)[number];

export const DIRECTNESS_LEVELS = ['direct', 'indirect', 'guarded'] as const;

export type DirectnessLevel = (typeof DIRECTNESS_LEVELS)[number];

export const POLITENESS_LEVELS = ['plain', 'polite', 'deferential'] as const;

export type PolitenessLevel = (typeof POLITENESS_LEVELS)[number];

export const DISCLOSURE_LEVELS = ['open', 'selective', 'guarded'] as const;

export type DisclosureLevel = (typeof DISCLOSURE_LEVELS)[number];

export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;

export type AgeBand = (typeof AGE_BANDS)[number];

/** 语域漂移只读状态; 由渲染层从本轮 BDI 快照映射, 内核不感知语域. */
export interface SpeechRegisterDriftState {
  readonly emotion: {
    readonly label: 'neutral' | 'sad' | 'anxious' | 'angry' | 'hurt' | 'guarded' | 'relieved' | 'hopeful' | 'ashamed' | 'empty';
    readonly valence: number;
    readonly arousal: number;
  };
  readonly resistance: {
    readonly verbal: number;
    readonly depth: number;
    readonly style: number;
  };
  readonly riskLevel: 'none' | 'medium' | 'high';
}

/** 角色语域指纹: 可审计、可版本化、可灰度. */
export interface SpeechRegister {
  readonly version: typeof SPEECH_REGISTER_VERSION;
  readonly roleKey: string;
  readonly identity: {
    readonly ageBand: AgeBand;
    readonly occupation: string;
    readonly educationBand: EducationBand;
    readonly livingStatus: string;
    readonly regionMacro: RegionMacro;
  };
  readonly socialContext: readonly SocialContext[];
  /** 0..1; 只影响词汇层, 不做口音 / 谐音 / 方言发音. */
  readonly dialectStrength: number;
  readonly vocabulary: {
    /** 0..1; 越高越能/越习惯用抽象词. */
    readonly abstractTermBudget: number;
    /** 0..1; 越高越会带行业术语. */
    readonly jargonBudget: number;
    /** 0..1; 越高越依赖具体人 / 事 / 时间 / 地点. */
    readonly concreteAnchorDensity: number;
  };
  readonly syntax: {
    /** 平均每句字数, 4..40. */
    readonly averageSentenceLength: number;
    /** 0..1; 越高越容忍半句 / 改口 / 重复. */
    readonly fragmentTolerance: number;
    /** 0..1; 越高越常用"因为/但是/其实"这类连接词. */
    readonly connectiveUse: number;
  };
  readonly stance: {
    readonly directness: DirectnessLevel;
    readonly politeness: PolitenessLevel;
    readonly disclosure: DisclosureLevel;
  };
  /** 生活锚点: 排班 / 房租 / 孩子 / 通勤这类具体话题, 不是标签. */
  readonly anchors: readonly string[];
  /** 标志词: 这个角色偶尔会说的口语词, 一轮最多一两个. */
  readonly signatureLexicon: readonly string[];
  /** 避用词: 这个角色不会说的术语 / 助手腔 / 评价性标签. */
  readonly avoidLexicon: readonly string[];
  /** 正例: 2-3 句这个角色可能说出来的话. */
  readonly sampleLines: readonly string[];
  /** 反例: 1-2 句明显不像这个角色的话, 用于负向约束. */
  readonly antiSampleLines: readonly string[];
}

/** 语域配置审计摘要; 只含计数与告警码, 不含台词原文. */
export interface SpeechRegisterAuditSummary {
  readonly version: string;
  readonly roleKey: string;
  readonly signatureCount: number;
  readonly anchorCount: number;
  readonly sampleCount: number;
  readonly antiSampleCount: number;
  readonly renderedLength: number;
  readonly warnings: readonly string[];
}

/** 灰度选择结果; audit 模式只产出摘要, 不注入 prompt. */
export interface SpeechRegisterSelection {
  readonly mode: SpeechRegisterMode;
  readonly register?: SpeechRegister;
  readonly audit?: SpeechRegisterAuditSummary;
  readonly reason?: string;
}

/** 台词层面的确定性语域指标 (用于离线评测 / 回归, 不替代人工盲评). */
export interface SpeechRegisterMetrics {
  readonly roleKey: string;
  readonly charCount: number;
  readonly sentenceCount: number;
  readonly averageSentenceLength: number;
  readonly fragmentRate: number;
  readonly abstractTermRate: number;
  readonly jargonRate: number;
  readonly signatureHitRate: number;
  readonly anchorDensity: number;
}

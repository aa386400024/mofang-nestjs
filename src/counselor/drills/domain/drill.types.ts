// V2026-10-27 治本 (边界压力 + 危机识别会内突发 — 情景演练领域模型):
//   原因: 任务单 `docs/progress/boundary-pressure-and-crisis-drill-backend-2026-10-27.md`
//     §1 拍板一个与 practice **平行**的轻量模块 (情景演练 drill): 本期只填两个 track
//     (boundary=设置压力测试 / crisis=危机识别会内突发), 单节点单轮, 确定性判定为主,
//     零压无分, 不落库.
//     这套模型一旦上线就是**对外契约** (drillId 是稳定 slug, 字段名会被前端直接消费),
//     所以类型定义必须一次性定死, 不能随实现漂移.
//
//   修法: 本文件是 drill 领域的**唯一类型出处** (config / dto / service / 测试全部从这里
//     import), 与 `domain/practice/practice.types.ts` 同一范式.
//
//   ── 反双胞胎 (重点) ──
//   - **不新建** tone / source / difficulty 三套枚举: 三者的取值与语义与既有模块**完全同构**
//     (零压批注三态 / keyword-vs-llm 产出来源 / 1-2-3 难度梯), 直接复用:
//       · tone   → PracticeFeedbackTone   (positive / warning / info)
//       · source → PracticeFeedbackSource (keyword / llm)
//       · 难度    → PracticeDifficulty     (L1=1 / L2=2 / L3=3, 任务单 §1.2 明确"沿用
//                    PracticeDifficulty 口径")
//     另起一套同值枚举 = 双胞胎: 两边必然漂移, 且前端拿到的 wire 值相同 → 没有收益.
//   - **不落 DB ENUM**: 赛道是应用层字符串 (任务单 §1.1 拍板), 二期加 track 只加数据不改骨架.
//   - **不把 nodes/branches 实现成逻辑**: 二期多轮分支才用, 本期恒为空数组 (留字段不留逻辑).
//
//   验证:
//     1. tsc 0 错
//     2. config → dto → service → 测试全链路引用同一份 interface (改一处编译期全链路报错)
//     3. drillId 为稳定 slug: 一旦发布即对外契约, 不改名
//   时间戳: 2026-10-27 19:35 GMT+8

import { PracticeDifficulty } from '../../enums/practice-difficulty.enum';
import { PracticeFeedbackSource } from '../../enums/practice-feedback-source.enum';
import { PracticeFeedbackTone } from '../../enums/practice-feedback-tone.enum';

/**
 * 情景演练赛道 (应用层字符串, 不落 DB ENUM).
 *
 * - `boundary`: 设置压力测试 —— 练"守住会谈设置"的**技术形态** (三档, 非评分).
 * - `crisis`:  危机识别会内突发 —— 只练"识别信号 + 开放式探问 + 平稳引导求助".
 *
 * 二期预留: `after_hours_message` / `ethical_dilemma` / `counter_transference`.
 */
export type DrillTrack = 'boundary' | 'crisis';

/** 赛道取值全集 (校验 / DTO enum 用). */
export const DRILL_TRACK_VALUES: readonly DrillTrack[] = ['boundary', 'crisis'];

/**
 * boundary 赛道的**技术形态标签** (三档).
 *
 * 硬约束: 这是**形态描述**, 不是分数、不是对错、不是等级.
 * 前端展示文案不得出现"得分 / 及格 / 失败" (任务单 §2.3 零压口径).
 */
export type DrillVerdict = 'over_compromise' | 'steady_firm' | 'abrupt_refusal';

/** verdict 取值全集 (校验 / DTO enum 用). */
export const DRILL_VERDICT_VALUES: readonly DrillVerdict[] = ['over_compromise', 'steady_firm', 'abrupt_refusal'];

/**
 * 单条判定锚点 (确定性关键词兜底用; LLM 仅做措辞润色, 不做事实判定).
 */
export interface DrillPoint {
  /** 稳定 key (如 `namesEmotion` / `holdsBoundary` / `openProbe`). */
  key: string;
  /** 中文名 (前端覆盖清单直接展示). */
  label: string;
  /** 命中即视为做到的正向关键词/短语. */
  positiveKeywords: string[];
  /** 命中即提示越位/让步的反向关键词/短语. */
  antiKeywords: string[];
  /**
   * 未覆盖该锚点时的**方向提示** (可选).
   *
   * 任务单 §3.2 要求: crisis 的遗漏点要给"这里可以多问一句"式的方向提示,
   * 而不是一句"没做到"的判词. 提示语跟锚点放在一起 → 判定引擎保持通用,
   * 内容 (措辞) 留在剧本侧, 二期加 track 不用改引擎.
   */
  missedHint?: string;
}

/**
 * 表层人设 (称呼 / 年龄 / 性别 / 职业 / 一句背景).
 *
 * 危机剧本用中性化名, 不写真实病史 / 创伤细节.
 */
export interface DrillPersona {
  /** 来访者称呼. */
  name: string;
  /** 年龄. */
  age: number;
  /** 性别. */
  gender: string;
  /** 职业. */
  occupation: string;
  /** 一句背景. */
  background: string;
}

/**
 * 多轮节点 (二期预留, 本期恒为 []).
 */
export interface DrillNode {
  nodeId: string;
  speaker: 'visitor' | 'counselor';
  text: string;
  next?: string;
}

/**
 * 分支走向 (二期预留, 本期恒为 []).
 */
export interface DrillBranch {
  fromNode: string;
  condition: string;
  toNode: string;
  label: string;
}

/**
 * 情景剧本 (静态 TS 常量, 走 config, 不落库 / 不进 migration).
 */
export interface DrillScript {
  /** 稳定 slug (发布后即对外契约, 不改名). */
  drillId: string;
  /** 赛道. */
  track: DrillTrack;
  /** 难度 1/2/3 (沿用 PracticeDifficulty 口径, 仅排序/展示). */
  difficulty: PracticeDifficulty;
  /** 列表页标题 (任务单 §4.1 列表出参). */
  title: string;
  /** 表层人设. */
  persona: DrillPersona;
  /** 场景一句话说明 (给用户看的任务背景). */
  setting: string;
  /** 来访者抛出的那句话 (首条气泡直接展示). */
  visitorPrompt: string;
  /** 本场景要求覆盖的技术点 (boundary=三档判定锚点; crisis=探问/引导维度). */
  requiredPoints: DrillPoint[];
  /** 参考回应 ("可以参考这样回应", 只给方向). */
  referenceResponse: string;
  /** 常见偏差 (批注卡"留意避免"). */
  commonPitfalls: string[];
  /** 本场景专属边界声明 (crisis 必填, 沿用非临床口径; boundary 可空用通用声明). */
  boundaryNotice?: string;

  // ── 二期预留 (本期恒为 [], 勿实现逻辑) ──
  /** 多轮节点 (二期). */
  nodes: DrillNode[];
  /** 分支走向 (二期). */
  branches: DrillBranch[];
}

/**
 * 单条零压技术批注.
 *
 * `pointKey` 锚定到某个 requiredPoint; `text` 只描述技术动作, 不评价人.
 */
export interface DrillItem {
  /** 语气三态 (positive / warning / info) —— 复用练习引擎同款三态. */
  tone: PracticeFeedbackTone;
  /** 锚定的技术点 key. */
  pointKey: string;
  /** 批注文案 (只做技术描述). */
  text: string;
}

/**
 * 判定结果 (通用结构; 出参由 DTO 逐字段映射).
 */
export interface DrillJudgement {
  /**
   * 仅 boundary 有值: 三档技术形态标签 (不是分数、不是对错).
   * crisis 恒为 null.
   */
  verdict: DrillVerdict | null;
  /** 已覆盖的技术点 key 清单. */
  coveredPointKeys: string[];
  /** 未覆盖的技术点 key 清单. */
  missedPointKeys: string[];
  /** 3-5 条零压技术批注. */
  items: DrillItem[];
}

/**
 * 判定结果 + 出参素材 + 产出来源 (服务层出参的领域形态; DTO 逐字段映射它).
 *
 * 字段与任务单 §1.3 的 `DrillResponse` 逐字对齐 (不含任何分数字段).
 */
export interface DrillEvaluation extends DrillJudgement {
  /** 剧本稳定 slug (对外契约, 不改名). */
  drillId: string;
  /** 赛道. */
  track: DrillTrack;
  /** 产出来源: keyword (确定性兜底) / llm (模型润色). */
  source: PracticeFeedbackSource;
  /** 参考回应 (开练前不下发, 判定后才给). */
  referenceResponse: string;
  /** 常见偏差 (留意避免). */
  commonPitfalls: string[];
}

/**
 * boundary 赛道的锚点 key (三档判定的固定语义位).
 *
 * 为什么用**固定 key**而不是"每个脚本自由命名": 三档判定是**跨脚本通用**的判定规则,
 * 若锚点 key 由脚本自由命名, 判定引擎就得靠"猜"哪个 key 才是"守住设置"那个 →
 * 规则无法泛化, 新增脚本必然要改引擎. 固定 key = 引擎只认语义位, 新增脚本只填内容.
 */
export const DRILL_BOUNDARY_ANCHOR_KEYS = {
  /** 共情 / 命名感受. */
  EMPATHY: 'namesEmotion',
  /** 守住设置 (含"答应类"反向词 → over_compromise). */
  HOLDS_BOUNDARY: 'holdsBoundary',
  /** 给出可行替代路径. */
  OFFERS_ALTERNATIVE: 'offersAlternative',
} as const;

/**
 * crisis 赛道的锚点 key (覆盖清单的固定语义位).
 */
export const DRILL_CRISIS_ANCHOR_KEYS = {
  /** 开放式探问 (而非评判式 / 急着给建议). */
  OPEN_PROBE: 'openProbe',
  /** 保持不评判 (不否定、不淡化). */
  NON_JUDGMENTAL: 'nonJudgmental',
  /** 平稳引导到专业求助路径 (通用引导, 不含号码). */
  GUIDE_TO_SUPPORT: 'guideToSupport',
} as const;

/**
 * 判定锚点 key 的全集 (自检用).
 */
export const DRILL_ANCHOR_KEYS: readonly string[] = [
  ...Object.values(DRILL_BOUNDARY_ANCHOR_KEYS),
  ...Object.values(DRILL_CRISIS_ANCHOR_KEYS),
];

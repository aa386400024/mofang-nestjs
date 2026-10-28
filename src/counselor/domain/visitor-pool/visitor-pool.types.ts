// V2026-10-23 治本 (AI 模拟来访池 — 领域契约: 公共模板表层卡片 / 临场参数层 / 实例化产物):
//   原因: spec `docs/specs/counselor-visitor-pool.md` §1 把终态拆成**两层模型**:
//     ① 人物内容层 Persona  = 这个人是谁 (公共模板 + 实例化私有副本)
//     ② 临场参数层 SessionPreset = 这场会谈他呈现得多接近预期 (情绪/防御数值/难度/模式/种子)
//     这两层若在 DTO / entity / prompt / service 各写一份, 必然 drift —— 尤其
//     「临场参数只作用本场、不回写人物」这条不变量, 没有单一真值源就守不住.
//
//   修法: 本文件是来访池领域契约的**唯一真值源**:
//     - VisitorPoolCard         表层卡片 (公共响应唯一允许出现的形态; 绝不含 script)
//     - VisitorPoolSessionPreset 临场参数 (本场有效, 不落人物表)
//     - VisitorPoolDefaultPreset 实例化响应里返回的「微调起点」
//     - VisitorPoolGeneratedTemplate LLM 结构化产出的形状 (card + script)
//
//   反双胞胎:
//     - 不把 script 塞进 VisitorPoolCard: 剧本 (7 大块: 成长时间线 / 内在工作模型 /
//       隐性创伤 ...) 是 AI 独享层, 公共接口下发就等于破防信息分层 (spec §4 红线).
//       类型层面分开, 出参层面就不可能顺手带出去.
//     - 不新建「难度」「配合风格」「训练模式」的孪生类型: 直接复用仓库既有的
//       TrainingDifficulty / VisitorStyle / VisitorMode (见 enums/visitor-pool.enum.ts 注释).
//     - 不把临场参数做成 entity: spec §2.3 明确「不建表」, 随会话启动参数透传.
//       做成 entity 会在库里留下「本场情绪基线」这种易被误当成人物属性的数据.
//     - 不用 `Partial<T>` 表达「可覆盖」: 覆盖语义 (缺省 = 人物默认) 与「部分字段」
//       不是一回事, 混用会让调用方分不清「没传」与「传了 undefined」.
//
//   验证:
//     1. tsc 0 错
//     2. grep 'script' 于本文件 → 只出现在 VisitorPoolGeneratedTemplate, 卡片类型里没有
//     3. 公共 DTO (visitor-pool.dto.ts) 只引用 VisitorPoolCard, 不引用 script
//
//   时间戳: 2026-10-23

import type { TrainingDifficulty } from '../../enums/training-difficulty.enum';
import type { VisitorMode } from '../../enums/visitor-mode.enum';
import type { VisitorPoolDefenseType, VisitorPoolIssueDomain, VisitorPoolSource } from '../../enums/visitor-pool.enum';
import type { VisitorStyle } from '../../enums/visitor-style.enum';
import type { VisitorFullPersonaScript } from '../visitor-persona/visitor-persona.types';

// ════════════════════════════════════════════════════════════════════════════
// ① 人物内容层: 表层卡片
// ════════════════════════════════════════════════════════════════════════════

/**
 * 公共模板 · 表层卡片.
 *
 * 这是**公共接口唯一允许出现的形态** (spec §3.1 / §3.2 / §3.3).
 * 契约要点:
 *   - 不含 `script` (7 大块剧本是 AI 独享层)
 *   - 不含任何计数字段 (零压红线: 不下发收藏数/使用数/评分)
 *   - `favorited` 是**本人状态**, 不含任何他人信息
 */
export interface VisitorPoolCard {
  /** 公共模板 id (对外契约: 图鉴详情 / 实例化 / 收藏三个路径都用它) */
  readonly templateId: string;
  /**
   * 匿名称呼 (中性乳名, 由后端命名规则维护).
   *
   * 规则: 1-3 字, 不带姓、不用法律式全名、不用强性别字、不用「来访者 · X」系统视角标签;
   * 撞名时挂去重尾号 (如「晚晴 · 07」). 详见 config/visitor-pool-codename.ts.
   */
  readonly codename: string;
  /** 年龄区间, 例「28-35」 (不给精确生日, 避免可识别) */
  readonly ageRange: string;
  /** 初次见面主动呈现的一句话主诉 (卡片副标题) */
  readonly presentingComplaint: string;
  /** 主导防御类型 (人物属性, 临场锁定不可改) */
  readonly defenseType: VisitorPoolDefenseType;
  /** 议题领域 (筛选 + 标签) */
  readonly issueDomain: VisitorPoolIssueDomain;
  /** 推荐训练目标, 例「练开放式提问与情绪反射」 */
  readonly trainingGoal: string;
  /** 难度档 (配合度梯度) */
  readonly difficulty: TrainingDifficulty;
  /** 案例来源 (本期恒为 official) */
  readonly source: VisitorPoolSource;
  /** 本人是否已收藏 (**仅本人状态**, 不含全站计数) */
  readonly favorited: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// ② 临场参数层: SessionPreset
// ════════════════════════════════════════════════════════════════════════════

/**
 * 临场参数 (spec §1 ② / §2.3).
 *
 * **只作用本场, 绝不回写人物**. 落到人物表就是"用人物属性表达临场状态", 后续无法区分.
 *
 * 每一项都可选: 缺省 = 人物默认值 (模板的 `*_default` 列).
 */
export interface VisitorPoolSessionPreset {
  /** 情绪基线 0-1 (在人物默认值上覆盖) */
  readonly emotionBaseline?: number | undefined;
  /** 防御水平 0-1 (数值覆盖, **不是**换防御类型) */
  readonly defenseLevel?: number | undefined;
  /** 难度档 (在人物默认值上覆盖) */
  readonly difficulty?: TrainingDifficulty | undefined;
  /** 训练模式: 按我设置 / 完全真实 */
  readonly mode?: VisitorMode | undefined;
  /** 随机种子 (完全真实模式下重 roll 用) */
  readonly randomSeed?: string | undefined;
}

/**
 * 实例化响应里返回的「微调起点」.
 *
 * = 人物默认值 + 本次覆盖后的**生效值**. 缺省调用时它恒等于人物默认值.
 * 前端准备页拿它做滑杆初值, 会话启动时拿它做本场参数 —— 单一真值源, 不用前端再拼一次.
 */
export interface VisitorPoolDefaultPreset {
  /** 配合风格 (实例化时写入副本, 决定 AI 呈现姿态) */
  readonly styleHint: VisitorStyle;
  /** 生效的情绪基线 0-1 */
  readonly emotionBaseline: number;
  /** 生效的防御水平 0-1 */
  readonly defenseLevel: number;
  /** 生效的难度档 */
  readonly difficulty: TrainingDifficulty;
  /** 生效的训练模式 */
  readonly mode: VisitorMode;
  /** 生效的随机种子 (未指定时由服务端生成) */
  readonly randomSeed: string;
}

// ════════════════════════════════════════════════════════════════════════════
// ③ LLM 结构化产出 (内部生成端点)
// ════════════════════════════════════════════════════════════════════════════

/**
 * LLM 一次产出的完整内容 (spec §3.5.1: 顶层输出为 `{ card, script }`).
 *
 * `source` 不在 card 里 —— 案例来源由后端固定写 `official`, 不让 LLM 填
 * (模型填的来源是"自称", 不可信).
 */
export interface VisitorPoolGeneratedTemplate {
  /** 表层卡片元字段 (落模板表的表层列) */
  readonly card: {
    readonly codename: string;
    readonly ageRange: string;
    readonly presentingComplaint: string;
    readonly defenseType: VisitorPoolDefenseType;
    readonly issueDomain: VisitorPoolIssueDomain;
    readonly trainingGoal: string;
    readonly difficulty: TrainingDifficulty;
    readonly styleHint: VisitorStyle;
    readonly emotionBaselineDefault: number;
    readonly defenseLevelDefault: number;
  };
  /** 7 大块全量剧本 (落模板表的 script 列, **公共接口不下发**) */
  readonly script: VisitorFullPersonaScript;
}

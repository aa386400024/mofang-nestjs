// V2026-10-23 治本 (Voice 会话契约 — 模式 / 临场参数 / 演练登记, spec §2.1/§2.2):
//   原因: v2.0 (语音对语音) 是在 v1.0 (纯文字) 的基座上加的, 而 v1.0 要求的握手参数
//     (`templateId` / `mode` / 临场参数) 在本仓**尚未落地** (2026-10-23 扫描:
//     `grep -rn "template_not_found" src` → 0 命中). 本文件把"这一轮会谈怎么演"的
//     全部输入收敛成 3 个类型, 避免同一份语义在 gateway / service / counselor 三处
//     各写一份字符串字面量 (改一次档位名要改 3 处, 漏一处就静默走默认值).
//   分层 (依赖倒置):
//     - 本文件在 **voice (agent 侧)**: 只描述"协议层需要的形状", 不认识任何 counselor 类型
//     - counselor 侧把自己的 enum 显式映射过来 (不 cast), 映射表见 counselor 侧 contributor
//   反双胞胎:
//     - 不在 voice 侧 import counselor 的 enum: agent → business 是反向依赖, 会成环
//     - 不用 enum: 这些值要跨"前端 query 字符串 / WS 协议 / 业务 enum"三层, 用字面量联合最省心
//   验证:
//     1. tsc 0 错
//     2. grep -rn "templateId" src/voice → 命中本文件与 gateway
//   时间戳: 2026-10-23

import type { VoiceSkillCode } from '../shared/types/voice-skill.types';

/**
 * 会话模式.
 *
 * - `text`: 纯文字闭环 (不启动 TTS, 不发任何音频帧)
 * - `voice`: 逐句出声 (LLM 流直推官方 bidi TTS, 服务端按句攒 mp3 回传)
 */
export type VoiceSessionMode = 'text' | 'voice';

/** 难度档 (与 counselor `TrainingDifficulty` 值同形). */
export type VoiceDifficulty = 'L1' | 'L2' | 'L3';

/** 来访者配合风格 (与 counselor `VisitorStyle` 值同形). */
export type VoiceVisitorStyle = 'defensive' | 'cooperative' | 'resistant' | 'avoidant' | 'mixed';

/**
 * 扮演模式.
 *
 * 本期 (spec §5) `fullyReal` **不做随机扰动**, 只记录进日志, 不改行为.
 */
export type VoiceVisitorMode = 'useMySettings' | 'fullyReal';

/**
 * 专项训练技巧码 (V2026-10-26, spec §任务 1).
 *
 * **定义在 shared** (src/shared/types/voice-skill.types.ts): 该码值要同时被 counselor 侧
 * (来访者聚焦) 与 agent 侧 (督导事后专项反馈) 消费, 而 agent 侧不得 import counselor.
 * 放 shared 是唯一能让两侧都只依赖中立层的家. 本文件只做**转出**, 保证 voice 侧
 * 现有的 `import type { VoiceSkillCode } from './voice-session.types'` 引用全部照旧可用,
 * 且**全仓只有一份定义**.
 *
 * 注意: 上面那行 `import` 是**本文件内部**要用的 (VoicePersonaChannel /
 * VoiceSessionRegistration 里都引用了 VoiceSkillCode), 下面这行才是对外转出 ——
 * 两者缺一不可: 只写 `export type { X } from '...'` 的话, X 在本文件里**没有本地绑定**,
 * 本文件内引用 X 会报 "Cannot find name 'VoiceSkillCode'".
 */
export type { VoiceSkillCode };

/**
 * 本场生效的临场参数.
 *
 * 缺省来源优先级: 握手 query 覆盖 > 公共模板默认值 > 内置兜底值.
 */
export interface VoiceSessionPreset {
  /** 难度档 (越高 = 来访者越难被打开). */
  readonly difficulty: VoiceDifficulty;
  /** 配合风格. */
  readonly style: VoiceVisitorStyle;
  /** 情绪基线 0-1 (内在空洞感起点, 不直接说出来). */
  readonly emotionBaseline: number;
  /** 防御水平 0-1 (对"被看穿"的警觉度). 区别于模板固定的防御**类型**. */
  readonly defenseLevel: number;
  /** 扮演模式 (本期只记录). */
  readonly visitorMode: VoiceVisitorMode;
}

/**
 * 演练登记 (进程内内存, **不落库**).
 *
 * 用途: 让 counselor 侧的上下文贡献者按 sessionId 反查"这场会谈用的是哪个公共人物 +
 * 什么临场参数", 从而把 vpt 剧本注入 AI 来访者的 system prompt.
 */
export interface VoiceSessionRegistration {
  readonly sessionId: string;
  readonly userId: string;
  readonly tenantId: string;
  /** 会话模式. */
  readonly mode: VoiceSessionMode;
  /** 公共人物模板 id; null = 普通 voice session (走内置 persona 兜底). */
  readonly templateId: string | null;
  /**
   * 专项训练技巧码 (V2026-10-26, spec §任务 1).
   *
   * null = 全流程 / 个案 (不聚焦单一技巧). 登记下来是为了让 counselor 侧的上下文
   * 贡献者能按技巧给 AI 来访者"聚焦指令", 事后专项反馈也按它分流.
   */
  readonly skillCode: VoiceSkillCode | null;
  /** 本场生效的临场参数. */
  readonly preset: VoiceSessionPreset;
  /** 登记时间 (ms). */
  readonly createdAt: number;
}

/**
 * 公共来访模板的**表层摘要**.
 *
 * 刻意**不含** 7 大块剧本 (`script`): 剧本只在服务端内部读取, 绝不进任何跨模块契约
 * (公共接口不下发剧本是零压红线的结构性保证).
 */
export interface VoiceTemplateSummary {
  readonly templateId: string;
  /** 匿名称呼 (例「晚晴」). */
  readonly codename: string;
  /** 年龄区间 (例「28-35」) —— 不造精确年龄. */
  readonly ageRange: string;
  /** 初次见面主动呈现的一句话主诉. */
  readonly presentingComplaint: string;
  /** 模板默认难度. */
  readonly difficulty: VoiceDifficulty;
  /** 模板默认配合风格. */
  readonly styleHint: VoiceVisitorStyle;
  /** 模板默认情绪基线 0-1. */
  readonly emotionBaselineDefault: number;
  /** 模板默认防御水平 0-1. */
  readonly defenseLevelDefault: number;
  /** 主导防御类型 (模板固定, 握手不可覆盖). */
  readonly defenseType: string;
}

/**
 * 角色来源通道 (V2026-10-26, spec §任务 1 §1.1).
 *
 * 握手解析后, 这场会谈的"来访者从哪来"只有两种可能 —— 用**判别联合**表达, 而不是
 * 用一堆可空字段 (`templateId?` / `summary?` / `skillCode?` 各自可空) 让下游自己猜.
 * 可空字段的组合有 2^n 种, 其中大部分是"不可能出现"的状态, 而调用方分不清
 * "没传" 与 "传了但没查到" —— 这正是老实现把"无 templateId" 误报成
 * `template_not_found` 的根因.
 *
 * - `template`: 客户端指定了公共人物 (`templateId`), 且已上架 → 用该模板的表层摘要
 * - `fallback`: 客户端**没有**指定公共人物 (专项兜底 / 自定义人设来源) → 走兜底人设
 *   通道: 本期用 env 默认人物 / 标准陪练; 自定义结构化人涉嫌荷是 P2, 通道在此预留
 */
export type VoicePersonaChannel =
  | {
      readonly kind: 'template';
      /** 已上架的公共人物 id (登记用). */
      readonly templateId: string;
      /** 表层摘要; null = 模板已解析但摘要缺失 (只影响 prompt 细节, 不影响会话). */
      readonly summary: VoiceTemplateSummary | null;
    }
  | {
      readonly kind: 'fallback';
      /**
       * 专项训练技巧码 (null = 全流程 / 个案).
       *
       * 兜底通道靠它决定"标准陪练"要演成什么样 —— P2 的自定义结构化人设会在
       * 这个通道上再挂一层 `persona` 负载, 届时**不改动**本字段语义.
       */
      readonly skillCode: VoiceSkillCode | null;
    };

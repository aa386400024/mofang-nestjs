// V2026-11-18 治本 (AF-091 · Phase2.5 长会话档案):
//   职责: 把"一场对练聊多长 / 什么时候能自然收尾 / 什么时候算停滞 / 危机后置窗多长"
//     这四组阈值收敛成**可选档案**, 缺省 legacy = 与 2026-11-18 之前逐字一致.
//
// ── 为什么要有档案 (背景: 用户要 40-50 轮, 实际只有 20 多轮) ──────────────
//   根因不是模型不健谈, 是**判据写死了 15 轮**:
//     · DEFAULT_MAX_TURNS = 15            —— 循环上限;
//     · MIN_TURNS_BEFORE_CLOSE = 5        —— 第 5 轮起就允许自然收尾;
//     · 停滞阈值字面 2 / 无推进 3          —— 早停判据对长会话过敏;
//     · close-discipline 文案明确鼓励"该收就收".
//   咨询师第 6 轮就想收尾时, 系统**允许**它收尾 —— 于是 50 分钟的场次只跑 20 多轮.
//
// ── 三档 (数值是**产品决策**, 不是临床标定) ────────────────────────────────
//   legacy  : 既有行为 (15 轮 / 最早 5 轮收尾 / 停滞 2·3 / 危机窗 4) —— 缺省, 逐字不变;
//   standard: 30 轮档 (最早 20 轮收尾 / 停滞 3·4 / 危机窗 4);
//   long    : 50 分钟档 (上限 50 / 目标 40-50 / 最早 35 轮收尾 / 停滞 4·5 / 危机窗 6).
//
// ── 反双胞胎 ───────────────────────────────────────────────────────────────
//   - **纯函数, 零 IO / 零 env / 零 NestJS**: 档案是配置, 不是运行时状态.
//   - **缺省即 legacy**: 不传档案的调用方 (含既有标定脚本) 行为逐字不变.
//   - **不静默纠错**: HTTP 入口用 parseSessionProfile 明确报错;
//     队列里若混进脏档名, runner 回落 legacy 并**告警**, 不让整场对练崩掉.
//   - **档案不写库**: 本轮不新增 DB 列 (那是另一张单的活), 批次指纹里暂时看不到档案.

/** 会话档案名 (三档). */
export type SessionProfileName = 'legacy' | 'standard' | 'long';

/** 全部合法档案名 (入口校验用). */
export const SESSION_PROFILE_NAMES: readonly SessionProfileName[] = ['legacy', 'standard', 'long'];

/**
 * 一场对练的会话档案.
 *
 * ⚠️ 这些数值是**产品决策** (想要多长的咨询), 不是临床标定 (什么算好咨询).
 *   临床侧的档位在 docs/worklog/completed/phase2.5/af091-exit4-clinical-label-protocol-2026-11-18.md.
 */
export interface SessionProfile {
  /** 档位名. */
  readonly name: SessionProfileName;
  /** 循环轮数上限 (跑满即 exitReason=max_turns). */
  readonly maxTurns: number;
  /** 目标轮次 (写进 prompt 的"目标"); null = 本档不设目标轮次. */
  readonly targetTurns: number | null;
  /** 目标轮次区间 [下限, 上限] (写进 prompt); null = 本档不设目标轮次. */
  readonly targetTurnsBand: readonly [number, number] | null;
  /** 允许"自然收尾"的最早轮次 (此前咨询师的收尾请求一律不生效). */
  readonly minTurnsBeforeClose: number;
  /** 字面复读停滞阈值: 连续 N 次判重即判停滞. */
  readonly stagnantLiteralStreakLimit: number;
  /** 无推进停滞阈值: 连续 N 轮没有带来新信息即判停滞. */
  readonly stagnantNoProgressLimit: number;
  /** 危机后置练习窗轮数 (披露后继续练多少轮). */
  readonly crisisPracticeTurns: number;
}

/**
 * 判定用的阈值子集 (decideTurn 只关心这四个).
 *
 * 为什么要单独切出来: `decideTurn` 是纯函数, 它的判据**必须由调用方显式传入**,
 *   不能在函数体里读模块常量 —— 否则"哪一档阈值在生效"就永远只能靠猜.
 */
export interface SessionThresholds {
  /** 允许自然收尾的最早轮次. */
  readonly minTurnsBeforeClose: number;
  /** 字面复读停滞阈值. */
  readonly stagnantLiteralStreakLimit: number;
  /** 无推进停滞阈值. */
  readonly stagnantNoProgressLimit: number;
  /** 危机后置练习窗轮数. */
  readonly crisisPracticeTurns: number;
}

/** legacy 档: 与 2026-11-18 之前的生产行为**逐字一致**. */
export const LEGACY_SESSION_PROFILE: SessionProfile = {
  name: 'legacy',
  maxTurns: 15,
  targetTurns: null,
  targetTurnsBand: null,
  minTurnsBeforeClose: 5,
  stagnantLiteralStreakLimit: 2,
  stagnantNoProgressLimit: 3,
  crisisPracticeTurns: 4,
};

/** standard 档: 30 轮常规长度的对练. */
export const STANDARD_SESSION_PROFILE: SessionProfile = {
  name: 'standard',
  maxTurns: 30,
  targetTurns: 30,
  targetTurnsBand: [20, 30],
  minTurnsBeforeClose: 20,
  stagnantLiteralStreakLimit: 3,
  stagnantNoProgressLimit: 4,
  crisisPracticeTurns: 4,
};

/** long 档: 50 分钟咨询 (目标 40-50 轮). */
export const LONG_SESSION_PROFILE: SessionProfile = {
  name: 'long',
  maxTurns: 50,
  targetTurns: 45,
  targetTurnsBand: [40, 50],
  minTurnsBeforeClose: 35,
  stagnantLiteralStreakLimit: 4,
  stagnantNoProgressLimit: 5,
  crisisPracticeTurns: 6,
};

/** 全部档案 (按档位顺序). */
export const SESSION_PROFILES: readonly SessionProfile[] = [LEGACY_SESSION_PROFILE, STANDARD_SESSION_PROFILE, LONG_SESSION_PROFILE];

/** legacy 档的判定阈值 (decideTurn 的缺省值 = 老行为). */
export const LEGACY_SESSION_THRESHOLDS: SessionThresholds = {
  minTurnsBeforeClose: LEGACY_SESSION_PROFILE.minTurnsBeforeClose,
  stagnantLiteralStreakLimit: LEGACY_SESSION_PROFILE.stagnantLiteralStreakLimit,
  stagnantNoProgressLimit: LEGACY_SESSION_PROFILE.stagnantNoProgressLimit,
  crisisPracticeTurns: LEGACY_SESSION_PROFILE.crisisPracticeTurns,
};

/**
 * 这个字符串是不是合法档名.
 *
 * @param value 待校验的值 (HTTP body 里来的原始值)
 * @returns 是否是合法档名
 */
export function isSessionProfileName(value: unknown): value is SessionProfileName {
  return typeof value === 'string' && (SESSION_PROFILE_NAMES as readonly string[]).includes(value);
}

/**
 * 解析入口层给的档案名 (纯函数; 便于单测).
 *
 * ⚠️ **缺省即 legacy**: 空 / 缺省 → legacy (老调用方什么都不用改).
 * ⚠️ **非法值明确报错**: 不静默回落 —— 拼错的档名会跑出一批"看着像长会话"的普通数据,
 *   事后没人查得出来 (与 scenarioType 同款纪律).
 *
 * @param raw 入口传来的原始值
 * @returns 成功时给档名, 失败时给错误信息
 */
export function parseSessionProfile(raw?: unknown): { readonly value?: SessionProfileName; readonly error?: string } {
  if (raw === undefined || raw === null) return { value: 'legacy' };
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) return { value: 'legacy' };
  if (!isSessionProfileName(trimmed)) {
    return { error: `sessionProfile 非法: "${trimmed}" (合法取值: ${SESSION_PROFILE_NAMES.join(' / ')})` };
  }
  return { value: trimmed };
}

/**
 * 解析会话档案 (纯函数; 缺省 = legacy).
 *
 * ⚠️ 未知档名**回落 legacy 而不是抛异常**: 队列里的脏数据不该让整场对练崩掉.
 *   脏数据从 HTTP 进来时已经在 parseSessionProfile 被拦下 (入口层报错);
 *   这里的回落只是最后一道兜底, runner 会同时打一条告警说明"你要的档没生效".
 *
 * @param name 档名 (可缺省)
 * @returns 会话档案 (缺省 / 未知 = legacy)
 */
export function resolveSessionProfile(name?: string | null): SessionProfile {
  if (name === undefined || name === null) return LEGACY_SESSION_PROFILE;
  const trimmed = name.trim();
  if (trimmed.length === 0) return LEGACY_SESSION_PROFILE;
  if (!isSessionProfileName(trimmed)) return LEGACY_SESSION_PROFILE;
  return SESSION_PROFILES.find((profile) => profile.name === trimmed) ?? LEGACY_SESSION_PROFILE;
}

/**
 * 取档案的判定阈值 (decideTurn 的入参).
 *
 * @param profile 会话档案
 * @returns 阈值子集
 */
export function sessionThresholdsOf(profile: SessionProfile): SessionThresholds {
  return {
    minTurnsBeforeClose: profile.minTurnsBeforeClose,
    stagnantLiteralStreakLimit: profile.stagnantLiteralStreakLimit,
    stagnantNoProgressLimit: profile.stagnantNoProgressLimit,
    crisisPracticeTurns: profile.crisisPracticeTurns,
  };
}

/**
 * 档案的目标轮次区间文案 (写进 prompt); 本档不设目标时返回 null.
 *
 * @param profile 会话档案
 * @returns 形如 "40-50" 的文案, 或 null
 */
export function targetTurnsBandText(profile: SessionProfile): string | null {
  if (!profile.targetTurnsBand) return null;
  const [low, high] = profile.targetTurnsBand;
  return `${low}-${high}`;
}

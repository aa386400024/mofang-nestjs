// V2026-11-11 治本 (WP-N · 标注台批次化 — 批次口径纯函数):
//   职责: 可标注判定 / 批内确定性排序 / 一致性可比性守卫 / 轮级轮次解析.
//   边界: **纯函数** —— 零 DB / 零文件 / 零 Nest; 单测直接调, 不连库.
//
//   为什么单独成文件 (不塞进 service): 这四段是标注台**口径**的所在, 必须能被
//   单测钉死 —— 一旦漂移, "哪些场次能标" / "顺序稳不稳" / "能不能比" 全部说不清.

import {
  COMPARABILITY_REASON,
  COMPARABILITY_WARNING,
  CONSISTENCY_MIN_SAMPLE,
  VERSION_UNKNOWN,
  type ComparabilityReason,
  type ComparabilityWarning,
} from './quality-annotation.constants.js';

/**
 * 一场对练场次的**批次事实** (来自 ap_practice_sessions).
 *
 * ⚠️ 这是**派生视图**要用的最小字段集 —— 不含逐字稿, 不含任何台词.
 */
export interface BatchSessionFact {
  /** 场次 id (排序兜底键). */
  readonly practiceSessionId: string;
  /** 逐字稿会话 id. */
  readonly debugSessionId: string;
  /** 角色代号 (= character_profiles.template_id). */
  readonly characterSlug: string;
  /** 咨询师模式 id. */
  readonly counselorModeId: string | null;
  /** 实际轮数. */
  readonly turnCount: number;
  /** 场次状态 (completed / failed / ...). */
  readonly status: string;
  /** 引擎版本 (git describe --dirty). */
  readonly engineVersion: string | null;
  /** prompt 模板指纹. */
  readonly promptVersion: string | null;
  /** 角色版本. */
  readonly characterVersion: string | null;
  /** 开始时刻 (ISO). */
  readonly startedAt: string | null;
  /** 归属批次 id (NULL = 单场实时跑, 无法归属). */
  readonly batchId: string | null;
}

/**
 * 批次 id 的合法形状 (nanoid / 人工命名批次).
 *
 * ⚠️ 批次 id 会被拼进文件路径 (冻结副本目录) 与 SQL 条件, 不校验就能写到目录外面去.
 *
 * @param value 批次 id
 * @returns 合法 → true
 */
export function isValidBatchId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

/**
 * 判定一场是否**可进标注队列**.
 *
 * ⚠️ 四个条件缺一不可, 且**逐字稿可获取是硬条件**:
 *   标不了台词的场次进了队列, 标注员点开是空白 —— 那不是标注, 是制造垃圾数据.
 *
 * @param fact 场次事实
 * @param transcriptAvailable 逐字稿是否可取 (冻结副本或活文件任一)
 * @returns 可标注 → true
 */
export function isAnnotatableSession(fact: BatchSessionFact, transcriptAvailable: boolean): boolean {
  if (fact.status !== 'completed') return false;
  if (fact.turnCount <= 0) return false;
  if (fact.debugSessionId.length === 0) return false;
  return transcriptAvailable;
}

/**
 * 批内确定性排序比较器.
 *
 * ⚠️ **为什么在代码里排, 不靠 SQL 的 ORDER BY**: 标注台是**队列** ——
 *   "第 12 场"必须永远是同一场, 否则标到一半刷新页面, 顺序就乱了.
 *   口径写在代码里, 不依赖任何一处实现 (驱动 / ORM / 仓储替身) 的排序行为.
 *
 * 排序键: character_slug → counselor_mode_id → started_at → practice_session_id.
 *   最后一级用**场次 id**兜底 (不是行 id): 派生行还没落库, 没有行 id 可用.
 *
 * @param left 左侧
 * @param right 右侧
 * @returns 负数 / 0 / 正数
 */
export function compareBatchSessions(left: BatchSessionFact, right: BatchSessionFact): number {
  const slug = left.characterSlug.localeCompare(right.characterSlug);
  if (slug !== 0) return slug;
  const mode = (left.counselorModeId ?? '').localeCompare(right.counselorModeId ?? '');
  if (mode !== 0) return mode;
  const started = (left.startedAt ?? '').localeCompare(right.startedAt ?? '');
  if (started !== 0) return started;
  return left.practiceSessionId.localeCompare(right.practiceSessionId);
}

/**
 * 批内确定性排序 (返回新数组, 不改入参).
 *
 * @param facts 场次事实
 * @returns 排好序的副本
 */
export function sortBatchSessions(facts: readonly BatchSessionFact[]): BatchSessionFact[] {
  return [...facts].toSorted(compareBatchSessions);
}

/**
 * 版本集合去重 (NULL → '<unknown>').
 *
 * @param values 版本列表
 * @returns 去重后的版本集合 (保持首次出现顺序)
 */
export function distinctVersions(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = value === null || value.length === 0 ? VERSION_UNKNOWN : value;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

/**
 * 可比性判定的输入.
 */
export interface ComparabilityInput {
  /** 该范围内已标注场次. */
  readonly labeled: number;
  /** 该范围内各场次的引擎版本 (含 null). */
  readonly engineVersions: readonly (string | null)[];
  /** 该范围内各场次的 prompt 版本 (含 null). */
  readonly promptVersions: readonly (string | null)[];
  /** 已标注但逐字稿缺失的场次数. */
  readonly missingTranscriptLabeled: number;
}

/**
 * 可比性判定结果.
 */
export interface ComparabilityVerdict {
  /** 是否可比 (false → 前端必须挂横幅遮住数字). */
  readonly comparable: boolean;
  /** 不可比原因码 (空 = 可比). */
  readonly incomparableReasons: readonly ComparabilityReason[];
  /** 只告警的码 (不影响 comparable). */
  readonly warnings: readonly ComparabilityWarning[];
}

/**
 * 判一致性报告**能不能比**.
 *
 * ⚠️ **判定只看 4 个 reason**, warnings 一律不影响 comparable:
 *   SMALL_SAMPLE (样本少) 与 ENGINE_VERSION_DIRTY (基线脏) 只是"解释力有限",
 *   不是"不可比" —— 把这两件事混在一起, 会让工具在还能给数的时候拒绝给数.
 *
 * @param input 输入
 * @returns 判定结果
 */
export function evaluateComparability(input: ComparabilityInput): ComparabilityVerdict {
  const reasons: ComparabilityReason[] = [];
  const warnings: ComparabilityWarning[] = [];

  const engines = distinctVersions(input.engineVersions);
  const prompts = distinctVersions(input.promptVersions);

  if (engines.length > 1) reasons.push(COMPARABILITY_REASON.MixedEngineVersion);
  if (prompts.length > 1) reasons.push(COMPARABILITY_REASON.MixedPromptVersion);
  if (input.labeled === 0) reasons.push(COMPARABILITY_REASON.NoLabeledSession);
  if (input.missingTranscriptLabeled > 0) reasons.push(COMPARABILITY_REASON.TranscriptMissingPartial);

  if (input.labeled < CONSISTENCY_MIN_SAMPLE) warnings.push(COMPARABILITY_WARNING.SmallSample);
  if (engines.some((version) => version.includes('-dirty'))) warnings.push(COMPARABILITY_WARNING.EngineVersionDirty);

  return { comparable: reasons.length === 0, incomparableReasons: reasons, warnings };
}

/**
 * 轮次清单解析结果.
 */
export interface BadTurnsParseResult {
  /** 是否合法. */
  readonly ok: boolean;
  /** 解析出的轮次 (去重升序). */
  readonly turns: readonly number[];
  /** 非法原因 (ok=true 时为 null). */
  readonly reason: string | null;
}

/**
 * 解析轮级"有问题轮次"清单.
 *
 * ⚠️ **非法不静默丢弃**: 丢掉一个轮次 = 丢掉一条标注事实, 而标注员以为自己标了.
 *   所以这里返回 ok=false + 原因, 由 service 转成 400.
 *
 * @param raw 原始字符串 (逗号分隔)
 * @param turnCount 该场轮数 (NULL = 未知, 不做上界校验)
 * @returns 解析结果
 */
export function parseBadTurns(raw: string, turnCount: number | null): BadTurnsParseResult {
  const text = raw.trim();
  if (text.length === 0) return { ok: true, turns: [], reason: null };

  const parts = text.split(',').map((part) => part.trim());
  const turns: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return { ok: false, turns: [], reason: `轮次不是正整数: "${part}"` };
    const value = Number(part);
    if (value < 1) return { ok: false, turns: [], reason: `轮次从 1 起: "${part}"` };
    if (turnCount !== null && value > turnCount) {
      return { ok: false, turns: [], reason: `轮次 ${value} 超出本场轮数 ${turnCount}` };
    }
    if (!turns.includes(value)) turns.push(value);
  }

  turns.sort((left, right) => left - right);
  if (turns.length > 10) {
    return { ok: false, turns: [], reason: `轮次清单最多 10 个 (收到 ${turns.length} 个)` };
  }
  return { ok: true, turns, reason: null };
}

/**
 * 轮次清单序列化成落库字符串 (空 → null).
 *
 * @param turns 轮次
 * @returns 逗号分隔字符串; 空 → null
 */
export function formatBadTurns(turns: readonly number[]): string | null {
  if (turns.length === 0) return null;
  return [...turns].toSorted((left, right) => left - right).join(',');
}

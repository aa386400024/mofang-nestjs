// V2026-11-22 (AF-313 · 调试会话远端持久化):
//   调试会话记录的形状与解析从 `debug-session-store.ts` 抽到独立模块 ——
//   文件存储与 MySQL 存储共用同一份解析口径，避免两份 parser 漂移。
//
//   边界: 纯类型 + 纯解析；不做 IO、不含 NestJS、不读 env。
//   隐私: 解析失败只返回 null，不输出任何正文片段。

import { parseDebugKernelState, type DebugKernelState } from './debug-kernel-state.js';
import type { DeliberationScenarioType } from '../engine-adapters/deliberation/deliberation-mode.config.js';
import type { EncounterInput } from '../shared/encounter/encounter-scene.js';

/**
 * 调试会话的标题来源.
 *
 * 为什么**要记来源**:
 *   自动命名 (LLM) 与人工改名会**互相覆盖** —— 用户手动改过的标题不该被后到的
 *   LLM 结果冲掉. 记下来源, 覆盖规则就有一条明确的口径:
 *   `llm` 只能覆盖 `fallback`, 永远盖不掉 `manual`.
 */
export type DebugSessionTitleSource = 'fallback' | 'llm' | 'manual';

/** 调试会话的生命周期状态. */
export type DebugSessionStatus = 'active' | 'completed';

/** 一条调试消息 (一轮里的咨询师发言 / 来访者回应). */
export interface DebugSessionMessage {
  /** 谁说的: `counselor` = 学员 (咨询师), `visitor` = AI 扮演的来访者. */
  readonly role: 'counselor' | 'visitor';
  /** 原文. */
  readonly text: string;
  /** 属于第几轮 (从 1 开始). */
  readonly turnIndex: number;
  /** 时刻 (ISO). */
  readonly ts: string;
}

/** 调试会话的落盘/落库记录 (一个 JSON 的形状). */
export interface DebugSessionRecord {
  /** 会话 id (= 内核 sessionId; 也是文件名). */
  readonly id: string;
  /** 会话标题. */
  readonly title: string;
  /** 标题来源 (决定谁能覆盖谁). */
  readonly titleSource: DebugSessionTitleSource;
  /** 角色代号. */
  readonly characterSlug: string;
  /** 角色展示名. */
  readonly characterLabel: string;
  /** 创建时刻 (ISO). */
  readonly createdAt: string;
  /** 最后更新时刻 (ISO). */
  readonly updatedAt: string;
  /** 状态: `active` = 还在跑, `completed` = 已关闭. */
  readonly status: DebugSessionStatus;
  /** 已跑轮数. */
  readonly turnCount: number;
  /** 逐轮消息 (咨询师 + 来访者, 一轮两条). */
  readonly messages: readonly DebugSessionMessage[];
  /** 逐轮调试 trace (完整内部状态, 含 prompt 全文). */
  readonly traces: readonly unknown[];
  /** 内核状态快照 (恢复用; 每轮覆盖一次). */
  readonly kernelState: DebugKernelState | null;
  /** 场景类型 (老记录没有 → undefined). */
  readonly scenarioType?: DeliberationScenarioType;
  /** 本场接触方式 (老记录没有 → undefined). */
  readonly encounter?: EncounterInput;
}

/** 会话列表的一行 (列表不返 messages/traces). */
export interface DebugSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly characterSlug: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turnCount: number;
  readonly status: DebugSessionStatus;
  /** 能不能恢复 = 有没有内核状态快照. */
  readonly resumable: boolean;
}

/**
 * 解析 JSON 文本 → 会话记录 (形状不对 → null).
 *
 * 逐字段兜底: 文件/库可能被手工改过 / 被别的版本写过. 缺字段当缺省, 整条不丢弃.
 *
 * @param raw JSON 文本
 * @returns 记录; 不可解析 → null
 */
export function parseDebugSessionRecord(raw: string): DebugSessionRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const id = readString(record['id']);
  if (id === null) return null;
  const createdAt = readString(record['createdAt']) ?? new Date().toISOString();
  const encounter = readEncounter(record['encounter']);
  return {
    id,
    title: readString(record['title']) ?? '',
    titleSource: readTitleSource(record['titleSource']),
    characterSlug: readString(record['characterSlug']) ?? '',
    characterLabel: readString(record['characterLabel']) ?? '',
    createdAt,
    updatedAt: readString(record['updatedAt']) ?? createdAt,
    status: record['status'] === 'completed' ? 'completed' : 'active',
    turnCount: readNumber(record['turnCount']) ?? 0,
    messages: Array.isArray(record['messages']) ? (record['messages'] as DebugSessionMessage[]) : [],
    traces: Array.isArray(record['traces']) ? (record['traces'] as unknown[]) : [],
    kernelState: parseDebugKernelState(record['kernelState']),
    scenarioType: readScenarioType(record['scenarioType']),
    ...(encounter === undefined ? {} : { encounter }),
  };
}

/**
 * 读场景类型 (非法值 → undefined).
 *
 * @param value 原始值
 * @returns 合法场景 / undefined
 */
function readScenarioType(value: unknown): DeliberationScenarioType | undefined {
  if (value === 'freeform' || value === 'full_simulation' || value === 'exam') return value;
  return undefined;
}

/**
 * 读接触方式 (缺失/非法 → undefined).
 *
 * @param value 原始值
 * @returns 接触方式 / undefined
 */
function readEncounter(value: unknown): EncounterInput | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const mode = (value as { mode?: unknown }).mode;
  const channel = (value as { channel?: unknown }).channel;
  if (typeof mode !== 'string' || mode.length === 0) return undefined;
  return {
    mode,
    ...(typeof channel === 'string' && channel.length > 0 ? { channel } : {}),
  };
}

/**
 * 读非空字符串.
 *
 * @param value 原始值
 * @returns 字符串 / null
 */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 读有限数字.
 *
 * @param value 原始值
 * @returns 数字 / null
 */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 读标题来源 (非法值 → `fallback`).
 *
 * @param value 原始值
 * @returns 标题来源
 */
function readTitleSource(value: unknown): DebugSessionTitleSource {
  if (value === 'llm' || value === 'manual') return value;
  return 'fallback';
}

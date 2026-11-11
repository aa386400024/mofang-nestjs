// V2026-11-09 治本 (Phase2.5 闸门 trace 查询接口 · 查询口径与视图):
//   职责: 闸门决策查询的**纯逻辑** —— query 参数解析 / 校验, 以及行 → 接口视图的映射.
//   边界: 纯函数; 零 @nestjs/* / 零 typeorm / 零 IO.
//
//   为什么把口径抽到这一层 (而不是写在 controller 里):
//     口径散在 controller = 没法单测, 也没法复用. 仓库既有同款纪律:
//     `deliberation-stats.ts` (统计口径) / `cost-view.ts` (成本口径) / `trajectory-view.ts`.
//     controller 只做编排: 取参数 → 调纯函数 → 查库 → 映射 → 返回.
//
//   ⚠️ **非法参数一律抛错, 不静默兜底**:
//     `mode=xxx` 静默忽略的话, 看板显示的是"全部模式", 而运营以为在看"只看 effect" ——
//     那比报错危险得多 (仓库纪律: "看板宁可报错, 也不能装作一切正常").
//
//   ⚠️ **时区**: 按天口径一律 Asia/Shanghai (复用 shared/time/shanghai-date.ts);
//     输出的时间戳是**带 +08:00 偏移**的 ISO 字符串 (不是 UTC 的 Z 形式) ——
//     看板与 MySQL 里存的值对得上, 人眼也能直接读出"这是北京时间".
//
//   验证: test/admin-debug/gate-decisions.spec.ts
//   时间戳: 2026-11-09

import { isShanghaiDateKey } from '../../../shared/time/shanghai-date.js';
import {
  GATE_DECISION_VALUES,
  GATE_MODE_VALUES,
  GATE_REASON_VALUES,
  type GateDecision,
  type GateMode,
  type GateReason,
  type GateThresholds,
} from '../deliberation-gate.types.js';

/**
 * query 参数的原始形态.
 *
 * ⚠️ **可能是数组**: `?mode=shadow&mode=effect` 这种重复参数, Express 解析出来是数组
 *   (不是逗号分隔的字符串) —— 取值函数要能接住, 否则会炸 500 而不是 400.
 */
export type GateTraceQueryValue = string | string[] | undefined;

/**
 * 列表端点的 query 参数 (原始字符串形态).
 */
export interface GateTraceQueryParams {
  /** 页码 (从 1 起). */
  readonly page?: GateTraceQueryValue;
  /** 每页条数. */
  readonly pageSize?: GateTraceQueryValue;
  /** 会话 id (**双口径**: 引擎侧 session id 或落库 dbSessionId 都认). */
  readonly sessionId?: GateTraceQueryValue;
  /** 落库会话 id (只认 training_sessions.id). */
  readonly dbSessionId?: GateTraceQueryValue;
  /** 模式多选 (逗号分隔). */
  readonly mode?: GateTraceQueryValue;
  /** 理由多选 (逗号分隔). */
  readonly reason?: GateTraceQueryValue;
  /** 决策 (run | skip). */
  readonly decision?: GateTraceQueryValue;
  /** 起始日 (含, `YYYY-MM-DD`, Asia/Shanghai). */
  readonly startDate?: GateTraceQueryValue;
  /** 结束日 (含, `YYYY-MM-DD`, Asia/Shanghai). */
  readonly endDate?: GateTraceQueryValue;
}

/**
 * 解析后的查询条件 (controller 直接拿去拼 where).
 */
export interface GateTraceFilters {
  /** 页码 (从 1 起). */
  readonly page: number;
  /** 每页条数. */
  readonly pageSize: number;
  /** 会话 id (双口径). */
  readonly sessionId?: string;
  /** 落库会话 id. */
  readonly dbSessionId?: string;
  /** 模式过滤 (空 = 不过滤). */
  readonly modes?: readonly GateMode[];
  /** 理由过滤 (空 = 不过滤). */
  readonly reasons?: readonly GateReason[];
  /** 决策过滤 (缺省 = 不过滤). */
  readonly decision?: GateDecision;
  /** 起始日 (上海日键). */
  readonly startDay?: string;
  /** 结束日 (上海日键). */
  readonly endDay?: string;
}

/** 列表默认页码. */
export const GATE_TRACE_DEFAULT_PAGE = 1;
/** 列表默认每页条数. */
export const GATE_TRACE_DEFAULT_PAGE_SIZE = 20;
/** 列表每页条数上限 (看板一次翻太多页没意义, 也不现实). */
export const GATE_TRACE_MAX_PAGE_SIZE = 100;
/** 页码上限 (防"page=999999999"把数据库拖进深分页). */
const GATE_TRACE_MAX_PAGE = 10_000;

/**
 * 解析列表 query 参数 (**纯函数**; 非法参数抛 `Error`, 由 controller 转成 400).
 *
 * @param query 原始 query
 * @returns 解析后的过滤条件
 * @throws Error 参数非法 (message 是可直接展示给运营的中文)
 */
export function parseGateTraceQuery(query: GateTraceQueryParams): GateTraceFilters {
  const page = parsePositiveInt(query.page, GATE_TRACE_DEFAULT_PAGE, 'page', GATE_TRACE_MAX_PAGE);
  const pageSize = parsePositiveInt(query.pageSize, GATE_TRACE_DEFAULT_PAGE_SIZE, 'pageSize', GATE_TRACE_MAX_PAGE_SIZE);
  const sessionId = readText(query.sessionId);
  const dbSessionId = readText(query.dbSessionId);
  const modes = parseEnumList(query.mode, GATE_MODE_VALUES, 'mode');
  const reasons = parseEnumList(query.reason, GATE_REASON_VALUES, 'reason');
  const decision = parseSingleEnum(query.decision, GATE_DECISION_VALUES, 'decision');
  const startDay = parseDateKey(query.startDate, 'startDate');
  const endDay = parseDateKey(query.endDate, 'endDate');

  if (startDay !== undefined && endDay !== undefined && startDay > endDay) {
    throw new Error('startDate 不能晚于 endDate');
  }

  return {
    page,
    pageSize,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(dbSessionId === undefined ? {} : { dbSessionId }),
    ...(modes === undefined ? {} : { modes }),
    ...(reasons === undefined ? {} : { reasons }),
    ...(decision === undefined ? {} : { decision }),
    ...(startDay === undefined ? {} : { startDay }),
    ...(endDay === undefined ? {} : { endDay }),
  };
}

/**
 * 闸门决策的接口视图 (任务单 §3.2.1 的 `GateTraceRecord`).
 */
export interface GateTraceRecordView {
  /** MySQL 自增 id (number). */
  readonly id: number;
  /** 引擎侧会话 id. */
  readonly sessionId: string;
  /** 落库会话 id (没有则 null). */
  readonly dbSessionId: string | null;
  /** 轮次. */
  readonly turnIndex: number;
  /** 模式. */
  readonly mode: GateMode;
  /** 跑 / 不跑. */
  readonly decision: GateDecision;
  /** 决策理由. */
  readonly reason: GateReason;
  /** 当时用的阈值 (对象, 不是 number —— 前端 mock 曾把它写成 number). */
  readonly thresholdUsed: {
    readonly alliance: number;
    readonly resistance: number;
    readonly calm: number;
  };
  /** 逐维 delta 摘要. */
  readonly deltaSummary: Readonly<Record<string, number>>;
  /** 判定耗时 (毫秒). */
  readonly elapsedMs: number;
  /** 发生时刻 (ISO 字符串, +08:00). */
  readonly recordedAt: string;
}

/**
 * 查询结果的一行 (结构化形状 —— **不 import 实体**, 保持这一层零 ORM 依赖).
 */
export interface GateTraceRow {
  /** 主键 (驱动可能给字符串或数字). */
  readonly id: string | number;
  /** 引擎侧会话 id. */
  readonly sessionId: string;
  /** 落库会话 id. */
  readonly dbSessionId: string | null;
  /** 学员账号 id. */
  readonly userId: string | null;
  /** 轮次. */
  readonly turnIndex: number;
  /** 模式. */
  readonly mode: string;
  /** 决策. */
  readonly decision: string;
  /** 决策理由. */
  readonly reason: string;
  /** 阈值. */
  readonly thresholdUsed: GateThresholds | Record<string, never> | null;
  /** delta 摘要. */
  readonly deltaSummary: Record<string, number> | null;
  /** 耗时. */
  readonly elapsedMs: number;
  /** 发生时刻. */
  readonly recordedAt: Date;
}

/**
 * 行 → 接口视图 (**纯函数**).
 *
 * ⚠️ **id 强制转 number**: 契约要求 id 是 number, 而 mysql2 对 BIGINT 默认返回字符串.
 * ⚠️ **阈值/delta 里的数值统一转 number**: JSON 列里存的是 JSON 数字, 但驱动可能给字符串.
 *
 * @param row 查询行
 * @returns 接口视图
 */
export function toGateTraceRecordView(row: GateTraceRow): GateTraceRecordView {
  return {
    id: toFiniteNumber(row.id),
    sessionId: row.sessionId,
    dbSessionId: row.dbSessionId ?? null,
    turnIndex: row.turnIndex,
    mode: row.mode as GateMode,
    decision: row.decision as GateDecision,
    reason: row.reason as GateReason,
    thresholdUsed: normalizeThresholds(row.thresholdUsed),
    deltaSummary: normalizeDeltaSummary(row.deltaSummary),
    elapsedMs: row.elapsedMs,
    recordedAt: toShanghaiIsoString(row.recordedAt),
  };
}

/**
 * 阈值归一化 (缺字段补 0, 值转 number).
 *
 * ⚠️ **空对象 (结构性跳过) → 三个 0** (V2026-11-11 G-3):
 *   结构性跳过压根没做判定, 没有阈值 —— 空对象回落零值, 展示层与统计口径不受影响.
 *
 * @param raw 原始阈值
 * @returns 三个阈值 (数字)
 */
function normalizeThresholds(raw: GateThresholds | Record<string, never> | null): { alliance: number; resistance: number; calm: number } {
  return {
    alliance: toFiniteNumber(raw?.alliance),
    resistance: toFiniteNumber(raw?.resistance),
    calm: toFiniteNumber(raw?.calm),
  };
}

/**
 * delta 摘要归一化 (值转 number; 非对象 → 空对象).
 *
 * @param raw 原始摘要
 * @returns 逐维数值
 */
function normalizeDeltaSummary(raw: Record<string, number> | null): Record<string, number> {
  if (raw === null || typeof raw !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = toFiniteNumber(value);
  }
  return result;
}

/**
 * 取有限数字 (非法 → 0).
 *
 * @param value 原始值
 * @returns 数字
 */
function toFiniteNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 上海时区格式化器 (取到"墙上时间"的各个字段). */
const SHANGHAI_ISO_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * 把时刻格式化成**带 +08:00 偏移**的 ISO 字符串.
 *
 * ⚠️ 为什么不用 `toISOString()`: 那给的是 UTC (Z), 与"上海日界"的口径对不上 ——
 *   看板按天分组时, UTC 与上海差 8 小时, "今天"会整体错位半天.
 *
 * @param date 时刻
 * @returns ISO 字符串 (形如 `2026-11-09T15:04:05.123+08:00`); 非法时刻 → 空串
 */
export function toShanghaiIsoString(date: Date): string {
  if (!Number.isFinite(date.getTime())) return '';
  const parts = SHANGHAI_ISO_FORMATTER.formatToParts(date);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}:${pick('second')}.${milliseconds}+08:00`;
}

/**
 * 读一个文本参数 (空串 / 缺省 → undefined).
 *
 * ⚠️ **重复参数取第一个**: `?mode=a&mode=b` 解析出来是数组 —— 取第一个值,
 *   剩下的忽略 (而不是炸 500). 多选请用逗号分隔 (`?mode=a,b`).
 *
 * @param value 原始值
 * @returns 去掉首尾空白的文本
 */
function readText(value: GateTraceQueryValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = (raw ?? '').trim();
  return text.length > 0 ? text : undefined;
}

/**
 * 解析正整数参数.
 *
 * @param raw 原始值
 * @param fallback 缺省值
 * @param name 参数名 (报错用)
 * @param max 上界
 * @returns 正整数
 * @throws Error 参数非法
 */
function parsePositiveInt(raw: GateTraceQueryValue, fallback: number, name: string, max: number): number {
  const text = readText(raw) ?? '';
  if (text.length === 0) return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} 参数不合法: "${text}" (要正整数)`);
  }
  if (parsed > max) {
    throw new Error(`${name} 参数超出上限: "${text}" (最大 ${max})`);
  }
  return parsed;
}

/**
 * 解析多选枚举参数 (逗号分隔).
 *
 * @param raw 原始值
 * @param allowed 允许的取值
 * @param name 参数名 (报错用)
 * @returns 取值列表 (缺省 → undefined)
 * @throws Error 取值不合法
 */
function parseEnumList<T extends string>(raw: GateTraceQueryValue, allowed: readonly T[], name: string): T[] | undefined {
  const text = readText(raw) ?? '';
  if (text.length === 0) return undefined;
  const items = text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) return undefined;
  for (const item of items) {
    if (!allowed.includes(item as T)) {
      throw new Error(`${name} 取值不合法: "${item}" (可选: ${allowed.join(' | ')})`);
    }
  }
  return [...new Set(items)] as T[];
}

/**
 * 解析单选枚举参数.
 *
 * @param raw 原始值
 * @param allowed 允许的取值
 * @param name 参数名 (报错用)
 * @returns 取值 (缺省 → undefined)
 * @throws Error 取值不合法
 */
function parseSingleEnum<T extends string>(raw: GateTraceQueryValue, allowed: readonly T[], name: string): T | undefined {
  const text = readText(raw) ?? '';
  if (text.length === 0) return undefined;
  if (!allowed.includes(text as T)) {
    throw new Error(`${name} 取值不合法: "${text}" (可选: ${allowed.join(' | ')})`);
  }
  return text as T;
}

/**
 * 解析日期参数 (必须是合法的上海日键).
 *
 * @param raw 原始值
 * @param name 参数名 (报错用)
 * @returns 日期键
 * @throws Error 日期不合法
 */
function parseDateKey(raw: GateTraceQueryValue, name: string): string | undefined {
  const text = readText(raw) ?? '';
  if (text.length === 0) return undefined;
  if (!isShanghaiDateKey(text)) {
    throw new Error(`${name} 格式不合法: "${text}" (要 YYYY-MM-DD)`);
  }
  return text;
}

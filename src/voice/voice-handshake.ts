// V2026-10-23 治本 (WS 握手解析 — 纯函数, spec §2.1/§2.2):
//   原因: 握手 query 承载了"这场会谈怎么演"的全部临场设定 (人物 / 模式 / 难度 /
//     风格 / 情绪基线 / 防御水平). 这些值**全部来自客户端**, 必须在入口做一次
//     归一 (裁剪 / 兜底 / 白名单), 否则任何一路"忘了兜底"都会让 prompt 里出现
//     NaN / 越界值 / 未知档位 —— 而 prompt 是给大模型看的, 脏值会直接污染扮演效果.
//   设计: 解析与归一是**纯函数**, 不碰 IO, 不依赖 DI —— 于是可单测, 也便于
//     gateway / service 两处复用同一份口径.
//   反双胞胎:
//     - 不用 class-validator DTO: 这是 query string (不是 JSON body), 且校验规则是
//       "越界裁剪 + 非法回退" 而不是 "非法即 400" —— 训练场景下宁可回退也不能断连
//     - 不在 gateway 里内联解析: 解析口径要能被单测覆盖, 内联就没法测
//   验证:
//     1. tsc 0 错
//     2. `?emotionBaseline=5` → 裁剪到 1; `?emotionBaseline=abc` → 忽略 (用缺省)
//     3. `?difficulty=L9` → 忽略 (用模板缺省)
//   时间戳: 2026-10-23

import type {
  VoiceDifficulty,
  VoiceSessionMode,
  VoiceSessionPreset,
  VoiceTemplateSummary,
  VoiceVisitorMode,
  VoiceVisitorStyle,
} from './voice-session.types';

/** 难度白名单. */
const DIFFICULTIES: readonly VoiceDifficulty[] = ['L1', 'L2', 'L3'];

/** 配合风格白名单 (值同 counselor `VisitorStyle`). */
const STYLES: readonly VoiceVisitorStyle[] = ['defensive', 'cooperative', 'resistant', 'avoidant', 'mixed'];

/** 扮演模式白名单. */
const VISITOR_MODES: readonly VoiceVisitorMode[] = ['useMySettings', 'fullyReal'];

/** 无模板时的兜底临场参数 (与内置 persona 缺省一致). */
const FALLBACK_PRESET: VoiceSessionPreset = {
  difficulty: 'L1',
  style: 'mixed',
  emotionBaseline: 0.35,
  defenseLevel: 0.2,
  visitorMode: 'useMySettings',
};

/**
 * 握手 query 的解析结果 (原始值, 尚未与模板缺省合并).
 */
export interface VoiceHandshakeQuery {
  /** 会话 id (path 里的 sid). */
  readonly sessionId: string;
  /** 内置 persona id (老参数, 保留兼容). */
  readonly personaId?: string;
  /** 公共人物模板 id. */
  readonly templateId?: string;
  /** 会话模式 (缺省 voice). */
  readonly mode: VoiceSessionMode;
  /** 难度覆盖 (非法值已丢弃). */
  readonly difficulty?: VoiceDifficulty;
  /** 风格覆盖 (非法值已丢弃). */
  readonly style?: VoiceVisitorStyle;
  /** 情绪基线覆盖 (非法值已丢弃). */
  readonly emotionBaseline?: number;
  /** 防御水平覆盖 (非法值已丢弃). */
  readonly defenseLevel?: number;
  /** 扮演模式 (本期只记录). */
  readonly visitorMode: VoiceVisitorMode;
}

/**
 * 解析 WS 握手 URL.
 *
 * 约定 (spec §2.1): `/voice/training/<sid>?token=***&templateId=<vpt slug>&mode=voice&...`
 * 全部 query 值走 ASCII (人物代号 / 年龄 / 主诉 / 剧本一律由服务端从模板读, 客户端不传).
 *
 * @param url 原始 URL (含 path + query)
 * @returns 解析结果
 */
export function parseVoiceHandshake(url: string): VoiceHandshakeQuery {
  const parsed = new URL(url, 'http://localhost');
  const params = parsed.searchParams;

  return {
    sessionId: extractSessionId(parsed.pathname),
    personaId: readOptional(params.get('personaId')),
    templateId: readOptional(params.get('templateId')),
    mode: readMode(params.get('mode')),
    difficulty: readDifficulty(params.get('difficulty')),
    style: readStyle(params.get('style')),
    emotionBaseline: readRatio(params.get('emotionBaseline')),
    defenseLevel: readRatio(params.get('defenseLevel')),
    visitorMode: readVisitorMode(params.get('visitorMode')),
  };
}

/**
 * 把握手参数与模板缺省合并成本场生效的临场参数.
 *
 * 优先级: 握手覆盖 > 模板缺省 > 内置兜底.
 * 越界数值在合并时统一裁剪到 [0, 1].
 *
 * @param query 握手解析结果
 * @param summary 模板表层摘要 (无模板时传 null)
 * @returns 本场生效的临场参数
 */
export function resolveVoicePreset(query: VoiceHandshakeQuery, summary: VoiceTemplateSummary | null): VoiceSessionPreset {
  return {
    difficulty: query.difficulty ?? summary?.difficulty ?? FALLBACK_PRESET.difficulty,
    style: query.style ?? summary?.styleHint ?? FALLBACK_PRESET.style,
    emotionBaseline: clampRatio(query.emotionBaseline ?? summary?.emotionBaselineDefault, FALLBACK_PRESET.emotionBaseline),
    defenseLevel: clampRatio(query.defenseLevel ?? summary?.defenseLevelDefault, FALLBACK_PRESET.defenseLevel),
    visitorMode: query.visitorMode,
  };
}

// ── private ────────────────────────────────────────────────────

/**
 * 从 path 里取会话 id.
 *
 * @param pathname URL path
 * @returns 会话 id (缺省 'default', 与旧实现保持一致)
 */
function extractSessionId(pathname: string): string {
  const matched = /\/voice\/training\/([^/]+)/.exec(pathname);
  if (!matched?.[1]) return 'default';
  const decoded = decodeURIComponent(matched[1]).trim();
  return decoded.length > 0 ? decoded : 'default';
}

/**
 * 读一个非空字符串参数.
 *
 * @param raw 原始值
 * @returns 去空白后的值; 空则 undefined
 */
function readOptional(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 读会话模式.
 *
 * @param raw 原始值
 * @returns 模式 (非法值 → 'voice')
 */
function readMode(raw: string | null): VoiceSessionMode {
  const value = readOptional(raw)?.toLowerCase();
  return value === 'text' ? 'text' : 'voice';
}

/**
 * 读难度 (大小写不敏感).
 *
 * @param raw 原始值
 * @returns 难度; 非法值 → undefined (用缺省)
 */
function readDifficulty(raw: string | null): VoiceDifficulty | undefined {
  const value = readOptional(raw)?.toUpperCase();
  return DIFFICULTIES.find((item) => item === value);
}

/**
 * 读配合风格.
 *
 * @param raw 原始值
 * @returns 风格; 非法值 → undefined (用缺省)
 */
function readStyle(raw: string | null): VoiceVisitorStyle | undefined {
  const value = readOptional(raw)?.toLowerCase();
  return STYLES.find((item) => item === value);
}

/**
 * 读 0-1 的比例值.
 *
 * @param raw 原始值
 * @returns 数值; 非数字 → undefined
 */
function readRatio(raw: string | null): number | undefined {
  const value = readOptional(raw);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 读扮演模式.
 *
 * @param raw 原始值
 * @returns 模式 (非法值 → 'useMySettings')
 */
function readVisitorMode(raw: string | null): VoiceVisitorMode {
  const value = readOptional(raw);
  return VISITOR_MODES.find((item) => item === value) ?? 'useMySettings';
}

/**
 * 裁剪比例值到 [0, 1].
 *
 * @param value 原始值
 * @param fallback 缺省值 (value 为 undefined 时使用)
 * @returns 裁剪后的数值
 */
function clampRatio(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

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
  VoiceSkillCode,
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
 * 会话 id 长度上限.
 *
 * sessionId 完全由客户端提供, 且会被拼进日志 / Map key / DB 查询参数 —— 不设上限等于
 * 给了客户端一个"往日志里灌任意长字符串"的口子. 64 足够放 uuid + 少量前缀余量.
 */
const MAX_SESSION_ID_LENGTH = 64;

/**
 * 音色 voice_id 长度上限 (V2026-10-26, spec §任务 1).
 *
 * 官方对**自定义** voice_id 的上限是 256 (见《音色快速复刻》文档), 系统音色 id
 * 远短于此. 这里取同值作为本地兜底 —— 客户端传超长串只会白跑一趟上游,
 * 截断后仍会因"不在可用音色内"被回退, 不会造成错配.
 */
const MAX_VOICE_ID_LENGTH = 256;

/**
 * 专项训练技巧码白名单 (V2026-10-26, spec §任务 1).
 *
 * 与 `VoiceSkillCode` 1:1. 非法值**直接忽略** (不报错、不断连) ——
 * 训练场景下宁可少一个聚焦维度, 也不能因为前端传了乱值就把整场会谈搞挂.
 */
const SKILL_CODES: readonly VoiceSkillCode[] = ['listening', 'questioning', 'voice'];

/**
 * 握手 query 的解析结果 (原始值, 尚未与模板缺省合并).
 */
export interface VoiceHandshakeQuery {
  /**
   * 会话 id.
   *
   * 来源优先级: query `?sessionId=` (新约定) > path `/voice/training/<sid>` (旧格式兜底).
   * 两者都没有 → 'default'.
   */
  readonly sessionId: string;
  /** 内置 persona id (老参数, 保留兼容). */
  readonly personaId?: string;
  /** 公共人物模板 id. */
  readonly templateId?: string;
  /** 会话模式 (缺省 voice). */
  readonly mode: VoiceSessionMode;
  /** 难度覆盖 (非法值已丢弃). */
  readonly difficulty?: VoiceDifficulty;
  /** 风格覆盖 (合法映射结果; undefined = 未提供). */
  readonly style?: VoiceVisitorStyle;
  /**
   * 客户端提供了 style 但**映射不上** (白名单外的字符串).
   *
   * 与"未提供"必须分开: spec §2.2 / §5.2 定的是「映射不上统一回退 `mixed`, 不得报错」,
   * 而"未提供"才轮到模板缺省 (`styleHint`). 两者混为一谈会出现"用户传了个乱值,
   * 结果被静默换成模板默认人物" —— 用户以为改了风格, 实际没改.
   */
  readonly styleUnmapped: boolean;
  /** 情绪基线覆盖 (非法值已丢弃). */
  readonly emotionBaseline?: number;
  /** 防御水平覆盖 (非法值已丢弃). */
  readonly defenseLevel?: number;
  /** 扮演模式 (本期只记录). */
  readonly visitorMode: VoiceVisitorMode;
  /**
   * 业务指定的音色 (voice_id).
   *
   * **仅"自定义人设"来源传**; 官方模板与专项兜底都不传 (缺省走模板/env 默认).
   * 传了但不在账号可用系统音色内 → 由网关回退 env 默认 + warn 日志 (不致命断连).
   */
  readonly voiceId?: string;
  /**
   * 专项训练技巧码.
   *
   * 非法值已丢弃 (undefined = 不聚焦单一技巧); 全流程 / 个案不传.
   */
  readonly skillCode?: VoiceSkillCode;
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
    // V2026-10-24 治本 (WS 握手 sessionId 改从 query 读取):
    //   原因: `@nestjs/platform-ws` 把 `@WebSocketGateway({ path })` 原样传给 `ws`,
    //     而 `ws` 的 `shouldHandle` 是**精确比较** (`pathname !== this.options.path` → 直接
    //     `abortHandshake(socket, 400)`) —— 子路径 `/voice/training/<sid>` 在 **HTTP upgrade
    //     阶段**就被拒, 根本进不到 `handleConnection`.
    //     更隐蔽的后果: path 形式失效后 sid 恒为 'default', 会话 Map / 演练登记会
    //     **全部撞同一个 key** (不同用户的会谈互相串设定).
    //   修法: sessionId 改从 query 读 (`?sessionId=<uuid>`), path 正则保留作旧格式兜底.
    //   反双胞胎:
    //     - 不去做前缀通配 / 不改 gateway 的 path: 前端已按精确路径 + query 对接,
    //       网关侧再开子路径等于两套契约并存
    //     - 不删 extractSessionId: 旧 path 格式仍可能有存量客户端, 且现有单测依赖它
    sessionId: readSessionId(params.get('sessionId')) ?? extractSessionId(parsed.pathname),
    personaId: readOptional(params.get('personaId')),
    templateId: readOptional(params.get('templateId')),
    mode: readMode(params.get('mode')),
    difficulty: readDifficulty(params.get('difficulty')),
    ...readStyle(params.get('style')),
    emotionBaseline: readRatio(params.get('emotionBaseline')),
    defenseLevel: readRatio(params.get('defenseLevel')),
    visitorMode: readVisitorMode(params.get('visitorMode')),
    // V2026-10-26 治本 (spec §任务 1 — 握手增量两个可选字段):
    //   voiceId / skillCode 都是**可选增量**, 不影响任何现有字段的解析口径.
    voiceId: readVoiceId(params.get('voiceId')),
    skillCode: readSkillCode(params.get('skillCode')),
  };
}

/**
 * 把握手参数与模板缺省合并成本场生效的临场参数.
 *
 * 优先级: 握手覆盖 > 模板缺省 > 内置兜底.
 * 越界数值在合并时统一裁剪到 [0, 1].
 *
 * 风格的三态 (spec §2.2 / §5.2):
 * - 提供了合法值 → 用它
 * - 提供了但映射不上 → `mixed` (**不是**模板缺省 —— 用户传了值却被静默换成别人的设置)
 * - 未提供 → 模板缺省 → 兜底 `mixed`
 *
 * @param query 握手解析结果
 * @param summary 模板表层摘要 (无模板时传 null)
 * @returns 本场生效的临场参数
 */
export function resolveVoicePreset(query: VoiceHandshakeQuery, summary: VoiceTemplateSummary | null): VoiceSessionPreset {
  return {
    difficulty: query.difficulty ?? summary?.difficulty ?? FALLBACK_PRESET.difficulty,
    style: query.styleUnmapped ? 'mixed' : (query.style ?? summary?.styleHint ?? FALLBACK_PRESET.style),
    emotionBaseline: clampRatio(query.emotionBaseline ?? summary?.emotionBaselineDefault, FALLBACK_PRESET.emotionBaseline),
    defenseLevel: clampRatio(query.defenseLevel ?? summary?.defenseLevelDefault, FALLBACK_PRESET.defenseLevel),
    visitorMode: query.visitorMode,
  };
}

// ── private ────────────────────────────────────────────────────

/**
 * 从 path 里取会话 id (旧格式兜底).
 *
 * @param pathname URL path
 * @returns 会话 id (缺省 'default', 与旧实现保持一致)
 */
function extractSessionId(pathname: string): string {
  const matched = /\/voice\/training\/([^/]+)/.exec(pathname);
  if (!matched?.[1]) return 'default';
  return sanitizeSessionId(decodeURIComponent(matched[1])) ?? 'default';
}

/**
 * 读会话 id (query 形式, 新约定).
 *
 * @param raw 原始值
 * @returns 会话 id; 未提供 → undefined (交由 path 兜底)
 */
function readSessionId(raw: string | null): string | undefined {
  const value = readOptional(raw);
  return value === undefined ? undefined : sanitizeSessionId(value);
}

/**
 * 会话 id 清洗 —— sessionId 完全由客户端控制, 且会被直接拼进日志与 Map key.
 *
 * 治两点:
 * - 去掉控制字符 (含 \n): 否则客户端传 `a\n[onConnect] session=xxx` 就能伪造日志行
 * - 长度上限: 防止超长 id 撑爆日志 / Map key / DB 查询参数
 *
 * @param raw 原始值
 * @returns 清洗后的会话 id; 清完为空 → undefined
 */
function sanitizeSessionId(raw: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replaceAll(/[\u0000-\u001F\u007F]/g, '').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, MAX_SESSION_ID_LENGTH);
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
 * 读音色 voice_id.
 *
 * 与 sessionId 同理: 值完全由客户端提供, 且会被拼进日志与上游请求 → 必须清洗.
 * - 去控制字符: 否则客户端传 `a\n[onConnect] voice=xxx` 就能伪造日志行
 * - 长度上限: 官方自定义 voice_id 上限 256, 超过的一律截断
 *
 * 注意: 这里**不做**"是不是合法音色"的判断 —— 合法与否要看**账号**的可用音色
 * (那是上游数据, 握手期无法离线判定), 由网关查音色目录后回退 (spec §任务 1).
 *
 * @param raw 原始值
 * @returns 清洗后的 voice_id; 清完为空 → undefined
 */
function readVoiceId(raw: string | null): string | undefined {
  const value = readOptional(raw);
  if (value === undefined) return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replaceAll(/[\u0000-\u001F\u007F]/g, '').trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, MAX_VOICE_ID_LENGTH);
}

/**
 * 读专项训练技巧码 (大小写不敏感).
 *
 * 非法值**直接忽略** (undefined) —— 不报错、不断连 (spec §任务 1).
 *
 * @param raw 原始值
 * @returns 合法技巧码; 非法 / 未提供 → undefined
 */
function readSkillCode(raw: string | null): VoiceSkillCode | undefined {
  const value = readOptional(raw)?.toLowerCase();
  if (value === undefined) return undefined;
  return SKILL_CODES.find((item) => item === value);
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
 * 区分两种"没有值":
 * - 未提供 → 交给调用方回退模板缺省
 * - 提供了但白名单外 → `unmapped: true`, 由调用方回退 `mixed` (spec §2.2 / §5.2)
 *
 * @param raw 原始值
 * @returns 映射结果 + 是否映射不上
 */
function readStyle(raw: string | null): { readonly style?: VoiceVisitorStyle; readonly styleUnmapped: boolean } {
  const value = readOptional(raw)?.toLowerCase();
  if (value === undefined) {
    return { styleUnmapped: false };
  }
  const mapped = STYLES.find((item) => item === value);
  return mapped ? { style: mapped, styleUnmapped: false } : { styleUnmapped: true };
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

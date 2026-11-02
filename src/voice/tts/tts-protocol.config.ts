// V2026-10-23 治本 (MiniMax T2A V2 双向流式 — 协议常量层, spec §3.1/§3.2/§3.7):
//   原因: 官方 T2A V2 bidi 是**纯 JSON 文本帧**协议, 帧字段名 (`event` 而非 `type`)、
//     端点路径 (`/ws/v1/t2a_v2_bidi` 而非自拟 `/v1/t2a/bidi`)、模型枚举、音色字段
//     全部与旧实现不一致. 这些"上游是什么"的事实若散落在 client / service / pool 三处,
//     必然各写各的 —— 上游改了模型名要改 3 处, 漏一处就静默走错协议.
//   修法: 协议事实集中在本文件 (单一事实源), 运营可调参数 (超时 / 句长 / 采样率 / 音色)
//     走 env (src/config/envs/default.ts). 两者职责严格分离:
//     本文件 = "上游是什么", 改了等于换上游契约; env = "本地怎么跑", 改了不影响契约.
//   反双胞胎:
//     - 不把上游路径 / 模型枚举做成 env: 换上游协议应当是一次有记录的代码变更,
//       而不是运维改个环境变量就静默切到另一个协议 (帧格式会直接不兼容)
//     - 不复用 voice/asr-token 的旧常量: 那是 ASR 占位实现, 协议不同
//   验证:
//     1. grep -rn "t2a_v2_bidi" src → 只命中本文件 + client 的 URL 拼装
//     2. grep -rn "speech-2.8'" src → 0 命中 (不存在的模型不得出现, 拼写错误写成 speech-2.8-turbo)
//   时间戳: 2026-10-23

/**
 * 上游 bidi TTS 的 WS 路径 (相对全局基址).
 *
 * 基址由 env `MINIMAX_BASE_URL` 决定 (LLM / TTS / STT 共用同一个全局值):
 *   - 国内站 `https://api.minimax.cn` / 国际站 `https://api.minimax.io`
 * 本文件**不硬编码域名**: 站点是部署环境的事, 写死等于逼所有人改代码换站.
 */
export const TTS_BIDI_UPSTREAM_PATH = '/ws/v1/t2a_v2_bidi';

/**
 * 官方模型枚举 (spec §3.2).
 *
 * 旧实现里的 `speech-2.8` **不存在** (官方只有 turbo / hd 两个后缀), 用它必然 2013/1004.
 */
export const TTS_SUPPORTED_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo',
] as const;

export type TtsSupportedModel = (typeof TTS_SUPPORTED_MODELS)[number];

/** 官方模型默认值 (turbo: 延迟优先, 全真会谈要的是"边生成边出声"). */
export const TTS_DEFAULT_MODEL: TtsSupportedModel = 'speech-2.8-turbo';

/**
 * 官方 audio_setting.sample_rate 合法值.
 *
 * mp3 + 32000 + 单声道是本项目固定组合 (spec §2.5): 前端 just_audio 直接播完整句 mp3,
 * web / native 双端兼容最稳.
 */
export const TTS_SUPPORTED_SAMPLE_RATES = [8000, 16_000, 22_050, 24_000, 32_000, 44_100] as const;

/** 官方 audio_setting.format 合法值 (本项目固定用 mp3). */
export const TTS_SUPPORTED_FORMATS = ['mp3', 'pcm', 'flac', 'wav', 'pcmu_raw', 'pcmu_wav', 'opus'] as const;

export type TtsSupportedFormat = (typeof TTS_SUPPORTED_FORMATS)[number];

/**
 * 官方 audio_setting.bitrate 合法值 (仅 mp3 生效).
 */
export const TTS_SUPPORTED_BITRATES = [32_000, 64_000, 128_000, 256_000] as const;

/**
 * 官方「系统音色列表」里公开给出的**中文**音色 id (2026-10-23 官方文档 task_start 字段说明摘录).
 *
 * 这不是"推荐值", 是**官方文档里确实存在的 id** —— 用于让运维直接照着填 env,
 * 不用去官网翻. 最终选哪个由联调试听决定 (spec §3.3 / §8).
 */
export const TTS_OFFICIAL_CHINESE_VOICE_IDS = ['Chinese (Mandarin)_Lyrical_Voice', 'Chinese (Mandarin)_HK_Flight_Attendant'] as const;

/**
 * 官方 base_resp 状态码 → 业务语义 (spec §3.7).
 *
 * 只在这里维护一份: 错误归一是 TTS 层最容易写飘的地方 —— 同一个 code 在 client 里
 * 判一次、service 里又判一次, 迟早出现"client 说是可重试、service 说不可重试"的自相矛盾.
 */
export const TTS_STATUS = {
  /** 成功 */
  OK: 0,
  /** 鉴权失败 (key 无效 / 无权限) — 不可重试 */
  AUTH_FAILED: 1004,
  /** 限流 — 可重试 */
  RATE_LIMITED: 1002,
  /** 限流 (另一码) — 可重试 */
  CONCURRENT_LIMITED: 1039,
  /** 上游超时 — 可重试 */
  TIMEOUT: 1001,
  /** 未知错误 — 可重试 */
  UNKNOWN: 1000,
  /** 非法字符占比 > 10% — 不可重试 (需业务侧清洗文本) */
  ILLEGAL_CHARACTERS: 1042,
  /** 参数异常 (模型 / 音色 / 采样率非法) — 不可重试 */
  INVALID_PARAMS: 2013,
  /** 空闲断开 (上游 120s 无数据主动关闭) — 可重试 */
  IDLE_DISCONNECT: 2201,
  /** 非法事件 — 不可重试 (协议顺序错) */
  ILLEGAL_EVENT: 2202,
  /** 单条 task_continue 超过 10000 字符 — 该条跳过, 连接保留 */
  TEXT_TOO_LONG: 2204,
  /** 排队文本过多 (非配额限流) — 稍后重发该条, 不重连 */
  QUEUE_OVERFLOW: 2205,
  /** 事件顺序错误 — 不可重试 */
  EVENT_ORDER: 2206,
} as const;

/**
 * 官方单条 task_continue 的字符上限.
 *
 * 超限上游返 2204. 本地切句阈值 (env) 远小于它, 双保险.
 */
export const TTS_MAX_TASK_CONTINUE_CHARS = 10_000;

/**
 * 把 HTTP(S) 基址转成 WS(S) 基址, 拼出官方 bidi 端点.
 *
 * @param baseUrl 全局基址 (例 `https://api.minimax.cn`)
 * @returns 官方 bidi WS 完整地址
 */
export function buildTtsBidiUrl(baseUrl: string): string {
  const trimmed = stripTrailingSlashes(baseUrl.trim());
  // http→ws / https→wss (只替换开头, 避免把路径里的 "http" 也换掉)
  const wsBase = trimmed.replace(/^http/i, (scheme) => (scheme.toLowerCase() === 'https' ? 'wss' : 'ws'));
  return `${wsBase}${TTS_BIDI_UPSTREAM_PATH}`;
}

/**
 * 去掉结尾的斜杠.
 *
 * 不用 `replace(/\/+$/, '')`: 那个正则在"结尾无斜杠但前面有连续斜杠"时会回溯
 * (每个起点都试一遍 `\/+` 的所有长度) → 最坏 O(n²), 被 sonarjs/super-linear-regex 判失败.
 * 这里改成单趟线性扫描, 行为等价.
 *
 * @param value 原始值
 * @returns 去掉结尾斜杠后的值
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end -= 1;
  }
  return value.slice(0, end);
}

/**
 * 模型名是否在官方枚举内.
 *
 * @param model 模型名
 */
export function isSupportedTtsModel(model: string): model is TtsSupportedModel {
  return (TTS_SUPPORTED_MODELS as readonly string[]).includes(model);
}

// V2026-10-23 治本 (语音微训练 STT 代理 — 协议常量层, spec §2.2 / §2.3):
//   原因: STT 代理要跟上游 MiniMax HTTP STT (/v1/speech_to_text) 对齐 5 组事实:
//     上游路径 / 模型版本 / 响应格式 / 音频硬限制 (500s, 50MB) / 语言与格式白名单.
//     这些事实一旦散落在 client / service / controller 三处, 必然各写各的 ——
//     "上游换了模型名" 要改 3 处, 漏一处就静默降级 (拿旧名调, 上游 400, 用户只看到
//     "转写失败", 排查还得翻代码).
//   修法: 协议事实集中在本文件 (单一事实源), 运营可调参数 (超时 / 本地更严的体积与
//     时长上限 / 限流阈值) 走 env (src/config/envs/default.ts). 两者职责严格分离:
//     本文件 = "上游是什么", 改了等于换上游契约; env = "本地怎么跑", 改了不影响契约.
//   反双胞胎:
//     - 不把上游路径 / 模型名做成 env: 换站点是"换上游", 应当是一次有记录的代码变更,
//       而不是运维改个环境变量就静默切到另一个站 (国内站 / 国际站 API 面不同)
//     - 不复用 voice/asr-token 的 'speech-2.8': 那是 TTS 模型, 与 STT 无关 (spec §1.2)
//     - 不在 service 里重复写白名单: 白名单只有这一份, 校验点只有 service 一处
//   验证:
//     1. grep -rn "asr-1.0" src → 只命中本文件
//     2. grep -rn "speech_to_text" src → 只命中本文件
//   时间戳: 2026-10-23

/**
 * 上游 STT 路径 (相对全局基址).
 *
 * 基址由 env `MINIMAX_BASE_URL` 决定 (LLM / TTS / STT 共用同一个全局值):
 *   - 国内站 `https://api.minimax.cn` / 国际站 `https://api.minimax.io`
 *   - 本文件**不硬编码域名**: 站点是部署环境的事, 写死等于逼所有人改代码换站
 */
export const PRACTICE_ASR_UPSTREAM_PATH = '/v1/speech_to_text';

/** 上游 ASR 模型版本 (官方枚举目前只有这一个). */
export const PRACTICE_ASR_MODEL = 'asr-1.0';

/**
 * 上游响应格式.
 *
 * 只取 `text` + `duration`: 训练题是"录完一次性转写", 不需要说话人分离 / 时间戳对齐
 * (spec §4 明确不做). `verbose_json` 会额外开启说话人分离, 既慢又贵, 且会诱发
 * 上游"分段合并"行为, 徒增不确定性.
 */
export const PRACTICE_ASR_RESPONSE_FORMAT = 'json';

/**
 * 上游音频硬限制: 50 MiB.
 *
 * 官方错误示例: `request body too large: 88200078 bytes exceeds limit of 52428800 bytes`
 * → 阈值是 52_428_800 字节 (50 MiB), 超出上游返 413, **不截断**.
 *
 * 这条同时是本地 multer 的硬闸: 超过就直接中断上传, 不让超大 body 进内存.
 */
export const PRACTICE_ASR_UPSTREAM_MAX_FILE_BYTES = 52_428_800;

/** 上游音频硬限制: 500 秒. 超出上游返 400, **不截断**. */
export const PRACTICE_ASR_UPSTREAM_MAX_DURATION_SECONDS = 500;

/**
 * 上游支持的语言标签 (BCP-47 主标签).
 *
 * 不传 (或传空) = 混合语言识别. 训练题中文传 `zh`.
 */
export const PRACTICE_ASR_SUPPORTED_LANGUAGES = [
  'zh',
  'yue',
  'en',
  'ja',
  'ko',
  'th',
  'vi',
  'id',
  'ms',
  'fil',
  'ar',
  'tr',
  'fr',
  'de',
  'es',
  'it',
  'pt',
  'pl',
  'ru',
  'uk',
] as const;

export type PracticeAsrLanguage = (typeof PRACTICE_ASR_SUPPORTED_LANGUAGES)[number];

/**
 * 语言标签归一化.
 *
 * 上游只认一组**主标签** (zh / yue / en / ...), 不认完整 BCP-47 (zh-CN / en-US).
 * 客户端 (Flutter) 很可能传 `zh-CN`, 直接透传上游会 400, 所以本地先取主子标签再判白名单.
 *
 * @param raw 原始请求头
 * @returns 归一化后的主标签; 空值 (未传 / 空白) 返回 null = 混合语言识别
 * @throws 上游不支持该语言时抛错 (由业务层翻译成 400)
 */
export const normalizePracticeAsrLanguage = (raw: string | undefined | null): PracticeAsrLanguage | null => {
  if (raw === undefined || raw === null) {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  // BCP-47: 主标签 = 第一个 '-' 之前的部分.
  const primary = trimmed.split('-', 1)[0];
  const matched = PRACTICE_ASR_SUPPORTED_LANGUAGES.find((language) => language === primary);
  if (!matched) {
    throw new Error(`unsupported_asr_language:${primary}`);
  }
  return matched;
};

/**
 * 上游支持的音频容器 / 编码 (白名单).
 *
 * 官方支持: `wav` / `aiff` / `flac` / `alac`(m4a) / `mp3` / `aac` / `opus` / `ogg`.
 * **不支持无容器裸 PCM**.
 */
export const PRACTICE_ASR_SUPPORTED_FORMATS = ['wav', 'aiff', 'flac', 'm4a', 'mp3', 'aac', 'opus', 'ogg'] as const;

export type PracticeAsrAudioFormat = (typeof PRACTICE_ASR_SUPPORTED_FORMATS)[number];

/**
 * 扩展名 → 容器格式.
 *
 * 仅在**魔数探测失败**时作为兜底 (例如客户端改了扩展名). 魔数优先 —— 文件名是
 * 用户可控的, 容器签名不是.
 */
export const PRACTICE_ASR_EXTENSION_TO_FORMAT: Readonly<Record<string, PracticeAsrAudioFormat>> = {
  aac: 'aac',
  aif: 'aiff',
  aiff: 'aiff',
  flac: 'flac',
  m4a: 'm4a',
  mp3: 'mp3',
  mp4: 'm4a',
  ogg: 'ogg',
  opus: 'opus',
  wav: 'wav',
  wave: 'wav',
};

/**
 * 容器格式 → 上传给上游的 `Content-Type` (multipart part).
 *
 * 给对 content type 能让上游少做一次嗅探; 给错比不给更糟, 所以只认白名单里的格式,
 * 认不出就退到 `application/octet-stream` (上游会自己嗅探).
 */
export const PRACTICE_ASR_FORMAT_TO_CONTENT_TYPE: Readonly<Record<PracticeAsrAudioFormat, string>> = {
  aac: 'audio/aac',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

/**
 * 限流器名 (@nestjs/throttler 的命名限流器).
 *
 * 与全局 `default` 限流器**分开**: `default` 是全站 IP 级 60 次/分钟, 这里要的是
 * "按 userId 的转写次数" —— 同一个 NAT 出口下的多个用户不能互相挤占, 单个用户
 * 也不能靠换 IP 绕过配额. 详见 practice-asr.throttler.ts.
 */
export const PRACTICE_ASR_THROTTLER_NAME = 'practice-asr';

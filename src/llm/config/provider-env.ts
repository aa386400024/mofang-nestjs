// V2026-10-28 治本 (MiniMax chat provider 接入 · src/llm 增补):
//   职责: 集中存放「厂商相关的环境变量事实」—— 每个 provider 的 apiKey env 键名、
//         OpenAI 兼容基址的归一口径、默认模型名. 供启动注册 (llm.config.ts) 与
//         运行时 apiKey 解析 (llm-router.service.ts) **共用同一份**.
//   边界: 纯数据 + 纯函数, 零 IO / 零 @nestjs / 零网络; 不读 process.env.
//
//   为什么要有这个文件 (而不是把键名写在各自的调用点):
//     "某个 provider 的 key 叫什么 env 变量" 是**厂商事实**, 只有一个真相.
//     MiniMax 的 key 是历史命名 `MINIMAX_API_KEY` (被 voice TTS/ASR / 旧 agent
//     流式 / counselor 分析共用), 与其它厂商的 `LLM_<ID>_API_KEY` 命名规律不同.
//     如果启动注册写一份、运行时解析再写一份, 迟早会漏掉其中一处 —— 而漏掉
//     启动注册只是"provider 不出现", 漏掉运行时解析则是 **provider 注册成功、
//     一调用就报 "API key not found"**, 排查成本高得多.
//     所以两处都从这里取, 改一处即可.
//
//   反双胞胎:
//     - 不新增 `LLM_MINIMAX_API_KEY`: 同一把 key 两处维护 = 迟早只改一处,
//       表现为"改了 key 但不生效" (而且泄漏面变大).
//     - 不在这里读 process.env: env 的**来源**是 ConfigService, 本模块只接受
//       已读好的字符串; 这样单测能直接构造任意 env 表, 不必改进程环境.
//     - 不把厂商模型名硬编进路由表: 模型名是**部署事实** (订阅买了哪个模型就调哪个),
//       由 env 给; 路由层只负责"这个 provider 没指定时用哪个".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/llm/minimax-provider.spec.ts 覆盖键名映射与基址归一

import { AIProviderId } from '../common/enums/llm.enums';

/**
 * provider → apiKey 的 env 键名 (缺省规律: `LLM_<ID大写>_API_KEY`).
 *
 * 只有**命名不遵循规律**的厂商才需要显式登记 —— 目前只有 MiniMax.
 */
const PROVIDER_API_KEY_ENV_KEYS: Partial<Record<AIProviderId, string>> = {
  // MiniMax 订阅的 key 是历史命名 (与 voice TTS/ASR、旧 agent 流式、counselor 分析共用),
  // 刻意不改成 LLM_MINIMAX_API_KEY: 改名会让已跑通的语音链路断掉, 且同一把 key
  // 要在两处维护.
  [AIProviderId.MINIMAX]: 'MINIMAX_API_KEY',
};

/**
 * provider → 默认 chat 模型的 env 键名 (缺省 = 模型名写死在 provider 类里).
 *
 * 只有**模型名随部署变**的厂商才需要登记 —— MiniMax 的模型取决于订阅买了哪个
 * (本机是 MiniMax-M3.1-Flash), 写死在路由表里等于替用户决定了订阅内容.
 */
const PROVIDER_CHAT_MODEL_ENV_KEYS: Partial<Record<AIProviderId, string>> = {
  [AIProviderId.MINIMAX]: 'MINIMAX_LLM_MODEL',
};

/**
 * 解析某 provider 的 apiKey env 键名.
 *
 * @param providerId 厂商 id
 * @returns env 键名
 */
export function resolveProviderApiKeyEnvKey(providerId: AIProviderId): string {
  return PROVIDER_API_KEY_ENV_KEYS[providerId] ?? `LLM_${providerId.toUpperCase()}_API_KEY`;
}

/**
 * 解析某 provider 的默认 chat 模型 (env 优先).
 *
 * 为什么不直接返回"该 provider 的内置默认模型": 内置默认是**兜底**, 不是事实 ——
 * 订阅真正能用哪个模型是部署事实, 只有 env 知道. env 没配时返回 undefined,
 * 交由调用方回落到 provider 自己声明的默认模型.
 *
 * @param providerId 厂商 id
 * @param read env 读取函数 (由调用方注入, 保持本模块零 IO)
 * @returns 模型名; 该 provider 不走 env 时返回 undefined
 */
export function resolveProviderChatModelFromEnv(
  providerId: AIProviderId,
  read: (envKey: string) => string | undefined,
): string | undefined {
  const envKey = PROVIDER_CHAT_MODEL_ENV_KEYS[providerId];
  if (!envKey) return undefined;
  const value = read(envKey);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** MiniMax 缺省基址 (国内站; 国际站是部署环境的事, 由 env 覆盖). */
export const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.cn';

/** MiniMax 缺省 chat 模型 (订阅可用的模型由 env 指定, 这里只是兜底). */
export const DEFAULT_MINIMAX_CHAT_MODEL = 'MiniMax-M3';

/** OpenAI 兼容完整端点的尾段 (基址里误填了它就剥掉). */
const CHAT_COMPLETIONS_SUFFIX = '/chat/completions';

/**
 * OpenAI 兼容基址归一: 结尾**恰好一个** `/v1`.
 *
 * 为什么必须归一: LangChain `ChatOpenAI` 的 `baseURL` 由它自己拼 `/chat/completions`,
 * 所以基址要带 `/v1`; 而 MiniMax 现有的 env (`MINIMAX_BASE_URL`) 与旧 agent 流式
 * 链路用的是**不带 `/v1`** 的基址 (那边自己拼 `${baseUrl}/v1/chat/completions`).
 * 两边口径不同又共用同一个 env 键, 于是这里做一次归一, 避免:
 *   - 漏 `/v1` → 请求打到 `/chat/completions` → 上游 404;
 *   - 双 `/v1` → 请求打到 `/v1/v1/chat/completions` → 上游 404.
 *
 * @param raw 原始基址
 * @returns 归一后的基址 (以 `/v1` 结尾, 无尾部斜杠)
 */
export function normalizeOpenAiCompatibleBaseUrl(raw: string): string {
  let base = raw.trim();
  // 去掉尾部斜杠 (逐个剥, 不用正则: 既直白, 也避开正则回溯类静态告警).
  while (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  // 防御: 有人把完整端点写进基址时, 剥掉尾部路径只留基址.
  if (base.toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    base = base.slice(0, -CHAT_COMPLETIONS_SUFFIX.length);
  }
  if (base.endsWith('/v1')) return base;
  return `${base}/v1`;
}

/**
 * 解析 MiniMax 基址 (env 优先, 缺省走默认国内站).
 *
 * @param raw env 原值 (缺省 / 空白 = 用默认)
 * @returns 归一后的基址
 */
export function resolveMinimaxBaseUrl(raw?: string): string {
  const trimmed = (raw ?? '').trim();
  return normalizeOpenAiCompatibleBaseUrl(trimmed.length > 0 ? trimmed : DEFAULT_MINIMAX_BASE_URL);
}

/**
 * 解析 MiniMax 默认 chat 模型 (env 优先, 缺省走种子值).
 *
 * @param raw env 原值 (缺省 / 空白 = 用默认)
 * @returns 模型名
 */
export function resolveMinimaxChatModel(raw?: string): string {
  const trimmed = (raw ?? '').trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_MINIMAX_CHAT_MODEL;
}

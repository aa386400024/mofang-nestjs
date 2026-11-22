// V2026-11-22 建立 (AF-248 · LLM chat 端点拼接):
//   职责: 把 provider 基址归一到 OpenAI 兼容 chat/completions 端点.
//   边界: 纯函数、零 IO；不读 env、不发请求.
//
//   为什么单独抽:
//     MiniMax 与豆包的基址口径不同 —— MiniMax 的 env 不带 /v1（旧链路自己拼
//     `${base}/v1/chat/completions`），豆包方舟是 `/api/v3/chat/completions`。
//     两套拼接写在流式函数里会变成隐藏分支，抽出后才能单测.

export type LlmProvider = 'minimax' | 'doubao';

const CHAT_COMPLETIONS = '/chat/completions';

function normalizeBase(baseUrl: string): string {
  let base = baseUrl.trim();
  while (base.endsWith('/')) base = base.slice(0, -1);
  if (base.endsWith(CHAT_COMPLETIONS)) base = base.slice(0, -CHAT_COMPLETIONS.length);
  return base;
}

/**
 * 拼接 chat 端点.
 *
 * @param provider minimax 或 doubao
 * @param baseUrl 厂商基址；尾部斜杠与 `/chat/completions` 会被剥掉
 */
export function buildChatEndpoint(provider: LlmProvider, baseUrl: string): string {
  const base = normalizeBase(baseUrl);
  if (provider === 'doubao') return `${base}${CHAT_COMPLETIONS}`;
  return base.endsWith('/v1') ? `${base}${CHAT_COMPLETIONS}` : `${base}/v1${CHAT_COMPLETIONS}`;
}

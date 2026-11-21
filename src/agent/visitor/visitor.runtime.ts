// V2026-11-22 建立 (AF-248 · 生产 visitor 运行时开关):
//   职责: 从环境变量解析来访者生成路由与 prompt 变体；默认值与旧链路完全一致.
//   边界: 纯函数、零 IO；env 由调用方传入快照对象，便于单测与 env 覆盖断言.
//
//   为什么默认必须关闭:
//     V5 只在离线影子实验里验证过，尚未做真人双标与生产灰度。默认 minimax + shared
//     保证不配 env 时行为与 AF-247 逐字一致；灰度与回滚都只改 env，不改代码.
//
//   为什么接收快照而不是 read 回调:
//     env 键必须在生产装配点以**字面量** `config.get('KEY')` 出现，
//     test/config/wp25-env-example-coverage.spec.ts 才能用 AST 守住
//     ".env.example 与代码读取点一一对应"；回调形式会让这些键在 AST 里不可见.

/** 来访者生成模型提供方. */
export type VisitorLlmProvider = 'minimax' | 'doubao';

/** 来访者 prompt 变体. */
export type VisitorPromptVariant = 'shared' | 'seed-v5';

/** visitor 运行时所需的 env 原始值快照（未 trim、未校验）. */
export interface VisitorRuntimeSource {
  readonly provider?: string | null;
  readonly promptVariant?: string | null;
  readonly doubaoApiKey?: string | null;
  readonly doubaoModel?: string | null;
}

export interface VisitorRuntimeConfig {
  readonly llmProvider: VisitorLlmProvider;
  readonly promptVariant: VisitorPromptVariant;
  /** 仅 provider=doubao 时下发给 LlmService；MiniMax 保持 env 全局模型. */
  readonly doubaoModel?: string;
}

const PROVIDERS: readonly VisitorLlmProvider[] = ['minimax', 'doubao'];
const VARIANTS: readonly VisitorPromptVariant[] = ['shared', 'seed-v5'];

export const DEFAULT_VISITOR_DOUBAO_MODEL = 'doubao-seed-character-260628';

function trimmed(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const result = raw.trim();
  return result.length > 0 ? result : undefined;
}

function parseEnum<T extends string>(raw: string | undefined, allowed: readonly T[], key: string, fallback: T): T {
  if (raw === undefined) return fallback;
  if (!allowed.includes(raw as T)) {
    throw new Error(`VisitorRuntimeConfig: ${key}=${raw} 非法，只允许 ${allowed.join(' / ')}`);
  }
  return raw as T;
}

/**
 * 解析 visitor 运行时配置.
 *
 * @param source env 原始值快照（生产由 ConfigService 逐键字面量读出）
 * @throws 当开关取值非法，或 provider=doubao 但缺 LLM_DOUBAO_API_KEY
 */
export function resolveVisitorRuntime(source: VisitorRuntimeSource): VisitorRuntimeConfig {
  const llmProvider = parseEnum(trimmed(source.provider), PROVIDERS, 'VISITOR_LLM_PROVIDER', 'minimax');
  const promptVariant = parseEnum(trimmed(source.promptVariant), VARIANTS, 'VISITOR_PROMPT_VARIANT', 'shared');

  if (llmProvider === 'doubao' && trimmed(source.doubaoApiKey) === undefined) {
    throw new Error(
      'VisitorRuntimeConfig: VISITOR_LLM_PROVIDER=doubao 需要 LLM_DOUBAO_API_KEY；' +
        '未配置时请改回 minimax，或在火山方舟申请 key 后再开灰度',
    );
  }

  return {
    llmProvider,
    promptVariant,
    ...(llmProvider === 'doubao' ? { doubaoModel: trimmed(source.doubaoModel) ?? DEFAULT_VISITOR_DOUBAO_MODEL } : {}),
  };
}

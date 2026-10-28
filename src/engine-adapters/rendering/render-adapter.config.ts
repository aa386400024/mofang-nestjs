// V2026-10-28 治本 (WP6 · B 层 · 渲染适配层配置):
//   职责: 定义渲染适配层的**全部可配置面** —— 候选序列 / 任务分层参数 /
//         单次超时 / 失败阈值 / 冷却退避 / block 重生成预算 / 兜底话术,
//         集中在一处, 供适配器与主备运行时读取.
//   边界: 纯数据 + 纯工厂, 零 IO, 零 @nestjs, 零读 .env, 零网络.
//
//   为什么这些参数必须全部配置化 (M3):
//     厂商 / 模型名 / 温度一旦写进适配器代码, 换模型就要改代码 + 重新发版;
//     而且"温度"本质是**内容安全与口语自然度的权衡** —— 低温更稳更安全但发木,
//     高温更像人说话但更容易飘; 不同模型族的最优值也不同, 写死一个数字等于
//     替所有厂商做了决定. 所以全部收敛到配置, WP8 再从 env / DB 读入.
//
//   反双胞胎:
//     - 不在本层校验候选 id 是否已注册 provider: 注册表是 src/llm 的职责,
//       适配层只负责"按 id 调出去"; 未注册时 router 走其既有回落行为
//       (指定 provider 未注册 → 回落默认 provider), 本层不重复实现.
//     - 不在本层读 .env: 配置**来源**属装配层 (WP8), 本层只收"已归一好的配置对象",
//       于是单测可以构造任意配置, 不必依赖环境变量.
//     - 不把"任务分层 → 参数"的映射写死在适配器: 映射读 taskDefaults,
//       于是 stable/chat/advanced 的口径由配置一句话改, 不用动代码.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp6-llm-render.spec.ts 覆盖参数解析与种子默认值

import type { RenderTaskKind } from '../../engine-core';

/**
 * 任务分层参数覆盖 (按 taskKind 生效).
 *
 * 三个字段全部可选: 缺省表示"沿用全局默认", 而不是"清零".
 */
export interface RenderTaskParams {
  /** 采样温度 (OpenAI 语义 0..2). */
  readonly temperature?: number;
  /** 模型名 (provider 侧模型 id). */
  readonly model?: string;
  /** 单次完成 token 上限. */
  readonly maxTokens?: number;
}

/**
 * 一个主备候选 (id 与已注册 providerId 对齐, 决定实际调用出口).
 */
export interface RenderCandidate {
  /** 候选标识 (即 AIProviderId 字符串), 供 providerHint / 日志 / 冷却记账. */
  readonly id: string;
  /** 覆盖该候选在某 taskKind 下的温度 / 模型 / token 上限; 缺省走全局. */
  readonly overrides?: Partial<Record<RenderTaskKind, RenderTaskParams>>;
}

/**
 * 各任务分层的默认参数.
 */
export interface RenderTaskDefaults {
  /** 该分层的默认温度. */
  readonly temperature: number;
  /** 该分层的默认模型 (缺省表示"该层未指定模型", 需由候选 overrides 补齐). */
  readonly model?: string;
  /** 该分层的默认 token 上限 (缺省取 spec.tokenBudget.maxCompletionTokens). */
  readonly maxTokens?: number;
}

/**
 * 渲染适配器配置 (构造注入, 不读环境变量).
 */
export interface RenderAdapterConfig {
  /** 候选序列, 第 0 位为主; 顺序即优先级. */
  readonly candidates: readonly RenderCandidate[];
  /** 各 taskKind 的默认参数 (可被候选 overrides 覆盖). */
  readonly taskDefaults: Record<RenderTaskKind, RenderTaskDefaults>;
  /** 单次调用超时 ms. */
  readonly timeoutMs: number;
  /** 连续失败多少次进入冷却. */
  readonly failureThreshold: number;
  /** 冷却时长基数 ms (实际冷却 = cooldownBaseMs * 2^(连续失败-1)). */
  readonly cooldownBaseMs: number;
  /** 冷却时长上限 ms (指数退避封顶). */
  readonly cooldownMaxMs: number;
  /** block 重生成最大次数 (本期语义为 1). */
  readonly maxBlockRegen: number;
  /** 全部失败 / 仍 block 时的兜底稳定话术 (中性、不越界、不给建议). */
  readonly fallbackUtterance: string;
}

/**
 * 任务分层种子温度 (工程种子值, **未标定**).
 *
 * stable 取低温 —— 结构化判断 / 状态更新要的是确定性, 不是文采;
 * chat 取高温 —— 来访口语要的是"像人在说话", 低温会说出客服腔;
 * advanced 本期直接回退 chat 口径 (本期没有高阶模型档位, 别假装有).
 *
 * 后期按真实模型与实测校准, WP8 可从 env 覆盖 (集中改这一处即可).
 */
export const DEFAULT_RENDER_TASK_DEFAULTS: Readonly<Record<RenderTaskKind, RenderTaskDefaults>> = {
  stable: { temperature: 0.2 },
  chat: { temperature: 0.85 },
  advanced: { temperature: 0.85 },
};

/** 单次调用超时种子值 (ms). */
export const DEFAULT_RENDER_TIMEOUT_MS = 30_000;

/** 连续失败进入冷却的阈值种子值. */
export const DEFAULT_RENDER_FAILURE_THRESHOLD = 3;

/** 冷却时长基数种子值 (ms). */
export const DEFAULT_RENDER_COOLDOWN_BASE_MS = 30_000;

/** 冷却时长上限种子值 (ms). */
export const DEFAULT_RENDER_COOLDOWN_MAX_MS = 300_000;

/** block 重生成预算种子值 (本期语义: 最多重生成一次). */
export const DEFAULT_RENDER_MAX_BLOCK_REGEN = 1;

/**
 * 兜底话术种子值 (中性、不越界、不给建议、不承诺).
 *
 * 用途: 主备全挂或输出仍高危时的最后一句 —— 对话**不能因为模型挂了就断流**,
 * 但兜底句本身也绝不能变成"专业建议"(那是越界, 与伦理引擎同一条红线).
 */
export const DEFAULT_RENDER_FALLBACK_UTTERANCE = '……我先缓一下, 我们接着说。';

/**
 * 配置覆盖项 (候选序列与分层默认除外, 其余可覆盖).
 */
export type RenderAdapterConfigOverrides = Partial<Omit<RenderAdapterConfig, 'candidates' | 'taskDefaults'>> & {
  /** 按 taskKind 覆盖默认参数 (逐字段合并, 缺省字段仍走种子值). */
  readonly taskDefaults?: Partial<Record<RenderTaskKind, RenderTaskParams>>;
};

/**
 * 构造渲染适配器配置: 候选序列必填, 其余走种子默认值.
 *
 * 为什么要有这个工厂而不是让调用方手搓整个对象:
 *   手搓就意味着每个调用方都要记得把 7 个字段填全, 漏一个就是 undefined 走进
 *   退避计算 —— 那种 bug 只在"主备连续失败 N 次"时才炸, 极难复现.
 *   工厂把默认值集中在一处, 调用方只声明自己真正要改的.
 *
 * @param candidates 候选序列 (顺序即优先级, 第 0 位为主)
 * @param overrides 需要覆盖的项
 * @returns 归一后的完整配置
 */
export function createRenderAdapterConfig(
  candidates: readonly RenderCandidate[],
  overrides: RenderAdapterConfigOverrides = {},
): RenderAdapterConfig {
  return {
    candidates,
    taskDefaults: {
      stable: mergeTaskDefaults(DEFAULT_RENDER_TASK_DEFAULTS.stable, overrides.taskDefaults?.stable),
      chat: mergeTaskDefaults(DEFAULT_RENDER_TASK_DEFAULTS.chat, overrides.taskDefaults?.chat),
      advanced: mergeTaskDefaults(DEFAULT_RENDER_TASK_DEFAULTS.advanced, overrides.taskDefaults?.advanced),
    },
    timeoutMs: overrides.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
    failureThreshold: overrides.failureThreshold ?? DEFAULT_RENDER_FAILURE_THRESHOLD,
    cooldownBaseMs: overrides.cooldownBaseMs ?? DEFAULT_RENDER_COOLDOWN_BASE_MS,
    cooldownMaxMs: overrides.cooldownMaxMs ?? DEFAULT_RENDER_COOLDOWN_MAX_MS,
    maxBlockRegen: overrides.maxBlockRegen ?? DEFAULT_RENDER_MAX_BLOCK_REGEN,
    fallbackUtterance: overrides.fallbackUtterance ?? DEFAULT_RENDER_FALLBACK_UTTERANCE,
  };
}

/**
 * 逐字段合并任务分层默认参数 (覆盖项缺省的字段仍取种子值).
 */
function mergeTaskDefaults(base: RenderTaskDefaults, override: RenderTaskParams | undefined): RenderTaskDefaults {
  if (!override) return base;
  return {
    temperature: override.temperature ?? base.temperature,
    ...(override.model === undefined ? {} : { model: override.model }),
    ...(override.maxTokens === undefined ? {} : { maxTokens: override.maxTokens }),
  };
}

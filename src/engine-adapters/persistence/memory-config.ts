// V2026-10-30 治本 (WP12 · B 层 · 记忆衰减/召回配置):
//   职责: 把"重要度衰减半衰期"与"访客范围召回阈值"两个**工程种子值**从内核常量里
//         解耦成**可配置项**, 集中在一处导出, 不散落到各调用点.
//   边界: 纯数据 + 纯函数, 零 IO, 零 @nestjs, 零读 .env (env 由装配层读好后传入).
//
//   为什么这两个数要配置化 (任务单 §1.3):
//     `DEFAULT_DECAY_HALF_LIFE_MS` (30 天) 与 `RECALL_MIN_EFFECTIVE_IMPORTANCE` (0.1)
//     是**工程种子值**, 不是临床结论 —— 内核注释里明确写着"后期靠真实训练数据校准".
//     写死在代码里意味着每次校准都要改内核 + 重新发版; 配置化之后, 改一个 env 就完事.
//
//   ⚠️ **与内核常量的关系 (必须如实知道, 不要误以为"内核常量被覆盖了")**:
//     内核 `src/engine-core/memory/importance-decay.ts` 里的两个常量**本轮不改**
//     (WP12 红线: 不改 `src/engine-core/**`), 它们是内核**共享判定**里的**默认值**:
//       - `evaluateRecallCandidate` 内部用 `DEFAULT_DECAY_HALF_LIFE_MS` 算有效重要度,
//         并用 `RECALL_MIN_EFFECTIVE_IMPORTANCE` (0.1) 卡一道;
//       - 这两个值是**缺省回退** —— 端口注入时 (WP59) 传进来的配置值会**覆盖**它们:
//         传了 = 用配置值, 没传 = 用内核默认值.
//     本文件配出来的值在 **内核判定口径**上**完全生效** (WP59 起):
//       - 半衰期 → 传给内核 `evaluateRecallCandidate` 的 `RecallPolicyOptions.halfLifeMs`
//         (门槛判定 + 排序都用它);
//       - 阈值   → 传给内核 `RecallPolicyOptions.minEffectiveImportance`
//         (内核用它卡访客范围的门槛 —— 不再是 B 层"追加一道" = 不再取交集).
//     换句话说: **默认配置下与现状逐字一致** (30 天 / 0.1 == 内核默认值);
//     改 env 后内核判定口径立刻变, 且**只有一份判定** (Qdrant 版与内存版共用).
//     ⚠️ **口径变化 (与 WP12 当时的行为不同, 别照旧记忆理解)**:
//       WP12 时期内核那道 0.1 是"不可绕过的地板", 阈值**只能收紧** (配成 < 0.1 不生效).
//       WP59 起内核那 0.1 只是**默认值**, 阈值配成 < 0.1 也会**真的放行** ——
//       这是"配置值直接生效, 不取交集"的必然结果, 也是内核判定**只有一份**的代价.
//
//   反双胞胎:
//     - 不在这里重写内核的衰减公式: 内核 `decayImportance` / `effectiveImportance`
//       已经接受 `halfLifeMs` 参数, 本文件只**喂参数**, 不复算 ——
//       复算一份 = 两份公式迟早漂移 (与 recall-policy.ts 同款道理).
//     - 不在装配层直接散落读 env: env 读法集中在这一个纯函数里, 单测不必改 process.env.
//     - 不做动态调参 / 按角色差异化配置: 任务单 §1.3 明确 Phase2 再做, 本期不做.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp12-memory-closeout.spec.ts: 默认值 / env 覆盖 / 非法值回退

/** 一天的毫秒数. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 默认衰减半衰期 (天) —— 与内核 `DEFAULT_DECAY_HALF_LIFE_MS` 同值. */
export const DEFAULT_MEMORY_DECAY_HALF_LIFE_DAYS = 30;

/** 默认访客范围召回阈值 —— 与内核 `RECALL_MIN_EFFECTIVE_IMPORTANCE` 同值. */
export const DEFAULT_MEMORY_RECALL_THRESHOLD = 0.1;

/**
 * 记忆衰减/召回配置 (构造注入, 不读环境变量).
 */
export interface MemoryConfig {
  /** 重要度衰减半衰期 (ms). */
  readonly decayHalfLifeMs: number;
  /** 访客范围召回的有效重要度门槛 [0,1]. */
  readonly recallThreshold: number;
}

/**
 * 配置来源 (env 原始字符串; undefined = 未配置).
 */
export interface MemoryConfigEnv {
  /** `MEMORY_DECAY_HALF_LIFE_DAYS` 原始值. */
  readonly decayHalfLifeDays?: string;
  /** `MEMORY_RECALL_THRESHOLD` 原始值. */
  readonly recallThreshold?: string;
}

/**
 * 构造记忆配置 (非法值一律回退默认值, 绝不抛错).
 *
 * 为什么非法值回退而不是抛: 配置是**运维面**, 填错一个 env 不该让整个服务起不来;
 * 回退到默认值 + 记一条 warn 是这类"增强型配置"的标准处置.
 *
 * @param env env 原始值 (缺省 = 全走默认值)
 * @returns 归一后的配置
 */
export function resolveMemoryConfig(env: MemoryConfigEnv = {}): MemoryConfig {
  const days = readPositiveNumber(env.decayHalfLifeDays);
  const threshold = readRatio(env.recallThreshold);
  return {
    decayHalfLifeMs: (days ?? DEFAULT_MEMORY_DECAY_HALF_LIFE_DAYS) * MS_PER_DAY,
    recallThreshold: threshold ?? DEFAULT_MEMORY_RECALL_THRESHOLD,
  };
}

/**
 * 默认记忆配置 (半衰期 30 天 / 阈值 0.1 —— 与内核常量同值).
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = resolveMemoryConfig();

/**
 * B 层配置 → 内核召回策略端口 (WP59).
 *
 * 为什么要有这层映射: B 层的 `MemoryConfig` 用自己的字段名 (`decayHalfLifeMs` /
 * `recallThreshold`), 内核端口 `RecallPolicyOptions` 用内核口径的字段名
 * (`halfLifeMs` / `minEffectiveImportance`). 两者是**同一组数字**, 但字段名不同.
 *
 * 映射**只留这一处** —— 各调用点各写一遍 = 两套命名迟早漂移 (仓库既有教训:
 * 判定逻辑一旦写两份, 就会在某个 WP 里悄悄分叉).
 *
 * ⚠️ 返回类型**故意不写成内核的 `RecallPolicyOptions`**: 适配层深路径 import
 * engine-core 内部模块会被边界断言 ⑪ 拦下, 而内核 barrel 的公开出口面被断言 ⑥
 * 冻结 (加导出 = 改 barrel + 改断言白名单 = 动第三个内核文件, 超出本单预批准范围).
 * 这里用**结构化类型**声明 —— TypeScript 结构性兼容保证它就是内核那个端口,
 * 调用点仍然会被编译期校验 (内核端口字段若改名, 调用点立刻编译报错).
 *
 * @param config B 层配置
 * @returns 内核召回策略端口
 */
export function toRecallPolicyOptions(config: MemoryConfig): {
  readonly halfLifeMs: number;
  readonly minEffectiveImportance: number;
} {
  return {
    halfLifeMs: config.decayHalfLifeMs,
    minEffectiveImportance: config.recallThreshold,
  };
}

/**
 * 读一个正有限数 (非法 → undefined).
 */
function readPositiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * 读一个 0..1 的比例 (非法 → undefined).
 */
function readRatio(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return undefined;
  return parsed;
}

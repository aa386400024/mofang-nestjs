// V2026-11-05 治本 (WP32 · B 层 · BDI 状态存储形态装配):
//   职责: 把 env 里的 `ENGINE_BDI_STATE_*` 两个键装配成"BDI 状态存哪儿"的**部署形态**决定.
//   边界: 纯数据 + 纯函数, 零 IO, 零 @nestjs, 零读 .env (env 由装配层读好后传入).
//
//   为什么这一层存在 (照 WP26 P2-14 / WP34 / WP42 / WP36 的先例):
//     "用内存还是 Redis"是**部署形态**的决定, 不是构造逻辑 —— 与"用不用向量库"同一性质.
//     所以判断与构造都在**同一处** (装配层的一个纯工厂), 不留第二份真相.
//
//   为什么 2 个键**逐个显式读** (而不是循环读计算键):
//     仓库 env 治理约定 (typings/global.d.ts) 要求"显式声明到 ProcessEnv, 不用
//     bracket 访问绕过". 计算键编译器拦不住, 属静默偏离; 而 `config.get<string>('字面量')`
//     能被 env 覆盖断言 (test/config/wp25-env-example-coverage.spec.ts) 的 AST 抽取看到 ——
//     漏写一个键, 那个断言立刻变红.
//
//   ⚠️ **非法存储形态 = 启动期直接炸** (不静默回落成 memory):
//     回落成 memory 的失败方向是**骗人**的 —— 线上以为在持久化, 实际一条都没存,
//     而且**不报错** (进程重启状态照样丢, 只是没人知道为什么).
//     仓库既有铁律 (engine.providers.ts 文件头): "不在工厂里吞异常: 装配非法必须炸到启动期".
//     所以这里只对**空值**回落默认 (memory), 对**非法值**抛错.
//     ⚠️ 这与仓库里那些"非法数值回退种子值"的调参类配置**故意不同** ——
//     数值回退只是让某一维系数回到默认, 形态回退会让**整个持久化能力消失**, 两者风险等级不同.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp32-bdi-state-persistence.spec.ts 覆盖缺省 / 覆盖 / 非法值

import { DEFAULT_BDI_STATE_REDIS_TTL_SECONDS } from '../persistence/redis-bdi-state.repository.js';

/** BDI 状态的存储形态. */
export type BdiStateStoreKind = 'memory' | 'redis';

/** BDI 状态存储配置 (归一后的结果). */
export interface BdiStateStoreConfig {
  /** 存储形态. */
  readonly store: BdiStateStoreKind;
  /** Redis 版的存活时长 (秒; memory 形态下不生效). */
  readonly ttlSeconds: number;
}

/**
 * 配置来源 (env 原始字符串; undefined = 未配置).
 */
export interface BdiStateStoreConfigEnv {
  /** `ENGINE_BDI_STATE_STORE` 原始值. */
  readonly store?: string;
  /** `ENGINE_BDI_STATE_REDIS_TTL_SECONDS` 原始值. */
  readonly ttlSeconds?: string;
}

/**
 * 装配 BDI 状态存储配置.
 *
 * @param env env 原始值 (缺省 = 全走默认值)
 * @returns 归一后的配置
 * @throws 存储形态非法时抛错 (装配非法必须炸在启动期, 不静默回落)
 */
export function resolveBdiStateStoreConfig(env: BdiStateStoreConfigEnv = {}): BdiStateStoreConfig {
  return {
    store: resolveStoreKind(env.store),
    ttlSeconds: resolveTtlSeconds(env.ttlSeconds),
  };
}

/**
 * 解析存储形态.
 *
 * 缺省 / 空串 → `memory` (零回归: 行为与 WP32 之前**逐字一致**).
 * `redis` (忽略大小写与首尾空白) → `redis`.
 * 其它值 → **抛错** (见文件头: 静默回落成 memory = 线上以为在持久化, 实际没存).
 */
function resolveStoreKind(raw: string | undefined): BdiStateStoreKind {
  if (raw === undefined) return 'memory';
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 'memory';
  const normalized = trimmed.toLowerCase();
  if (normalized === 'memory') return 'memory';
  if (normalized === 'redis') return 'redis';
  throw new Error(`BDI 状态存储形态配置非法: ${trimmed} (合法值: memory | redis)`);
}

/**
 * 解析存活时长 (非法 → 回退默认, 不抛错).
 *
 * 非法值回退而不是抛错的理由: TTL 只是一个"多久清理僵尸会话"的运维旋钮,
 * 填错它不会让状态"存到别人身上"或"存不进去" —— 最多是清理节奏不对.
 * 这与"存储形态"的风险等级不同 (形态错 = 持久化能力整个消失, TTL 错 = 只是清理快慢).
 */
function resolveTtlSeconds(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_BDI_STATE_REDIS_TTL_SECONDS;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_BDI_STATE_REDIS_TTL_SECONDS;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_BDI_STATE_REDIS_TTL_SECONDS;
  }
  return parsed;
}

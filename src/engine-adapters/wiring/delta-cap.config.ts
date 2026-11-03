// V2026-11-03 治本 (WP26 · B 层 · 单回合 delta cap 配置装配):
//   职责: 把 env 里的 18 个 `ENGINE_CAP_*` 键装配成内核的 `DeltaCapConfig` 端口.
//   边界: 只做"读 env → 校验 → 组装"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么这一层存在 (P2-14 的落地点):
//     WP15 把 cap 参数直接写在内核里读 process.env —— 那让内核第一次有了"配置层",
//     与"内核没有配置层"的自述直接冲突, 更实质的是破坏了**可复现性**: 引擎把 seed
//     定义成"可复现性的入口", env 参与决策后, 同 seed 同序列在不同 cap 配置下会落到
//     不同状态, 回放/对拍失去意义.
//     改注入之后, 依赖方向变成: env → (本文件, 适配层) → DeltaCapConfig → (内核端口).
//     内核只认端口, 不认 env —— 于是"内核零 process.env"成为可机器断言的事实.
//
//   为什么 18 个键**逐个显式读** (而不是循环读计算键):
//     仓库 env 治理约定 (typings/global.d.ts) 要求"显式声明到 ProcessEnv, 不用
//     bracket 访问绕过". 计算键 (`ENGINE_CAP_${dim}_${direction}`) 编译器拦不住,
//     属静默偏离; 而 `config.get<string>('字面量')` 能被 env 覆盖断言
//     (test/config/wp25-env-example-coverage.spec.ts) 的 AST 抽取看到 ——
//     漏写一个键, 那个断言立刻变红.
//
//   非法值一律回退内核种子值 (不抛错):
//     填错一个 env 不该让整场对练的 BDI 迁移失真 —— 回退到种子值, 行为仍然确定.
//     方向也校验: 上向 cap 给负数 / 下向 cap 给正数 = 配置写反了, 一律回退.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp26-delta-cap-config.spec.ts 覆盖组装与非法值回退

import type { ConfigService } from '@nestjs/config';

import { DEFAULT_DELTA_CAP_CONFIG, type CapBounds, type DeltaCapConfig } from '../../engine-core/index.js';

/**
 * 解析一个 cap 边界值 (非法 → 回退默认).
 *
 * @param raw env 原值 (未设 / 空串 / 非数字 / 方向与符号不符 → 回退)
 * @param fallback 默认值 (内核种子值)
 * @param direction 边界方向 (up = 非负; down = 非正)
 * @returns 有效边界值
 */
function resolveBound(raw: string | undefined, fallback: number, direction: 'up' | 'down'): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return fallback;
  if (direction === 'up' && value < 0) return fallback;
  if (direction === 'down' && value > 0) return fallback;
  return value;
}

/** 一维的上下界装配 (两个 env 值 → 一组边界). */
function resolveBounds(upRaw: string | undefined, downRaw: string | undefined, fallback: CapBounds): CapBounds {
  return {
    up: resolveBound(upRaw, fallback.up, 'up'),
    down: resolveBound(downRaw, fallback.down, 'down'),
  };
}

/**
 * 装配单回合 delta cap 配置 (9 维度 × 上下向 = 18 个值).
 *
 * 键名口径: `ENGINE_CAP_<维度>_UP` / `ENGINE_CAP_<维度>_DOWN`
 *   (维度大写: TRUST / VALENCE / AROUSAL / VERBAL / DEPTH / STYLE / POSITIVE /
 *    NEGATIVE / DEPENDENCY).
 *
 * @param config 配置服务 (读 env)
 * @returns 内核的 cap 配置端口 (缺省 = 内核种子值)
 */
export function resolveDeltaCapConfig(config: ConfigService): DeltaCapConfig {
  return {
    trust: resolveBounds(
      config.get<string>('ENGINE_CAP_TRUST_UP'),
      config.get<string>('ENGINE_CAP_TRUST_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.trust,
    ),
    valence: resolveBounds(
      config.get<string>('ENGINE_CAP_VALENCE_UP'),
      config.get<string>('ENGINE_CAP_VALENCE_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.valence,
    ),
    arousal: resolveBounds(
      config.get<string>('ENGINE_CAP_AROUSAL_UP'),
      config.get<string>('ENGINE_CAP_AROUSAL_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.arousal,
    ),
    verbal: resolveBounds(
      config.get<string>('ENGINE_CAP_VERBAL_UP'),
      config.get<string>('ENGINE_CAP_VERBAL_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.verbal,
    ),
    depth: resolveBounds(
      config.get<string>('ENGINE_CAP_DEPTH_UP'),
      config.get<string>('ENGINE_CAP_DEPTH_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.depth,
    ),
    style: resolveBounds(
      config.get<string>('ENGINE_CAP_STYLE_UP'),
      config.get<string>('ENGINE_CAP_STYLE_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.style,
    ),
    positive: resolveBounds(
      config.get<string>('ENGINE_CAP_POSITIVE_UP'),
      config.get<string>('ENGINE_CAP_POSITIVE_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.positive,
    ),
    negative: resolveBounds(
      config.get<string>('ENGINE_CAP_NEGATIVE_UP'),
      config.get<string>('ENGINE_CAP_NEGATIVE_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.negative,
    ),
    dependency: resolveBounds(
      config.get<string>('ENGINE_CAP_DEPENDENCY_UP'),
      config.get<string>('ENGINE_CAP_DEPENDENCY_DOWN'),
      DEFAULT_DELTA_CAP_CONFIG.dependency,
    ),
  };
}

// V2026-11-03 WP36 (B 层 · 跨会话间隔衰减半衰期装配):
//   职责: 把 env 里的 3 个 `ENGINE_DECAY_*` 键装配成内核的 `SessionDecayConfig` 端口.
//   边界: 只做"读 env → 校验 → 组装"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么这一层存在 (照 WP26 P2-14 / WP34 / WP42 的先例):
//     内核不得有任何进程级外部依赖 —— 半衰期也不例外. 依赖方向是:
//       env → (本文件, 适配层) → SessionDecayConfig → (内核端口).
//     内核只认端口, 不认 env —— 于是"内核零 process.env"这条不变量继续成立
//     (boundary.spec.ts 断言⑩ 守着).
//
//   为什么 3 个键**逐个显式读** (而不是循环读计算键):
//     仓库 env 治理约定 (typings/global.d.ts) 要求"显式声明到 ProcessEnv, 不用
//     bracket 访问绕过". 计算键 (`ENGINE_DECAY_${group}_HALF_LIFE_MS`) 编译器拦不住,
//     属静默偏离; 而 `config.get<string>('字面量')` 能被 env 覆盖断言
//     (test/config/wp25-env-example-coverage.spec.ts) 的 AST 抽取看到 ——
//     漏写一个键, 那个断言立刻变红.
//
//   非法值一律**回退内核种子值** (不抛错):
//     填错一个 env 不该让整场对练的 BDI 迁移失真 —— 回退到种子值, 行为仍然确定.
//     半衰期必须为**正有限数**: 0 会让 `2^(-age/0)` 变成 Infinity, 负数会让
//     "越久越淡"变成"越久越浓", 两者都会把整份快照污染掉 —— 内核那层也兜了底
//     (见 engine-core/cognition/session-decay.ts 的 sanitizeHalfLife), 双保险.
//
//   ⚠️ 半衰期是**工程种子值, 非临床标定** —— 待真实对练校准.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp36-session-decay-config.spec.ts 覆盖组装与非法值回退
//     3. test/config/wp25-env-example-coverage.spec.ts 断言③e 守住"逐个字面量读 + 内核零 env"

import type { ConfigService } from '@nestjs/config';

import { DEFAULT_SESSION_DECAY_CONFIG, type SessionDecayConfig } from '../../engine-core/index.js';

/**
 * 解析一个半衰期 (非法 → 回退内核种子值).
 *
 * @param raw env 原值 (未设 / 空串 / 非数字 / 非正数 → 回退)
 * @param fallback 内核种子值
 * @returns 有效半衰期 (ms, 正有限数)
 */
function resolveHalfLife(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * 装配跨会话间隔衰减端口 (3 个半衰期 = 3 个 env 键).
 *
 * 键名口径: `ENGINE_DECAY_EMOTION_HALF_LIFE_MS` /
 *   `ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS` / `ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS`.
 *
 * 单位: 毫秒 (与内核端口一致). 留空 = 继承内核种子值 (情绪 7 天 / 阻抗 14 天 / 同盟 30 天).
 *
 * @param config 配置服务 (读 env)
 * @returns 内核的衰减端口 (缺省 / 非法 = 内核种子值)
 */
export function resolveSessionDecayConfig(config: ConfigService): SessionDecayConfig {
  const seed = DEFAULT_SESSION_DECAY_CONFIG;
  return {
    emotionHalfLifeMs: resolveHalfLife(config.get<string>('ENGINE_DECAY_EMOTION_HALF_LIFE_MS'), seed.emotionHalfLifeMs),
    resistanceHalfLifeMs: resolveHalfLife(config.get<string>('ENGINE_DECAY_RESISTANCE_HALF_LIFE_MS'), seed.resistanceHalfLifeMs),
    allianceHalfLifeMs: resolveHalfLife(config.get<string>('ENGINE_DECAY_ALLIANCE_HALF_LIFE_MS'), seed.allianceHalfLifeMs),
  };
}

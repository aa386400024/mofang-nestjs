// V2026-11-03 WP37 (B 层 · 会话摘要参数装配):
//   职责: 把 env 里的摘要相关键装配成服务构造入参 ——
//           ① `SESSION_SUMMARY_BATCH_SIZE`      → 滚动摘要的攒批阈值;
//           ② `SESSION_SUMMARY_ROLLING_IMPORTANCE` → 滚动摘要的重要度;
//           ③ `SESSION_SUMMARY_FINAL_IMPORTANCE`   → 会话结束的最终摘要重要度 (WP12 那条路径).
//   边界: 只做"读 env → 校验 → 归一"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么这一层存在 (照 WP26 P2-14 / WP34 / WP42 的先例):
//     内核不得有任何进程级外部依赖 —— 摘要参数也不例外. 依赖方向是:
//       env → (本文件, 适配层) → 服务构造入参.
//     内核零 process.env 这条不变量继续成立 (boundary.spec.ts 断言⑩ 守着).
//
//   为什么键**逐个显式读** (而不是循环读计算键):
//     仓库 env 治理约定 (typings/global.d.ts) 要求"显式声明到 ProcessEnv, 不用
//     bracket 访问绕过". 计算键 (`SESSION_SUMMARY_${kind}`) 编译器拦不住, 属静默偏离;
//     而 `config.get<string>('字面量')` 能被 env 覆盖断言
//     (test/config/wp25-env-example-coverage.spec.ts) 的 AST 抽取看到 ——
//     漏写一个键, 那个断言立刻变红.
//
//   非法值一律**回退种子值** (不抛错):
//     填错一个 env 不该让整场对练的摘要失真 —— 回退后行为仍然确定.
//
//   ⚠️ 参数是**工程种子值, 非临床标定** —— 待真实对练校准.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp37-rolling-session-summary.spec.ts 覆盖组装与非法值回退
//     3. test/config/wp25-env-example-coverage.spec.ts 断言③f 守住"逐个字面量读 + 内核零 env"

import type { ConfigService } from '@nestjs/config';

import { DEFAULT_ROLLING_SUMMARY_BATCH_SIZE, DEFAULT_ROLLING_SUMMARY_IMPORTANCE } from '../persistence/rolling-session-summary.service.js';
import { DEFAULT_SESSION_SUMMARY_IMPORTANCE } from '../persistence/session-closeout.service.js';

/**
 * 摘要参数装配结果.
 */
export interface SessionSummaryConfig {
  /** 滚动摘要的攒批阈值 (攒够 N 轮被挤出的发言才压一次). */
  readonly rollingBatchSize: number;
  /** 滚动摘要的重要度 [0,1]. */
  readonly rollingImportance: number;
  /** 会话结束的最终摘要重要度 [0,1] (WP12 收尾路径). */
  readonly finalImportance: number;
}

/**
 * 解析一个正整数 (非法 → 回退种子值).
 */
function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

/**
 * 解析一个 [0,1] 区间的重要度 (非法 → 回退种子值).
 */
function resolveRatio(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/**
 * 装配会话摘要参数 (3 个 env 键).
 *
 * 键名口径: `SESSION_SUMMARY_BATCH_SIZE` / `SESSION_SUMMARY_ROLLING_IMPORTANCE` /
 *   `SESSION_SUMMARY_FINAL_IMPORTANCE`.
 *
 * @param config 配置服务 (读 env)
 * @returns 归一后的摘要参数 (缺省 / 非法 = 内核种子值)
 */
export function resolveSessionSummaryConfig(config: ConfigService): SessionSummaryConfig {
  return {
    rollingBatchSize: resolvePositiveInt(config.get<string>('SESSION_SUMMARY_BATCH_SIZE'), DEFAULT_ROLLING_SUMMARY_BATCH_SIZE),
    rollingImportance: resolveRatio(config.get<string>('SESSION_SUMMARY_ROLLING_IMPORTANCE'), DEFAULT_ROLLING_SUMMARY_IMPORTANCE),
    finalImportance: resolveRatio(config.get<string>('SESSION_SUMMARY_FINAL_IMPORTANCE'), DEFAULT_SESSION_SUMMARY_IMPORTANCE),
  };
}

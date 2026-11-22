// V2026-11-06 治本 (WP58 · B 层 · 事件 + delta 审计观测 · 开关装配):
//   职责: 把 env 里的 TURN_DELTA_AUDIT_ENABLED 装配成"观测通道开没开".
//   边界: 只做"读 env → 校验"; 不起 Nest 容器也能单测.
//
//   为什么走适配层 (而不是内核直接读 env):
//     与 WP26 (delta cap) / WP34 (人格调节) / WP42 (同盟三维) 同一治本 ——
//     内核零 process.env (boundary.spec.ts 断言⑩ 守着). env 由适配层读,
//     通过配置对象注入.
//
//   缺省 = **关**:
//     观测通道是增强, 不是会话能力 —— 生产默认关 = 不占空间、不耗性能.
//     开关关着时**连分类器都不跑** (零开销), 见 turn-delta-audit.service.ts.
//
//   非法值回退"关" (不抛错):
//     填错一个 env 不该让服务起不来 —— 回退默认, 行为仍然确定.
//
//   布尔口径与仓库既有开关一致 (true / 1 / yes / on = 开; 见
//   resolveDeliberationEnabled 的同一套写法).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp58-turn-delta-audit.spec.ts 覆盖缺省/真值/非法值
//     3. test/config/wp25-env-example-coverage.spec.ts 断言①② 守住"模板与代码一一对应"

import type { ConfigService } from '@nestjs/config';

/**
 * 事件 + delta 审计观测的配置.
 */
export interface TurnDeltaAuditConfig {
  /** 观测通道是否开启 (关着 = 零开销). */
  readonly enabled: boolean;
}

/**
 * 解析布尔开关 (非法 / 缺省 → 关).
 *
 * @param raw env 原值 (未 trim / 未归一)
 * @returns true = 开
 */
function parseEnabled(raw: string | undefined): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

/**
 * 装配事件 + delta 审计观测的配置.
 *
 * @param config 配置服务 (读 env)
 * @returns 观测通道配置
 */
export function resolveTurnDeltaAuditConfig(config: ConfigService): TurnDeltaAuditConfig {
  return { enabled: parseEnabled(config.get<string>('TURN_DELTA_AUDIT_ENABLED')) };
}

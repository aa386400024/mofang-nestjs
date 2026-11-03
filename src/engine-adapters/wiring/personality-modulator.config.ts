// V2026-11-03 WP34 (B 层 · 人格调节系数装配):
//   职责: 把 env 里的 10 个 `ENGINE_MOD_*` 键装配成内核的 `PersonalityModulatorConfig` 端口.
//   边界: 只做"读 env → 校验 → 组装"; 不改任何状态, 不起 Nest 容器也能单测.
//
//   为什么这一层存在 (照 WP26 P2-14 的先例):
//     内核不得有任何进程级外部依赖 —— 人格系数也不例外. 依赖方向是:
//       env → (本文件, 适配层) → PersonalityModulatorConfig → (内核端口).
//     内核只认端口, 不认 env —— 于是"内核零 process.env"这条不变量继续成立
//     (boundary.spec.ts 断言⑩ 守着).
//
//   为什么 10 个键**逐个显式读** (而不是循环读计算键):
//     仓库 env 治理约定 (typings/global.d.ts) 要求"显式声明到 ProcessEnv, 不用
//     bracket 访问绕过". 计算键 (`ENGINE_MOD_${style}_${kind}`) 编译器拦不住,
//     属静默偏离; 而 `config.get<string>('字面量')` 能被 env 覆盖断言
//     (test/config/wp25-env-example-coverage.spec.ts) 的 AST 抽取看到 ——
//     漏写一个键, 那个断言立刻变红.
//
//   非法值一律回退内核种子值 (不抛错):
//     填错一个 env 不该让整场对练的 BDI 迁移失真 —— 回退到种子值, 行为仍然确定.
//     方向也校验: trust 系数不得为负; 阻抗系数是**除数**, 必须 > 0; 阈值必须落在 [0,1].
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp34-personality-modulator-config.spec.ts 覆盖组装与非法值回退
//     3. test/config/wp25-env-example-coverage.spec.ts 断言③c 守住"逐个字面量读 + 内核零 env"

import type { ConfigService } from '@nestjs/config';

import {
  DEFAULT_PERSONALITY_MODULATOR_CONFIG,
  type AgreeablenessModulation,
  type AttachmentModulation,
  type PersonalityModulatorConfig,
} from '../../engine-core/index.js';

/**
 * 解析一个非负系数 (非法 → 回退默认).
 *
 * @param raw env 原值 (未设 / 空串 / 非数字 / 负数 → 回退)
 * @param fallback 默认值 (内核种子值)
 * @returns 有效系数
 */
function resolveNonNegative(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/**
 * 解析一个正系数 (非法 → 回退默认).
 *
 * 阻抗系数是内核里的**除数** (阻抗下降量 ÷ 系数) —— 0 会除出 Infinity,
 * 负数会让阻抗往反方向走, 所以它比 trust 系数更严.
 */
function resolvePositive(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * 解析一个 [0,1] 区间的阈值 (非法 → 回退默认).
 */
function resolveThreshold(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/**
 * 装配单个依恋类型的系数 (两个 env 值 → 一组系数).
 */
function resolveAttachment(
  trustRaw: string | undefined,
  resistRaw: string | undefined,
  fallback: AttachmentModulation,
): AttachmentModulation {
  return {
    trustScale: resolveNonNegative(trustRaw, fallback.trustScale),
    resistanceScale: resolvePositive(resistRaw, fallback.resistanceScale),
  };
}

/**
 * 装配人格调节配置 (4 依恋 × 2 系数 + 宜人性 2 项 = 10 个 env 键).
 *
 * 键名口径: `ENGINE_MOD_<依恋类型>_<TRUST|RESIST>_SCALE`
 *   (依恋类型大写: SECURE / AVOIDANT / ANXIOUS / DISORGANIZED),
 *   宜人性两项: `ENGINE_MOD_AGREEABLENESS_TRUST_SCALE` /
 *   `ENGINE_MOD_AGREEABLENESS_HIGH_THRESHOLD`.
 *
 * ⚠️ 系数是**工程种子值, 非临床标定** —— 待真实对练校准 (任务单 §3.1 的原话).
 *
 * @param config 配置服务 (读 env)
 * @returns 内核的人格调节端口 (缺项 = 内核种子值)
 */
export function resolvePersonalityModulatorConfig(config: ConfigService): PersonalityModulatorConfig {
  const seed = DEFAULT_PERSONALITY_MODULATOR_CONFIG;
  return {
    attachment: {
      secure: resolveAttachment(
        config.get<string>('ENGINE_MOD_SECURE_TRUST_SCALE'),
        config.get<string>('ENGINE_MOD_SECURE_RESIST_SCALE'),
        seed.attachment.secure,
      ),
      avoidant: resolveAttachment(
        config.get<string>('ENGINE_MOD_AVOIDANT_TRUST_SCALE'),
        config.get<string>('ENGINE_MOD_AVOIDANT_RESIST_SCALE'),
        seed.attachment.avoidant,
      ),
      anxious: resolveAttachment(
        config.get<string>('ENGINE_MOD_ANXIOUS_TRUST_SCALE'),
        config.get<string>('ENGINE_MOD_ANXIOUS_RESIST_SCALE'),
        seed.attachment.anxious,
      ),
      disorganized: resolveAttachment(
        config.get<string>('ENGINE_MOD_DISORGANIZED_TRUST_SCALE'),
        config.get<string>('ENGINE_MOD_DISORGANIZED_RESIST_SCALE'),
        seed.attachment.disorganized,
      ),
    },
    agreeableness: resolveAgreeableness(config, seed.agreeableness),
  };
}

/**
 * 装配宜人性调节 (两项 env).
 */
function resolveAgreeableness(config: ConfigService, fallback: AgreeablenessModulation): AgreeablenessModulation {
  return {
    trustScale: resolveNonNegative(config.get<string>('ENGINE_MOD_AGREEABLENESS_TRUST_SCALE'), fallback.trustScale),
    highThreshold: resolveThreshold(config.get<string>('ENGINE_MOD_AGREEABLENESS_HIGH_THRESHOLD'), fallback.highThreshold),
  };
}

#!/usr/bin/env node
// AF-354 · BDI 决策链就绪度只读审计:
//   职责: 把"真实角色种子能不能走到意图规划器的每条策略"从人工 grep 变成一条可重复的审计输出.
//   边界: 只读仓库内种子与配置；不调模型 / 不连 DB / 不连 Redis / 不读任何心理对话原文.
//
//   为什么需要:
//     AF-349/AF-315/AF-322 的单测都用**内核中性四键**（understood / accepted / avoid_pain /
//     control）构造快照，所以全绿也发现不了"真实 8 个角色一个键都对不上"。
//     这条审计按真实种子输出覆盖矩阵与不可达策略，让模型层缺口在工程闸门里可见。
//
//   输出纪律:
//     · JSON 只含角色 id / 愿望键 / 权重 / 布尔 / 计数，不含任何对话或 5Ps 原文；
//     · 结论是**工程可观测结论**，不是临床有效性结论；
//     · 静态不可达判定标注 `basis: "static"` 并给出证据文件，不冒充运行时观测.
//
//   用法:
//     pnpm exec tsx bin/bdi-readiness-audit.ts
//     pnpm exec tsx bin/bdi-readiness-audit.ts --out %TEMP%\af354-bdi-audit
//     pnpm exec tsx bin/bdi-readiness-audit.ts --strict   # 存在阻断项时退出码 1（CI 可用）
//
//   退出码:
//     0 = 审计完成（--strict 时也要求无阻断项）
//     1 = --strict 且存在阻断项
//     2 = 参数 / 读取失败

import type { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveAllianceConfig } from '../src/engine-adapters/wiring/alliance-config.js';
import { resolveBdiRuntimeConfig } from '../src/engine-adapters/wiring/bdi-runtime.config.js';
import { BUILTIN_CHARACTER_SEEDS } from '../src/engine-adapters/wiring/character/builtin-character-registry.js';
import { mapRoleDesiresToCoreDetailed } from '../src/engine-adapters/wiring/character/character-desire-mapping.js';
import { DB_ONLY_CHARACTER_PROFILE_SEED_SPECS } from '../src/engine-adapters/wiring/character/character-profile.db-only.seed.js';
import { CHARACTER_PROFILE_SEED_SPECS } from '../src/engine-adapters/wiring/character/character-profile.seed.js';
import { resolveAllianceThresholds } from '../src/engine-core/cognition/alliance-config.js';
import { DEFAULT_UNDERLYING_DESIRES } from '../src/engine-core/domain/desires.js';

/** 内核意图规划器实际读取的四个底层愿望键（与 intention-planner.ts 的 find 字面量一致）. */
const KERNEL_DESIRE_KEYS = ['understood', 'accepted', 'avoid_pain', 'control'] as const;

/** 审计版本（产物可追溯）. */
const AUDIT_VERSION = 'af357-bdi-readiness-1.1.0';

/** 免责声明：工程审计，不是临床结论. */
const DISCLAIMER = '本审计只回答"真实种子能否触发决策分支"，不代表临床有效性，也不含任何对话原文.';

/** 角色种子最小形状（只读审计需要的字段）. */
interface RoleSeed {
  readonly templateId: string;
  readonly displayName: string;
  readonly underlyingDesires?: readonly { readonly key: string; readonly label: string; readonly baselineWeight: number }[];
}

/** 单角色覆盖行. */
interface RoleCoverage {
  readonly templateId: string;
  readonly displayName: string;
  /** 角色种子里的原始愿望键 (映射前). */
  readonly rawKeys: readonly string[];
  /** 映射后实际进入内核快照的键. */
  readonly mappedKeys: readonly string[];
  /** 未登记映射、原样保留但不驱动内核四键的键. */
  readonly unmappedKeys: readonly string[];
  readonly coveredKeys: readonly string[];
  readonly missingKeys: readonly string[];
  readonly weights: Record<string, number | undefined>;
  readonly mapping: { originalKey: string; coreKey: string | null; effectiveWeight: number }[];
}

/** 策略可达性判定. */
interface StrategyReachability {
  readonly strategy: string;
  readonly reachable: boolean;
  readonly basis: 'static' | 'seed-matrix' | 'runtime-config';
  readonly reason: string;
  readonly evidence: string[];
}

/** --strict 的阻断项（不是所有不可达都阻断：未标定机制默认关闭是正确状态）. */
interface Blocker {
  readonly code: string;
  readonly message: string;
}

/** 取命令行参数值. */
function arg(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

/** 打印错误并退出. */
function fail(message: string): never {
  console.error(`[FAIL] ${message}`);
  process.exit(2);
}

/** 构造只读的 ConfigService 形状（不做 Nest 容器）. */
function buildConfigReader(): ConfigService {
  const reader = {
    get<T = string>(key: string): T | undefined {
      return process.env[key] as T | undefined;
    },
  };
  return reader as unknown as ConfigService;
}

/** 汇总角色覆盖矩阵 (映射前原始键 → 映射后内核键). */
function buildCoverage(roles: readonly RoleSeed[]): RoleCoverage[] {
  return roles.map((role) => {
    const desires = role.underlyingDesires ?? [];
    const mapped = mapRoleDesiresToCoreDetailed(desires);
    const weights: Record<string, number | undefined> = {};
    for (const desire of mapped.desires) weights[desire.key] = desire.baselineWeight;
    const coveredKeys = KERNEL_DESIRE_KEYS.filter((key) => weights[key] !== undefined);
    const missingKeys = KERNEL_DESIRE_KEYS.filter((key) => weights[key] === undefined);
    return {
      templateId: role.templateId,
      displayName: role.displayName,
      rawKeys: desires.map((desire) => desire.key),
      mappedKeys: mapped.desires.map((desire) => desire.key),
      unmappedKeys: mapped.unmapped,
      coveredKeys,
      missingKeys,
      weights,
      mapping: mapped.entries.map((entry) => ({
        originalKey: entry.originalKey,
        coreKey: entry.coreKey,
        effectiveWeight: entry.effectiveWeight,
      })),
    };
  });
}

/**
 * 静态可达性判定.
 *
 * 只把**可证伪的工程事实**写进来：种子键覆盖、机制开关、已知缺失写入点。
 * 不用运行时统计冒充（那是 PoC / 灰度阶段的活）.
 */
function buildReachability(
  coverage: readonly RoleCoverage[],
  runtime: ReturnType<typeof resolveBdiRuntimeConfig>,
  planGate: number,
): StrategyReachability[] {
  const rolesWithControl = coverage.filter((role) => role.weights['control'] !== undefined);
  const rolesWithControlAboveGate = rolesWithControl.filter((role) => (role.weights['control'] ?? 0) >= planGate);
  return [
    {
      strategy: 'recounting',
      reachable: true,
      basis: 'static',
      reason: '默认兜底分支，任何状态都可落在这里',
      evidence: ['src/engine-core/cognition/intention-planner.ts'],
    },
    {
      strategy: 'cognitive_exploration / affective_exploration',
      reachable: true,
      basis: 'runtime-config',
      reason: '同盟门槛 + 深度阻抗 + 时机 + 激活抑制均为快照可判量；是否常触发取决于真实会话',
      evidence: ['src/engine-core/cognition/intention-planner.ts', 'src/engine-core/cognition/alliance-config.ts'],
    },
    {
      strategy: 'resistance / simple_response',
      reachable: true,
      basis: 'static',
      reason: '阻抗与话量是每轮必有的快照字段，保护性分支随时可判',
      evidence: ['src/engine-core/cognition/intention-planner.ts'],
    },
    {
      strategy: 'discussing_plans',
      reachable: rolesWithControlAboveGate.length > 0,
      basis: 'seed-matrix',
      reason:
        rolesWithControlAboveGate.length > 0
          ? `${rolesWithControlAboveGate.length} 个角色映射后的掌控愿望基线 >= ${planGate}，分支可在对应角色上触发`
          : `没有角色映射后的掌控愿望基线 >= ${planGate}：${rolesWithControl.length} 个角色含 control 键，但权重不足；该分支只能靠运行时愿望演化把 control 抬上去`,
      evidence: [
        'src/engine-adapters/wiring/character/character-desire-mapping.ts',
        'src/engine-adapters/wiring/character/character-profile.seed.ts',
        'src/engine-adapters/wiring/character/character-profile.db-only.seed.ts',
        'src/engine-core/cognition/intention-planner.ts',
      ],
    },
    {
      strategy: 'insight',
      reachable: runtime.beliefConfig?.formationEnabled === true,
      basis: 'runtime-config',
      reason:
        runtime.beliefConfig?.formationEnabled === true
          ? '短期信念生成已开启：来访自我觉察陈述会写入 source=observed 信念，连续复述达到 reflectiveBeliefGate 后 insight 分支可判'
          : '短期信念生成缺省关闭：生成算子已实现（来访自我觉察 → observed 信念），但未注入 beliefConfig，当前部署下 temporaryBeliefs 不会新增；开启后 insight 可判',
      evidence: [
        'src/engine-core/cognition/state-transition.ts',
        'src/engine-core/cognition/intention-planner.ts',
        'src/engine-adapters/wiring/bdi-runtime.config.ts',
      ],
    },
    {
      strategy: 'request（情境愿望路径）',
      reachable: runtime.desireEvolutionConfig?.enabled === true,
      basis: 'runtime-config',
      reason:
        runtime.desireEvolutionConfig?.enabled === true
          ? '愿望演化已开启：情境愿望会按事件 / 阻抗 / 安全 / 纽带生成，优先级过阈即触发 request'
          : '愿望演化缺省关闭：situationalDesires 保持为空，情境请求分支不可达',
      evidence: ['src/engine-core/domain/desires.ts', 'src/engine-adapters/wiring/bdi-runtime.config.ts'],
    },
    {
      strategy: 'request（依赖移情路径）',
      reachable: true,
      basis: 'static',
      reason: 'transference.dependency 是快照字段，可由事件 delta 抬升；只要过阈即可触发',
      evidence: ['src/engine-core/cognition/intention-planner.ts', 'src/engine-core/cognition/state-transition.ts'],
    },
  ];
}

/** 渲染 Markdown 摘要. */
function renderMarkdown(report: {
  readonly generatedAt: string;
  readonly coverage: readonly RoleCoverage[];
  readonly reachability: readonly StrategyReachability[];
  readonly mechanisms: Record<string, unknown>;
  readonly blockers: readonly Blocker[];
}): string {
  const lines: string[] = [];
  lines.push(
    '# BDI 决策链就绪度审计',
    '',
    `- 版本：${AUDIT_VERSION}`,
    `- 生成时间：${report.generatedAt}`,
    `- 免责声明：${DISCLAIMER}`,
    '',
    '## 角色 × 内核四键覆盖（AF-357 显式映射后）',
    '',
    '| 角色 | 原始键 → 内核键 | understood | accepted | avoid_pain | control | 未映射键 | 缺失键 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const role of report.coverage) {
    const cell = (key: string): number | string => {
      const value = role.weights[key];
      return value === undefined ? '—' : value.toFixed(2);
    };
    const mapping = role.mapping.map((entry) => `${entry.originalKey}→${entry.coreKey ?? '保留'}`).join(' / ');
    lines.push(
      `| ${role.displayName} (${role.templateId}) | ${mapping === '' ? '—' : mapping} | ${cell('understood')} | ${cell('accepted')} | ${cell('avoid_pain')} | ${cell('control')} | ${
        role.unmappedKeys.length === 0 ? '无' : role.unmappedKeys.join(' / ')
      } | ${role.missingKeys.length === 0 ? '无' : role.missingKeys.join(' / ')} |`,
    );
  }
  lines.push('', '## 机制开关', '');
  for (const [key, value] of Object.entries(report.mechanisms)) {
    lines.push(`- ${key}: ${String(value)}`);
  }
  lines.push('', '## 策略可达性（静态 + 种子矩阵）', '');
  for (const item of report.reachability) {
    lines.push(`- ${item.reachable ? '可判' : '不可达'} · ${item.strategy}（${item.basis}）：${item.reason}`);
  }
  lines.push('', '## 阻断项', '');
  if (report.blockers.length === 0) lines.push('- 无');
  else for (const blocker of report.blockers) lines.push(`- [${blocker.code}] ${blocker.message}`);
  lines.push('');
  return lines.join('\n');
}

/** 主流程. */
function main(): void {
  const argv = process.argv.slice(2);
  const outDir = arg(argv, '--out');
  const strict = argv.includes('--strict');

  const config = buildConfigReader();
  const alliance = resolveAllianceConfig(config);
  const thresholds = resolveAllianceThresholds(alliance);
  const warnings: string[] = [];
  const runtime = resolveBdiRuntimeConfig(config, (message) => warnings.push(message));

  const builtinRoles: readonly RoleSeed[] = BUILTIN_CHARACTER_SEEDS.map((seed) => ({
    templateId: seed.key,
    displayName: seed.displayName,
    underlyingDesires: seed.underlyingDesires,
  }));
  const roles: readonly RoleSeed[] = [...CHARACTER_PROFILE_SEED_SPECS, ...DB_ONLY_CHARACTER_PROFILE_SEED_SPECS, ...builtinRoles];
  if (roles.length === 0) fail('没有读到任何角色种子');

  const coverage = buildCoverage(roles);
  const reachability = buildReachability(coverage, runtime, thresholds.controlPlanGate);

  const mechanisms: Record<string, unknown> = {
    desireEvolutionEnabled: runtime.desireEvolutionConfig?.enabled === true,
    intentionLockEnabled: runtime.intentionLockConfig?.enabled === true,
    intentionLockTtlTurns: runtime.intentionLockConfig?.ttlTurns ?? null,
    timingWeightKind: runtime.timingWeightConfig?.kind ?? 'none',
    beliefFormationEnabled: runtime.beliefConfig?.formationEnabled === true,
    beliefFormationBaseConfidence: runtime.beliefConfig?.formationBaseConfidence ?? null,
    beliefFormationReinforcement: runtime.beliefConfig?.formationReinforcement ?? null,
    beliefFormationMaxPerTurn: runtime.beliefConfig?.formationMaxPerTurn ?? null,
    beliefFormationMinChars: runtime.beliefConfig?.formationMinChars ?? null,
    beliefFormationMaxChars: runtime.beliefConfig?.formationMaxChars ?? null,
    explorationMinTurn: thresholds.explorationMinTurn,
    coreActivationGate: thresholds.coreActivationGate,
    coreActivationSafetyGate: thresholds.coreActivationSafetyGate,
    controlPlanGate: thresholds.controlPlanGate,
    reflectiveBeliefGate: thresholds.reflectiveBeliefGate,
    defaultUnderlyingDesireKeys: DEFAULT_UNDERLYING_DESIRES.map((desire) => desire.key),
  };

  const blockers: Blocker[] = [];
  // 阻断项只收"配置已开启但结构上仍不可能生效"的矛盾，不收"未标定机制默认关闭".
  if (runtime.desireEvolutionConfig?.enabled === true) {
    const hasSituational = reachability.find((item) => item.strategy === 'request（情境愿望路径）');
    if (!hasSituational?.reachable) {
      blockers.push({ code: 'desire-enabled-but-no-situational', message: '愿望演化已开启，但情境请求分支仍不可达' });
    }
  }
  if (runtime.beliefConfig?.formationEnabled === true && runtime.beliefConfig.formationMaxPerTurn === 0) {
    blockers.push({
      code: 'belief-enabled-but-zero-cap',
      message: '短期信念生成已开启，但 formationMaxPerTurn=0 —— 结构上不会生成任何条目',
    });
  }
  for (const role of coverage) {
    if (role.coveredKeys.length === 0) {
      blockers.push({
        code: 'role-no-kernel-key',
        message: `角色 ${role.templateId} 的愿望键与内核四键完全无交集（决策分支只能走默认叙述）`,
      });
    }
  }

  const report = {
    version: AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    configWarnings: warnings,
    mechanisms,
    coverage,
    reachability,
    blockers,
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;

  if (outDir) {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'bdi-readiness-audit.json'), json, 'utf8');
    writeFileSync(join(outDir, 'bdi-readiness-audit.md'), renderMarkdown(report), 'utf8');
    console.log(`[OK] 审计产物已写入 ${outDir}（json + md）`);
  } else {
    console.log(json);
  }

  if (strict && blockers.length > 0) process.exit(1);
}

main();

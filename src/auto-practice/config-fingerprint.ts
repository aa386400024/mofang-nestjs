// V2026-11-11 WP-K (分段配置指纹):
//   职责: 回答"这批数据是在什么引擎配置下跑的"以及"两批之间变了哪几段".
//
//   为什么是**分段**而不是一个大 hash:
//     一个大 hash 只能回答"变了"; 分段能回答"变的是门槛、词表还是基线",
//     这是回归归因的前提.
//
//   为什么全部用**文件级哈希** (与 prompt-fingerprint 同构):
//     系数本体在私有 DELTA_TABLE (未导出), 公开配置只是空覆写; 要拿到数值必须改
//     内核加导出, 而文件级哈希零内核改动. 一致性比理论优雅更重要 —— Git / Docker
//     layer 都是内容哈希.
//
//   已知取舍 (诚实写明):
//     · 同文件内非配置改动 (加注释/改日志) 也会改变该段 —— 保守方向, 宁可多报;
//     · 同文件内的两个常量无法细分 (如 state-transition 里的 deltas 与 cap),
//       看 git diff 定位, 不为此拆内核文件;
//     · .ts 与 .js 口径互不可比, 统一用 dist (见 prompt-fingerprint 注释).
//
//   fail-closed: 任一段读不到 → 该段 'unknown' 且 combined 'unknown',
//     绝不返回半截哈希.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// eslint-disable-next-line unicorn/import-style
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPromptTemplates, PROMPT_VERSION_LENGTH, PROMPT_VERSION_UNKNOWN } from './prompt-fingerprint.js';

/** 指纹段 (除 prompts / combined 外, 每段对应一个真实文件). */
export type ConfigSegment = 'stateTransition' | 'alliance' | 'deltaTableConfig' | 'lexicon' | 'baselines' | 'prompts' | 'acceptance';

/** 段的固定顺序 (combined 与 compare 都按此顺序, 保证确定性). */
export const CONFIG_SEGMENT_ORDER: readonly ConfigSegment[] = [
  'stateTransition',
  'alliance',
  'deltaTableConfig',
  'lexicon',
  'baselines',
  'prompts',
  'acceptance',
];

/**
 * 段 → 文件清单 (相对本模块目录, 无扩展名).
 *
 * 每段挂在真实文件边界上; 一个段可以由多个文件组成 (复用 hashPromptTemplates).
 */
const SEGMENT_FILES: Readonly<Record<Exclude<ConfigSegment, 'prompts'>, readonly string[]>> = {
  // state-transition.ts: DELTA_TABLE + CAP + 算子 (同文件, 不细分).
  stateTransition: ['../engine-core/cognition/state-transition'],
  // alliance-config.ts: 门槛 + 同盟覆写.
  alliance: ['../engine-core/cognition/alliance-config'],
  // delta-table-config.ts: 端口类型 + 默认空覆写.
  deltaTableConfig: ['../engine-core/cognition/delta-table-config'],
  // event-lexicon.ts: 子串命中词表.
  lexicon: ['../engine-core/domain/events/event-lexicon'],
  // character-baseline-calibration.ts: 八维基线 + verbalVoice.
  baselines: ['../engine-adapters/wiring/character/character-baseline-calibration'],
  // acceptance-thresholds.ts: 判据代码化 (D6 建; 未建前该段 fail-closed = unknown).
  acceptance: ['./metrics/acceptance-thresholds'],
};

/** 分段配置指纹. */
export interface ConfigFingerprintSegments {
  readonly stateTransition: string;
  readonly alliance: string;
  readonly deltaTableConfig: string;
  readonly lexicon: string;
  readonly baselines: string;
  readonly prompts: string;
  readonly acceptance: string;
  /** 以上 7 段再哈希; 任一段 unknown 则为 unknown. */
  readonly combined: string;
}

/**
 * 读一个段对应的文件并算哈希 (fail-closed).
 *
 * @param segment 段名
 * @param baseDir 本模块基准目录
 * @param extension 当前进程扩展名
 * @returns 16 位 hex 或 unknown
 */
function hashSegment(segment: Exclude<ConfigSegment, 'prompts'>, baseDir: string, extension: string): string {
  const entries: { path: string; content: string }[] = [];
  for (const relative of SEGMENT_FILES[segment]) {
    const file = resolve(baseDir, join(relative + extension));
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      return PROMPT_VERSION_UNKNOWN;
    }
    entries.push({ path: relative, content });
  }
  if (entries.length === 0) return PROMPT_VERSION_UNKNOWN;
  return hashPromptTemplates(entries);
}

/**
 * 计算分段配置指纹.
 *
 * @param options.promptVersion prompts 段的值 (注入; 缺省由调用方决定)
 * @param options.baseDir / extension 单测用
 * @returns 分段指纹
 */
export function computeConfigFingerprint(options: {
  readonly promptVersion: string;
  readonly baseDir?: string;
  readonly extension?: string;
}): ConfigFingerprintSegments {
  const baseDir = options.baseDir ?? dirname(fileURLToPath(import.meta.url));
  const extension = options.extension ?? extname(fileURLToPath(import.meta.url));

  const partial: Omit<ConfigFingerprintSegments, 'combined'> = {
    stateTransition: hashSegment('stateTransition', baseDir, extension),
    alliance: hashSegment('alliance', baseDir, extension),
    deltaTableConfig: hashSegment('deltaTableConfig', baseDir, extension),
    lexicon: hashSegment('lexicon', baseDir, extension),
    baselines: hashSegment('baselines', baseDir, extension),
    prompts: options.promptVersion,
    acceptance: hashSegment('acceptance', baseDir, extension),
  };

  // fail-closed: 任一段 unknown → combined unknown.
  const anyUnknown = CONFIG_SEGMENT_ORDER.some((segment) => partial[segment] === PROMPT_VERSION_UNKNOWN);
  let combined: string;
  if (anyUnknown) {
    combined = PROMPT_VERSION_UNKNOWN;
  } else {
    const hash = createHash('sha256');
    for (const segment of CONFIG_SEGMENT_ORDER) {
      hash.update(partial[segment]);
      hash.update('\u0000');
    }
    combined = hash.digest('hex').slice(0, PROMPT_VERSION_LENGTH);
  }

  return { ...partial, combined };
}

/** 两批指纹的差异. */
export interface FingerprintComparison {
  /** 发生变化的段. */
  readonly changed: readonly ConfigSegment[];
}

/**
 * 比较两份分段指纹, 返回变了哪几段.
 *
 * @param a 基线
 * @param b 候选
 * @returns 差异
 */
export function compareFingerprints(a: ConfigFingerprintSegments, b: ConfigFingerprintSegments): FingerprintComparison {
  const changed = CONFIG_SEGMENT_ORDER.filter((segment) => a[segment] !== b[segment]);
  return { changed };
}

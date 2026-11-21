// V2026-11-21 建立 (AF-226 · R6-C 线上场景加载): 真人度 CLI 的场景归一化.
//   优先级: 旧记录显式 scene / realismScene > 新记录 encounter > prompt 场景层 > in_person.
//   边界: 纯函数; 不读文件、不依赖 env、不输出台词原文.

import { inferRealismSceneFromPrompt } from '../src/auto-practice/metrics/visitor-realism-baseline.js';
import { REALISM_SCENES, resolveRealismScene, type RealismScene } from '../src/shared/realism/turn-shape-selector.js';

/** debug 记录里可能承载场景的最小字段集. */
export interface DebugSceneSource {
  readonly scene?: unknown;
  readonly realismScene?: unknown;
  readonly encounter?: unknown;
  readonly traces?: readonly { readonly renderSpec?: { readonly promptFull?: string } }[];
}

function asRealismScene(value: unknown): RealismScene | null {
  return typeof value === 'string' && (REALISM_SCENES as readonly string[]).includes(value) ? (value as RealismScene) : null;
}

function asEncounter(value: unknown): { mode?: string; channel?: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const mode = typeof record['mode'] === 'string' ? record['mode'] : undefined;
  const channel = typeof record['channel'] === 'string' ? record['channel'] : undefined;
  if (mode === undefined && channel === undefined) return null;
  return { mode, channel };
}

/**
 * 归一化一场 debug 会话的真人度场景.
 *
 * 老文件只有 traces[0].renderSpec.promptFull，按 prompt 推断；新文件带 encounter，
 * 必须优先采用显式记录 —— 线上批次不能再被 prompt 缺省误判成面对面。
 *
 * @param source debug 记录的场景相关字段
 * @returns 三值场景枚举
 */
export function resolveDebugRealismScene(source: DebugSceneSource): RealismScene {
  const explicit = asRealismScene(source.scene) ?? asRealismScene(source.realismScene);
  if (explicit !== null) return explicit;
  const encounter = asEncounter(source.encounter);
  if (encounter !== null) return resolveRealismScene(encounter);
  return inferRealismSceneFromPrompt(source.traces?.[0]?.renderSpec?.promptFull);
}

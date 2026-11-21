#!/usr/bin/env node
/* eslint-disable unicorn/no-exports-in-scripts -- AF-245: 纯函数需被单测直接导入，主流程已用 isDirectRun 守卫 */
// V2026-11-22 建立 (AF-245 · 来访者影子实验逐 persona 差异审计):
//   职责: 读 scores.json，按 persona × difficulty 聚合 baseline / candidate 的均分与维度均分.
//   边界: 纯读 + stdout；不调用模型、不写库、不生成报告文件.

import { readFileSync } from 'node:fs';

import type { SimScoredSession } from './visitor-sim-analysis.js';
import type { RealismDimension } from '../src/auto-practice/metrics/visitor-realism-blind-pack.js';

const DIMENSIONS: readonly RealismDimension[] = [
  'naturalness',
  'emotional_continuity',
  'turn_shape',
  'scene_congruence',
  'relational_presence',
];

export interface PersonaDeltaRow {
  readonly personaId: string;
  readonly difficulty: string;
  readonly baselineSessions: number;
  readonly candidateSessions: number;
  readonly baselineMean: number;
  readonly candidateMean: number;
  readonly delta: number;
  readonly dimensionDeltas: Readonly<Record<RealismDimension, number>>;
}

export interface PersonaDeltaSummary {
  readonly rows: readonly PersonaDeltaRow[];
  readonly improved: number;
  readonly tied: number;
  readonly regressed: number;
}

function sessionMean(scores: SimScoredSession['scores']): { overall: number; dimensions: Record<RealismDimension, number> } {
  const dimensions = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 0])) as Record<RealismDimension, number>;
  if (scores.length === 0) return { overall: 0, dimensions };
  for (const score of scores) {
    for (const dimension of DIMENSIONS) dimensions[dimension] += score.dimensions[dimension];
  }
  for (const dimension of DIMENSIONS) dimensions[dimension] /= scores.length;
  return { overall: scores.reduce((sum, score) => sum + score.overall, 0) / scores.length, dimensions };
}

function personaIdFromSessionId(sessionId: string, arm: string, difficulty: string): string {
  const prefix = `af232_${arm}_`;
  const suffix = `_${difficulty}`;
  if (sessionId.startsWith(prefix) && sessionId.endsWith(suffix)) {
    return sessionId.slice(prefix.length, sessionId.length - suffix.length);
  }
  return sessionId;
}

interface Bucket {
  readonly personaId: string;
  readonly difficulty: string;
  readonly baseline: number[];
  readonly candidate: number[];
  readonly baselineDimensions: Record<RealismDimension, number[]>;
  readonly candidateDimensions: Record<RealismDimension, number[]>;
}

function emptyDimensions(): Record<RealismDimension, number[]> {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, []])) as Record<RealismDimension, number[]>;
}

/** 按 persona × difficulty 聚合 baseline/candidate，返回按 delta 升序的行（回落最大在前）. */
export function auditPersonaDeltas(sessions: readonly SimScoredSession[], baselineArm: string, candidateArm: string): PersonaDeltaSummary {
  const buckets = new Map<string, Bucket>();
  for (const session of sessions) {
    if (session.arm !== baselineArm && session.arm !== candidateArm) continue;
    const personaId = personaIdFromSessionId(session.sessionId, session.arm, session.difficulty);
    const key = `${personaId}|${session.difficulty}`;
    const bucket =
      buckets.get(key) ??
      ({
        personaId,
        difficulty: session.difficulty,
        baseline: [],
        candidate: [],
        baselineDimensions: emptyDimensions(),
        candidateDimensions: emptyDimensions(),
      } satisfies Bucket);
    buckets.set(key, bucket);
    const { overall, dimensions } = sessionMean(session.scores);
    if (session.arm === baselineArm) {
      bucket.baseline.push(overall);
      for (const dimension of DIMENSIONS) bucket.baselineDimensions[dimension].push(dimensions[dimension]);
    } else {
      bucket.candidate.push(overall);
      for (const dimension of DIMENSIONS) bucket.candidateDimensions[dimension].push(dimensions[dimension]);
    }
  }

  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

  const rows: PersonaDeltaRow[] = [...buckets.values()].map((bucket) => {
    const baselineMean = mean(bucket.baseline);
    const candidateMean = mean(bucket.candidate);
    return {
      personaId: bucket.personaId,
      difficulty: bucket.difficulty,
      baselineSessions: bucket.baseline.length,
      candidateSessions: bucket.candidate.length,
      baselineMean,
      candidateMean,
      delta: candidateMean - baselineMean,
      dimensionDeltas: Object.fromEntries(
        DIMENSIONS.map((dimension) => [
          dimension,
          mean(bucket.candidateDimensions[dimension]) - mean(bucket.baselineDimensions[dimension]),
        ]),
      ) as Record<RealismDimension, number>,
    };
  });

  rows.sort((left, right) => left.delta - right.delta || left.personaId.localeCompare(right.personaId));
  const improved = rows.filter((row) => row.delta > 0.05).length;
  const regressed = rows.filter((row) => row.delta < -0.05).length;
  return { rows, improved, tied: rows.length - improved - regressed, regressed };
}

function formatNumber(value: number, digits = 3): string {
  return value.toFixed(digits);
}

function printMarkdown(summary: PersonaDeltaSummary, baselineArm: string, candidateArm: string): void {
  console.log(`# ${baselineArm} vs ${candidateArm} 逐 persona 差异\n`);
  console.log(`- 改善：${summary.improved}；持平：${summary.tied}；回落：${summary.regressed}\n`);
  const header = `| persona | 难度 | ${baselineArm} | ${candidateArm} | delta | 自然度 | 情绪连续 | 话轮形态 | 场景一致 | 关系在场 |`;
  console.log(header);
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of summary.rows) {
    const dims = DIMENSIONS.map((dimension) => formatNumber(row.dimensionDeltas[dimension])).join(' | ');
    console.log(
      `| ${row.personaId} | ${row.difficulty} | ${formatNumber(row.baselineMean)} | ${formatNumber(row.candidateMean)} | ${formatNumber(row.delta)} | ${dims} |`,
    );
  }
}

interface CliOptions {
  readonly files: readonly string[];
  readonly baselineArm: string;
  readonly candidateArm: string;
}

function parseCli(argv: readonly string[]): CliOptions {
  const files: string[] = [];
  let baselineArm = 'E';
  let candidateArm = 'H';
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index] ?? '';
    switch (value) {
      case '--files': {
        const next = argv[index + 1] ?? '';
        if (next.length === 0) throw new Error('--files 需要逗号分隔的 scores.json 路径');
        files.push(...next.split(',').filter(Boolean));
        index += 1;
        break;
      }
      case '--baseline': {
        baselineArm = argv[index + 1] ?? baselineArm;
        index += 1;
        break;
      }
      case '--candidate': {
        candidateArm = argv[index + 1] ?? candidateArm;
        index += 1;
        break;
      }
      default: {
        if (!value.startsWith('--')) files.push(value);
      }
    }
  }
  if (files.length === 0) {
    throw new Error('用法: tsx bin/visitor-sim-persona-delta.ts --files a.json,b.json [--baseline E] [--candidate H]');
  }
  return { files, baselineArm, candidateArm };
}

function main(): void {
  const options = parseCli(process.argv.slice(2));
  const sessions = options.files.flatMap((file) => {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: readonly SimScoredSession[] };
    if (!Array.isArray(parsed.sessions)) throw new Error(`${file} 缺少 sessions 数组`);
    return parsed.sessions;
  });
  printMarkdown(auditPersonaDeltas(sessions, options.baselineArm, options.candidateArm), options.baselineArm, options.candidateArm);
}

if (process.argv[1]?.endsWith('visitor-sim-persona-delta.ts') === true) main();

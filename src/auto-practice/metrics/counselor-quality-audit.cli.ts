#!/usr/bin/env node
// AF-095 · 咨询师质量审计 CLI（真人锚点校准 + 真实逐字稿审计）:
//   职责: 读 turns.jsonl 做校准, 读 debug-session JSON 做场次级审计, 输出**无原文**证据.
//   边界: 只读文件 + 写一个 JSON; 不调 LLM / 不连 DB / 不改仓库状态.
//
//   用法:
//     corepack pnpm exec tsx src/auto-practice/metrics/counselor-quality-audit.cli.ts \
//       --turns docs/reference/psych-dataset/dataset/turns.jsonl \
//       --transcripts data/debug-sessions \
//       --out docs/worklog/completed/phase2.5/af095-counselor-quality-evidence-2026-11-18.json
//     # 只审计指定长会话（逗号分隔 sessionId）
//       [--only <sessionId1,sessionId2>]
//
//   ⚠️ 输出纪律: 只落 sessionId / 轮数 / 比率 / 旗标 / 校准数字; 不落任何台词.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  auditCounselorSession,
  calibrateCounselorQuality,
  type CounselorQualityLabel,
  type CounselorSessionAudit,
  type CounselorTurnInput,
} from './counselor-quality.js';

interface CliOptions {
  turns: string;
  transcripts: string;
  out: string;
  /** 只审计这些 sessionId（逗号分隔）；空数组 = 目录内全部. */
  only: string[];
}

interface TranscriptMessage {
  readonly role?: string;
  readonly text?: string;
  readonly turnIndex?: number;
}

interface TranscriptFile {
  readonly id?: string;
  readonly messages?: readonly TranscriptMessage[];
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    turns: 'docs/reference/psych-dataset/dataset/turns.jsonl',
    transcripts: 'data/debug-sessions',
    out: 'docs/worklog/completed/phase2.5/af095-counselor-quality-evidence-2026-11-18.json',
    only: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--turns' && value) {
      options.turns = value;
      index += 1;
    } else if (key === '--transcripts' && value) {
      options.transcripts = value;
      index += 1;
    } else if (key === '--out' && value) {
      options.out = value;
      index += 1;
    } else if (key === '--only' && value) {
      options.only = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
      index += 1;
    }
  }
  return options;
}

function asQuality(value: unknown): CounselorQualityLabel | undefined {
  return value === 'gold' || value === 'normal' || value === 'borderline' || value === 'bad' ? value : undefined;
}

function readCalibrationTurns(file: string): CounselorTurnInput[] {
  if (!existsSync(file)) throw new Error(`找不到校准文件: ${file}`);
  return readFileSync(file, 'utf8')
    .trim()
    .split(/\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const record = JSON.parse(line) as {
        turn_index?: unknown;
        counselor?: unknown;
        visitor?: unknown;
        quality?: unknown;
        events?: unknown;
      };
      return {
        turnIndex: typeof record.turn_index === 'number' ? record.turn_index : 0,
        counselor: typeof record.counselor === 'string' ? record.counselor : '',
        visitor: typeof record.visitor === 'string' ? record.visitor : '',
        quality: asQuality(record.quality),
        events: Array.isArray(record.events) ? record.events.filter((event): event is string => typeof event === 'string') : [],
      };
    });
}

/**
 * 从 debug 逐字稿里取**可见台词**：去掉模型推理块 `<think>...</think>`。
 *
 * 为什么要在 CLI 层做：debug 管道保存的是上游原始内容（含推理块），
 * 但质量审计的对象是"来访者/咨询师真正说出口的话"，不是模型内部推理。
 * 该清洗只影响审计输入，不改原文文件。
 *
 * @param text 原始文本
 * @returns 可见台词
 */
function visibleUtterance(text: string): string {
  return text.replaceAll(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function transcriptTurns(file: string): CounselorTurnInput[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as TranscriptFile;
  const byTurn = new Map<number, { counselor: string; visitor: string }>();
  let fallback = 0;
  for (const message of raw.messages ?? []) {
    fallback += 1;
    const turnIndex = typeof message.turnIndex === 'number' && Number.isFinite(message.turnIndex) ? message.turnIndex : fallback;
    const text = visibleUtterance(typeof message.text === 'string' ? message.text : '');
    const current = byTurn.get(turnIndex) ?? { counselor: '', visitor: '' };
    if (message.role === 'counselor') current.counselor = text;
    else if (message.role === 'visitor') current.visitor = text;
    byTurn.set(turnIndex, current);
  }
  return [...byTurn.entries()]
    .filter(([, turn]) => turn.counselor !== '' || turn.visitor !== '')
    .map(([turnIndex, turn]) => ({ turnIndex, counselor: turn.counselor, visitor: turn.visitor }));
}

function readTranscriptAudits(dir: string, only: readonly string[]): CounselorSessionAudit[] {
  if (!existsSync(dir)) throw new Error(`找不到逐字稿目录: ${dir}`);
  const allow = new Set(only);
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .toSorted((left, right) => left.localeCompare(right));
  return files
    .map((name) => {
      const file = path.join(dir, name);
      const raw = JSON.parse(readFileSync(file, 'utf8')) as TranscriptFile;
      const sessionId = raw.id ?? name.replace(/\.json$/, '');
      return { file, sessionId, raw };
    })
    .filter((entry) => allow.size === 0 || allow.has(entry.sessionId))
    .map((entry) => auditCounselorSession(entry.sessionId, transcriptTurns(entry.file)));
}

function main(argv: readonly string[]): number {
  const options = parseArgs(argv);
  const calibration = calibrateCounselorQuality(readCalibrationTurns(options.turns));
  const sessions = readTranscriptAudits(options.transcripts, options.only);
  const flagCounts: Record<string, number> = {};
  for (const session of sessions) {
    for (const flag of session.flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  }
  const evidence = {
    generatedAt: new Date().toISOString(),
    scope: 'counselor-behavior-triage-only; not six-dim clinical acceptance',
    calibration,
    sessions,
    aggregate: {
      sessions: sessions.length,
      turns: sessions.reduce((sum, session) => sum + session.turns, 0),
      riskDisclosures: sessions.reduce((sum, session) => sum + session.riskDisclosures, 0),
      riskCovered: sessions.reduce((sum, session) => sum + session.riskCovered, 0),
      flags: flagCounts,
    },
  };
  mkdirSync(path.dirname(options.out), { recursive: true });
  writeFileSync(options.out, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(
    [
      `校准轮次: ${calibration.labeledTurns}/${calibration.totalTurns} (阳性 ${calibration.positiveTurns})`,
      ...calibration.signals.map(
        (signal) =>
          `  ${signal.signal}: AUC=${signal.auc.toFixed(3)} P=${signal.precision.toFixed(3)} R=${signal.recall.toFixed(3)} (tp=${signal.tp} fp=${signal.fp} fn=${signal.fn} tn=${signal.tn})`,
      ),
      `真实逐字稿: ${sessions.length} 场 / ${evidence.aggregate.turns} 轮；风险披露 ${evidence.aggregate.riskDisclosures} / 覆盖 ${evidence.aggregate.riskCovered}`,
      `旗标: ${JSON.stringify(flagCounts)}`,
      `证据已写入: ${options.out}`,
    ].join('\n') + '\n',
  );
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith('counselor-quality-audit.cli.ts');
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[counselor-quality-audit] 失败: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

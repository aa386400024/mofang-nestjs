// V2026-11-21 建立 (AF-211 · R4 批次基线 CLI):
//   扫描 data/debug-sessions，产出只含数字的真人度基线报告。
//   不输出、不保存任何台词原文；报告默认落在 gitignore 覆盖的 data/ 下。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  aggregateRealismBaseline,
  inferRealismSceneFromPrompt,
  type BaselineSession,
} from '../src/auto-practice/metrics/visitor-realism-baseline.js';

interface DebugMessage {
  readonly role?: string;
  readonly text?: string;
}

interface DebugTrace {
  readonly renderSpec?: {
    readonly promptFull?: string;
  };
}

interface DebugSessionFile {
  readonly id?: string;
  readonly messages?: readonly DebugMessage[];
  readonly traces?: readonly DebugTrace[];
}

interface CliOptions {
  readonly dir: string;
  readonly out: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let dir = resolve(process.cwd(), 'data/debug-sessions');
  let out = resolve(process.cwd(), 'data/phase25-exit/af211-realism-baseline/report.json');

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--dir' && next) {
      dir = resolve(process.cwd(), next);
      index += 1;
    } else if (arg === '--out' && next) {
      out = resolve(process.cwd(), next);
      index += 1;
    }
  }

  return { dir, out };
}

function readSession(filePath: string): BaselineSession | null {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as DebugSessionFile;
  const messages = raw.messages ?? [];
  const visitorTurns = messages
    .filter((message) => message.role === 'visitor' && typeof message.text === 'string')
    .map((message) => message.text!)
    .filter((text) => text.trim().length > 0);

  if (visitorTurns.length === 0) return null;

  return {
    sessionId: raw.id ?? filePath,
    scene: inferRealismSceneFromPrompt(raw.traces?.[0]?.renderSpec?.promptFull),
    visitorTurns,
  };
}

function main(): void {
  const { dir, out } = parseArgs(process.argv.slice(2));
  const files = readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.json'));

  const sessions: BaselineSession[] = [];
  let skipped = 0;
  for (const name of files) {
    try {
      const session = readSession(resolve(dir, name));
      if (session) sessions.push(session);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }

  const baseline = aggregateRealismBaseline(sessions);
  const report = {
    schema: 'visitor-realism-baseline/1',
    generatedAt: new Date().toISOString(),
    source: {
      directory: dir,
      files: files.length,
      sessions: sessions.length,
      skippedFiles: skipped,
      sceneInference: 'prompt_scene_layer_else_in_person',
    },
    ...baseline,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `${JSON.stringify({
      out,
      sessions: report.sessions,
      turns: report.turns,
      hardViolations: report.hardViolations,
      hardRatePer100Turns: report.hardRatePer100Turns,
      rawHardViolations: report.rawAudit.hardViolations,
      invalidOutputTurns: report.outputIntegrity.invalidTurns,
      tooLongTurns: report.tooLongTurns,
      tooLongRatePer100Turns: report.tooLongRatePer100Turns,
      totalEvents: report.totalEvents,
      eventsPerTurn: report.eventsPerTurn,
    })}\n`,
  );
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main();
}

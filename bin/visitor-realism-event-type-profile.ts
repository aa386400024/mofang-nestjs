/**
 * AF-338 · 真人度事件类型归因 CLI
 *
 * 读取同一目录下多份 rep JSON (每份 reps=1), 按 persona × arm 汇总六类事件计数,
 * 输出每轮频次、类型占比与 repair 频次. 只读数字, 不调用模型, 不写库.
 *
 * 用法:
 *   pnpm exec tsx bin/visitor-realism-event-type-profile.ts --dir data/.../reps --out data/.../profile.json
 *   pnpm exec tsx bin/visitor-realism-event-type-profile.ts --dir ... --arms "off,full,minimal" --personas "anxious,guarded"
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { aggregateEventTypeProfiles, dominantEventType, EVENT_TYPE_IDS } from '../src/shared/realism/realism-event-type-profile.js';
import type { EventTypeCounts, EventTypeProfile, EventTypeSample } from '../src/shared/realism/realism-event-type-profile.js';

interface CellLike {
  readonly persona?: unknown;
  readonly arm?: unknown;
  readonly completedTurns?: unknown;
  readonly meanTypeCounts?: unknown;
}

interface RepLike {
  readonly reps?: unknown;
  readonly cells?: unknown;
}

interface Options {
  readonly dir: string;
  readonly out: string | null;
  readonly personas: readonly string[];
  readonly arms: readonly string[];
  readonly json: boolean;
}

function arg(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return null;
  const value = argv[index + 1];
  return value.startsWith('--') ? null : value;
}

function listArg(argv: readonly string[], name: string, fallback: readonly string[]): string[] {
  const raw = arg(argv, name);
  if (!raw) return [...fallback];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseOptions(argv: readonly string[]): Options {
  const dir = arg(argv, '--dir');
  if (!dir) throw new Error('缺少 --dir（rep JSON 所在目录）');
  return {
    dir: resolve(process.cwd(), dir),
    out: arg(argv, '--out') ? resolve(process.cwd(), arg(argv, '--out')!) : null,
    personas: listArg(argv, '--personas', ['anxious', 'guarded']),
    arms: listArg(argv, '--arms', ['off', 'full', 'minimal', 'tightened']),
    json: argv.includes('--json'),
  };
}

function isCounts(value: unknown): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadSamples(options: Options): EventTypeSample[] {
  const files = readdirSync(options.dir).filter((name) => name.toLowerCase().endsWith('.json'));
  const samples: EventTypeSample[] = [];
  for (const file of files) {
    const rep = JSON.parse(readFileSync(join(options.dir, file), 'utf8')) as RepLike;
    if (rep.reps !== 1) {
      throw new Error(`${file}: reps=${String(rep.reps)}，本 CLI 只接受 reps=1 的单次重复，避免把均值当总数`);
    }
    if (!Array.isArray(rep.cells)) throw new Error(`${file}: 缺少 cells 数组`);
    for (const cell of rep.cells as CellLike[]) {
      const persona = typeof cell.persona === 'string' ? cell.persona : '';
      const arm = typeof cell.arm === 'string' ? cell.arm : '';
      if (!options.personas.includes(persona) || !options.arms.includes(arm)) continue;
      if (!isCounts(cell.meanTypeCounts)) continue;
      const source = cell.meanTypeCounts;
      const counts = Object.fromEntries(
        EVENT_TYPE_IDS.map((id) => [id, typeof source[id] === 'number' ? source[id] : 0]),
      ) as EventTypeCounts;
      samples.push({
        persona,
        arm,
        turns: typeof cell.completedTurns === 'number' ? cell.completedTurns : 0,
        counts,
      });
    }
  }
  return samples;
}

function printHuman(profiles: readonly EventTypeProfile[]): void {
  console.log('真人度事件类型剖面（每轮频次 / 类型占比）');
  for (const profile of profiles) {
    const dominant = dominantEventType(profile);
    console.log(
      `\n${profile.persona} / ${profile.arm} | 轮次 ${profile.turns} | 事件 ${profile.totalEvents} | ` +
        `每轮 ${profile.eventsPerTurn?.toFixed(4) ?? 'n/a'} | 主类型 ${dominant ? `${dominant.id} ${dominant.perTurn.toFixed(4)}` : 'n/a'}`,
    );
    console.log('type        count  perTurn  share');
    for (const id of EVENT_TYPE_IDS) {
      const item = profile.byType[id];
      console.log(
        `${id.padEnd(11)} ${String(item.count).padStart(5)}  ${(item.perTurn?.toFixed(6) ?? 'n/a').padStart(7)}  ` +
          `${(item.share === null ? 'n/a' : `${(item.share * 100).toFixed(1)}%`).padStart(6)}`,
      );
    }
  }
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const profiles = aggregateEventTypeProfiles(loadSamples(options));
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify({ dir: options.dir, profiles }, null, 2)}\n`, 'utf8');
  }
  if (options.json) console.log(JSON.stringify({ dir: options.dir, profiles }, null, 2));
  else printHuman(profiles);
}

main();

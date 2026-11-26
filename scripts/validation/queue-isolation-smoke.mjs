#!/usr/bin/env node
/**
 * AF-527 · 真实双实例 BullMQ 队列隔离 smoke。
 *
 * 同一个 Redis DB 上启动两个独立 Worker 进程，各自使用不同 BULLMQ_PREFIX；
 * 生产者分别向两个前缀入队，断言 A 只消费 A、B 只消费 B，且 key 命名空间不交叉。
 * 仅使用 smoke 专用队列 af527-smoke，结束后 obliterate，不触碰业务队列。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { resolveBullPrefix } from '../../dist/shared/infra/queue/bullmq-prefix.js';

const QUEUE_NAME = 'af527-smoke';
const DEFAULT_EXPECTED = 2;
const TIMEOUT_MS = 30_000;

function redisOptions() {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }
  return {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB ?? 5),
  };
}

function redisConnection() {
  const options = redisOptions();
  if (options.url) {
    return new IORedis(options.url, { maxRetriesPerRequest: null });
  }
  return new IORedis({ ...options, maxRetriesPerRequest: null });
}

function redisSummary() {
  const options = redisOptions();
  if (options.url) {
    return { mode: 'url', db: 'from-url' };
  }
  return { host: options.host, port: options.port, db: options.db };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorker(prefix, outFile, expected) {
  const connection = redisConnection();
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const line = JSON.stringify({ id: job.data.id, prefix });
      appendFileSync(outFile, `${line}\n`, 'utf8');
      return { ok: true };
    },
    { prefix, connection, concurrency: 1 },
  );

  let completed = 0;
  let finished = false;
  const finish = async (code, message) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    await worker.close();
    await connection.quit();
    if (message) console.error(message);
    process.exit(code);
  };
  const timer = setTimeout(() => finish(1, `worker timeout: ${prefix}`), TIMEOUT_MS).unref();

  worker.on('completed', async () => {
    completed += 1;
    if (completed >= expected) await finish(0);
  });
  worker.on('error', async (error) => finish(1, `worker error: ${error.message}`));

  await worker.waitUntilReady();
  console.log(`READY ${prefix}`);
}

async function main() {
  const runId = Date.now().toString(36);
  const prefixA = process.env.SMOKE_PREFIX_A ?? 'af527-smoke-a';
  const prefixB = process.env.SMOKE_PREFIX_B ?? 'af527-smoke-b';
  const expected = Number(process.env.SMOKE_EXPECTED ?? DEFAULT_EXPECTED);
  const tempDir = mkdtempSync(join(tmpdir(), 'af527-smoke-'));
  const outA = join(tempDir, 'a.jsonl');
  const outB = join(tempDir, 'b.jsonl');
  const script = fileURLToPath(import.meta.url);

  const spawnWorker = (prefix, outFile) =>
    spawn(process.execPath, [script, '--worker'], {
      env: { ...process.env, BULLMQ_PREFIX: prefix, SMOKE_OUT: outFile, SMOKE_EXPECTED: String(expected) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  const childA = spawnWorker(prefixA, outA);
  const childB = spawnWorker(prefixB, outB);
  const logs = { a: '', b: '' };
  childA.stdout.on('data', (chunk) => (logs.a += chunk.toString()));
  childB.stdout.on('data', (chunk) => (logs.b += chunk.toString()));
  childA.stderr.on('data', (chunk) => (logs.a += chunk.toString()));
  childB.stderr.on('data', (chunk) => (logs.b += chunk.toString()));

  const waitReady = async (child, label) => {
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      const text = logs[label];
      if (text.includes('READY ')) return;
      if (child.exitCode !== null) throw new Error(`worker ${label} exited early: ${text}`);
      await sleep(100);
    }
    throw new Error(`worker ${label} not ready: ${logs[label]}`);
  };

  let queueA;
  let queueB;
  let probe;
  try {
    await Promise.all([waitReady(childA, 'a'), waitReady(childB, 'b')]);
    queueA = new Queue(QUEUE_NAME, { prefix: resolveBullPrefix({ ...process.env, BULLMQ_PREFIX: prefixA }), connection: redisConnection() });
    queueB = new Queue(QUEUE_NAME, { prefix: resolveBullPrefix({ ...process.env, BULLMQ_PREFIX: prefixB }), connection: redisConnection() });

    for (const id of ['A1', 'A2']) {
      await queueA.add('smoke', { id, runId }, { jobId: `${id}-${runId}`, removeOnComplete: true, removeOnFail: true });
    }
    for (const id of ['B1', 'B2']) {
      await queueB.add('smoke', { id, runId }, { jobId: `${id}-${runId}`, removeOnComplete: true, removeOnFail: true });
    }

    const waitExit = async (child, label) => {
      const started = Date.now();
      while (Date.now() - started < TIMEOUT_MS) {
        if (child.exitCode !== null) return child.exitCode;
        await sleep(100);
      }
      throw new Error(`worker ${label} did not exit: ${logs[label]}`);
    };
    const [codeA, codeB] = await Promise.all([waitExit(childA, 'a'), waitExit(childB, 'b')]);
    if (codeA !== 0 || codeB !== 0) throw new Error(`worker exit code A=${codeA} B=${codeB}`);

    const readIds = (file) => {
      if (!existsSync(file)) return [];
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line).id);
    };
    const consumedA = readIds(outA);
    const consumedB = readIds(outB);
    const expectedA = ['A1', 'A2'];
    const expectedB = ['B1', 'B2'];
    const sameSet = (actual, expected) => actual.length === expected.length && actual.every((id) => expected.includes(id));
    if (!sameSet(consumedA, expectedA)) throw new Error(`A consumed ${JSON.stringify(consumedA)}`);
    if (!sameSet(consumedB, expectedB)) throw new Error(`B consumed ${JSON.stringify(consumedB)}`);
    if (consumedA.some((id) => id.startsWith('B')) || consumedB.some((id) => id.startsWith('A'))) {
      throw new Error('cross-prefix consumption detected');
    }

    probe = redisConnection();
    const keysA = await probe.keys(`${prefixA}:*`);
    const keysB = await probe.keys(`${prefixB}:*`);
    if (!keysA.every((key) => key.startsWith(`${prefixA}:`))) throw new Error('A key namespace contaminated');
    if (!keysB.every((key) => key.startsWith(`${prefixB}:`))) throw new Error('B key namespace contaminated');
    if (keysA.some((key) => key.startsWith(`${prefixB}:`)) || keysB.some((key) => key.startsWith(`${prefixA}:`))) {
      throw new Error('cross-prefix key detected');
    }

    const result = {
      ok: true,
      runId,
      queue: QUEUE_NAME,
      prefixes: { a: prefixA, b: prefixB },
      consumed: { a: consumedA, b: consumedB },
      keyCounts: { a: keysA.length, b: keysB.length },
      redis: redisSummary(),
      workers: { a: childA.pid, b: childB.pid },
      checkedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(result, null, 2));
  } finally {
    childA.kill();
    childB.kill();
    if (probe) await probe.quit().catch(() => {});
    for (const queue of [queueA, queueB]) {
      if (!queue) continue;
      await queue.obliterate({ force: true }).catch(() => {});
      await queue.close().catch(() => {});
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv.includes('--worker')) {
  const prefix = resolveBullPrefix();
  const outFile = process.env.SMOKE_OUT;
  const expected = Number(process.env.SMOKE_EXPECTED ?? DEFAULT_EXPECTED);
  if (!outFile) throw new Error('SMOKE_OUT is required');
  await runWorker(prefix, outFile, expected);
} else {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(`[af527-smoke] FAIL: ${error.message}`);
    process.exit(1);
  }
}

// V2026-11-10 治本 (Phase2.5 WP-H 第二/三波 + 批次可观测性 · 单测):
//   覆盖本单的六件事:
//     ① 改动 6 —— 批次级指标聚合 (render_fallback_turns / llm_call_turns / 兜底率);
//     ② 改动 8 —— engine_version 走 git describe --always --dirty (dirty 可见 / 无 git 回落);
//     ③ 改动 9 —— 批次有效性门禁 (三条合格线; 任一不过 → valid=false + warning);
//     ④ 新增 10 —— DB_QUERY_LOGGING 开关 (缺省关 query; error/warn 永远保留);
//     ⑤ 新增 11 —— WS 空房间短路 (不 emit / 同场次只打一条 debug / 有订阅照常送达);
//     ⑥ 新增 12 —— 逐字稿批次索引 (字段与 DB 一致; 零对话文本).
//
//   全 mock / 纯函数: 不起 NestJS 容器, 不连 Redis/MySQL, 不发网络.
//   临时目录只用来放索引文件 (os.tmpdir 下 mkdtemp, 用完即删).
//
//   验证: npx vitest run test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts
//   时间戳: 2026-11-10 GMT+8

import { Logger } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoPracticeGateway } from '../../src/auto-practice/auto-practice.gateway.js';
import { PracticeBatch } from '../../src/auto-practice/entities/practice-batch.entity.js';
import { PracticeSession } from '../../src/auto-practice/entities/practice-session.entity.js';
import { ENGINE_VERSION_UNKNOWN, gitDescribeDirty, resolveEngineVersion } from '../../src/auto-practice/inference-fingerprint.service.js';
import {
  BATCH_HEALTH_FALLBACK_RATIO_MAX,
  BATCH_HEALTH_LLM_CALL_RATIO_MIN,
  BATCH_INVALID_WARNING,
  BATCH_VALIDITY_FLAGS,
  type BatchSessionMetrics,
  PracticeBatchHealthService,
  computeBatchMetrics,
  evaluateBatchHealth,
  sanitizeFileKey,
  toBatchSessionMetrics,
} from '../../src/auto-practice/practice-batch-health.service.js';
import { ALWAYS_ON_DB_LOG_LEVELS, resolveDbLoggingLevels, resolveDbQueryLogging } from '../../src/config/envs/db-logging.js';
import { DEFAULT_GIT_BINARY, probeGit, probeGitBinary } from '../helpers/index.js';

/** 造一行场次 (只填本单关心的字段). */
function makeSession(overrides: Partial<PracticeSession> = {}): PracticeSession {
  const row = new PracticeSession();
  row.id = 'sess-1';
  row.debugSessionId = 'dbg-1';
  row.characterSlug = 'secure';
  row.counselorModeId = 'expert';
  row.status = 'completed';
  row.turnCount = 10;
  row.degradedTurns = 0;
  row.counselorDegradedTurns = 0;
  row.visitorDegradedTurns = 0;
  row.renderFallbackTurns = 0;
  row.llmCallTurns = 10;
  row.renderFallbackRatio = 0;
  row.exitReason = 'max_turns';
  row.engineVersion = 'f59c307-dirty';
  return Object.assign(row, overrides);
}

/** 造一条批次视角指标. */
function makeMetrics(overrides: Partial<BatchSessionMetrics> = {}): BatchSessionMetrics {
  return {
    id: 'sess-1',
    debugSessionId: 'dbg-1',
    characterSlug: 'secure',
    counselorModeId: 'expert',
    status: 'completed',
    turnCount: 10,
    degradedTurns: 0,
    counselorDegradedTurns: 0,
    visitorDegradedTurns: 0,
    renderFallbackTurns: 0,
    llmCallTurns: 10,
    renderFallbackRatio: 0,
    exitReason: 'max_turns',
    engineVersion: 'f59c307-dirty',
    ...overrides,
  } as BatchSessionMetrics;
}

// V2026-11-13 (TD-9 · T-4): git 环境前置.
//   取证会话的 PATH 不继承系统 PATH (本机 git 在 D:\Apps\Git\cmd) 时, 直接跑 git 会报
//   spawnSync git ENOENT —— 那是**环境缺陷**, 不是回归, 不能记成测试失败.
//   口径:
//     ① 本文件的三处直接调用走**解析后**的可执行文件 (GIT_BIN 注入优先, 否则 PATH 的 'git');
//     ② src 侧 gitDescribeDirty() 硬编码走 PATH 的 'git' (本单不改 src 语义),
//        所以跳过条件取**两者同时可用** —— 否则那条断言测的是 unknown 回落, 不是 dirty 语义.
const gitProbe = probeGit();
const gitOnPath = probeGitBinary(DEFAULT_GIT_BINARY);
const gitUsable = gitProbe.available && gitOnPath;
const gitBinary = gitProbe.binary ?? DEFAULT_GIT_BINARY;

/** 假 repo: 批次场次表 + 批次结论表. */
function stubRepos(sessions: readonly PracticeSession[]) {
  const sessionRepo = {
    find: vi.fn(async ({ where }: { where: { batchId?: string; id?: string } }) =>
      sessions.filter((row) => {
        if (where.batchId !== undefined) return row.batchId === where.batchId;
        if (where.id !== undefined) return row.id === where.id;
        return true;
      }),
    ),
    findOne: vi.fn(async ({ where }: { where: { id: string } }) => sessions.find((row) => row.id === where.id) ?? null),
  };
  const saved: PracticeBatch[] = [];
  const batchRepo = {
    findOne: vi.fn(async ({ where }: { where: { batchId: string } }) => saved.find((row) => row.batchId === where.batchId) ?? null),
    save: vi.fn(async (row: PracticeBatch) => {
      const index = saved.findIndex((item) => item.batchId === row.batchId);
      if (index === -1) {
        saved.push(row);
      } else {
        saved[index] = row;
      }
      return row;
    }),
  };
  return { sessionRepo, batchRepo, saved };
}

/** 假配置服务 (只回 env 字典). */
function stubConfig(env: Record<string, string>): { get: <T>(key: string) => T | undefined } {
  return {
    get<T>(key: string): T | undefined {
      return env[key] as T | undefined;
    },
  };
}

describe('WP-H 第二/三波 · 批次可观测性', () => {
  describe('① 改动 6 · 批次级指标聚合', () => {
    it('三项指标按批次汇总 (兜底轮数 / 调用轮数 / 兜底率)', () => {
      const metrics = computeBatchMetrics([
        makeMetrics({ id: 'a', turnCount: 10, renderFallbackTurns: 1, llmCallTurns: 9, renderFallbackRatio: 0.1 }),
        makeMetrics({ id: 'b', turnCount: 20, renderFallbackTurns: 1, llmCallTurns: 19, renderFallbackRatio: 0.05 }),
      ]);

      expect(metrics.totalSessions).toBe(2);
      expect(metrics.totalTurns).toBe(30);
      expect(metrics.renderFallbackTurns).toBe(2);
      expect(metrics.llmCallTurns).toBe(28);
      // 均值口径 (改动 9 原文): (0.1 + 0.05) / 2
      expect(metrics.renderFallbackRatio).toBeCloseTo(0.075, 10);
      // 加权口径: 合计兜底轮 / 合计轮数
      expect(metrics.renderFallbackRatioWeighted).toBeCloseTo(2 / 30, 10);
      // 有真实调用的场次占比: 2/2
      expect(metrics.llmCallRatio).toBe(1);
    });

    it('没测过的场次 (ratio = null) 不被当成 0 混进均值', () => {
      const metrics = computeBatchMetrics([
        makeMetrics({ id: 'a', renderFallbackRatio: 0.2 }),
        makeMetrics({ id: 'b', renderFallbackRatio: null }),
      ]);

      expect(metrics.renderFallbackRatio).toBeCloseTo(0.2, 10);
      expect(metrics.renderFallbackRatioWeighted).not.toBeNull();
    });

    it('DECIMAL 字符串能被转成数字 (mysql2 取回的是字符串)', () => {
      const row = makeSession();
      // 模拟 mysql2 的返回形状: 字符串数字.
      Object.assign(row, { renderFallbackRatio: '0.2500' as unknown as number });
      expect(toBatchSessionMetrics(row).renderFallbackRatio).toBe(0.25);
    });
  });

  describe('② 改动 8 · engine_version 走 git describe --dirty', () => {
    it('env 优先于 git (显式覆盖)', () => {
      expect(resolveEngineVersion('  v1.2.3  ', () => 'abc-dirty')).toBe('v1.2.3');
    });

    it('env 缺省时用 git describe 的结果', () => {
      expect(resolveEngineVersion(undefined, () => 'abc-dirty')).toBe('abc-dirty');
      expect(resolveEngineVersion(' '.repeat(3), () => 'abc')).toBe('abc');
    });

    it('git 也没有 → unknown (不抛错, 不假装是 dev)', () => {
      expect(resolveEngineVersion(undefined, () => '')).toBe(ENGINE_VERSION_UNKNOWN);
    });

    it.skipIf(!gitUsable)('工作区 dirty → 版本号带 -dirty 后缀 (数据里看得见"跑的是未提交代码")', () => {
      const dir = mkdtempSync(join(tmpdir(), 'wp-h-git-'));
      try {
        // V2026-11-13 (TD-9 · T-4): 命令换成解析后的可执行文件后, sonarjs/no-os-command-from-path
        //   不再触发 (它只拦字面量路径) —— 原先的 eslint-disable 随之失效, 一并移除.
        execFileSync(gitBinary, ['init', '-q'], { cwd: dir, stdio: 'ignore' });
        writeFileSync(join(dir, 'a.txt'), 'one', 'utf8');
        execFileSync(gitBinary, ['add', '.'], { cwd: dir, stdio: 'ignore' });
        execFileSync(gitBinary, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], {
          cwd: dir,
          stdio: 'ignore',
        });

        // 干净工作区 → 版本号**不带** -dirty.
        const clean = gitDescribeDirty(dir);
        expect(clean).not.toBe(ENGINE_VERSION_UNKNOWN);
        expect(clean.endsWith('-dirty')).toBe(false);

        // 改了工作区里的文件 → 版本号必须带 -dirty (数据里看得见"跑的是未提交代码").
        writeFileSync(join(dir, 'a.txt'), 'two', 'utf8');
        const dirty = gitDescribeDirty(dir);
        expect(dirty.endsWith('-dirty')).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('没有 .git 的目录 → unknown (生产容器场景, 不抛错)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'wp-h-nogit-'));
      try {
        expect(gitDescribeDirty(dir)).toBe(ENGINE_VERSION_UNKNOWN);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('③ 改动 9 · 批次有效性门禁', () => {
    it('合格批次 → valid = true', () => {
      const metrics = computeBatchMetrics([
        makeMetrics({ id: 'a', renderFallbackTurns: 0, llmCallTurns: 10, renderFallbackRatio: 0 }),
        makeMetrics({ id: 'b', renderFallbackTurns: 0, llmCallTurns: 10, renderFallbackRatio: 0 }),
      ]);
      const health = evaluateBatchHealth(metrics);

      expect(health.valid).toBe(true);
      expect(health.flags).toEqual([]);
    });

    it('兜底率 50% 的批次 → valid = false 且带 FALLBACK_RATIO_HIGH', () => {
      const metrics = computeBatchMetrics([
        makeMetrics({ id: 'a', turnCount: 10, renderFallbackTurns: 5, llmCallTurns: 5, renderFallbackRatio: 0.5 }),
        makeMetrics({ id: 'b', turnCount: 10, renderFallbackTurns: 5, llmCallTurns: 5, renderFallbackRatio: 0.5 }),
      ]);
      const health = evaluateBatchHealth(metrics);

      expect(health.valid).toBe(false);
      expect(health.flags).toContain(BATCH_VALIDITY_FLAGS.fallbackRatioHigh);
    });

    it('LLM 调用占比不足 90% → valid = false (整场 0 token 的老问题不许再混进分析)', () => {
      const rows = [
        makeMetrics({ id: 'a', llmCallTurns: 10 }),
        makeMetrics({ id: 'b', llmCallTurns: 0, renderFallbackTurns: 10, renderFallbackRatio: 1 }),
        makeMetrics({ id: 'c', llmCallTurns: 0, renderFallbackTurns: 10, renderFallbackRatio: 1 }),
      ];
      const health = evaluateBatchHealth(computeBatchMetrics(rows));

      expect(health.valid).toBe(false);
      expect(health.flags).toContain(BATCH_VALIDITY_FLAGS.llmCallRatioLow);
      expect(BATCH_HEALTH_LLM_CALL_RATIO_MIN).toBe(0.9);
      expect(BATCH_HEALTH_FALLBACK_RATIO_MAX).toBe(0.05);
    });

    it('计数不一致 (degraded_turns > turn_count) → valid = false', () => {
      const metrics = computeBatchMetrics([makeMetrics({ turnCount: 5, degradedTurns: 12 })]);
      const health = evaluateBatchHealth(metrics);

      expect(metrics.counterConsistent).toBe(false);
      expect(health.valid).toBe(false);
      expect(health.flags).toContain(BATCH_VALIDITY_FLAGS.counterInconsistent);
    });

    it('兜底率没测过 → valid = false ("没测"不等于"没问题")', () => {
      const metrics = computeBatchMetrics([makeMetrics({ renderFallbackRatio: null, llmCallTurns: 0 })]);
      const health = evaluateBatchHealth(metrics);

      expect(health.valid).toBe(false);
      expect(health.flags).toContain(BATCH_VALIDITY_FLAGS.fallbackRatioUnknown);
    });

    it('不合格批次的告警文案是规格原文', () => {
      expect(BATCH_INVALID_WARNING).toBe('该批次未通过有效性门禁，指标不可用于结论');
    });
  });

  describe('④ 新增 12 · 逐字稿批次索引', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'wp-h-index-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('批次结束后写索引: 字段与 DB 一致, 且零对话文本', async () => {
      const sessions = [makeSession({ id: 'sess-a', debugSessionId: 'dbg-a', batchId: 'batch-1' })];
      const { sessionRepo, batchRepo, saved } = stubRepos(sessions);
      const service = new PracticeBatchHealthService(
        stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never,
        sessionRepo as never,
        batchRepo as never,
        {} as never,
      );

      const result = await service.refreshBatch('batch-1');
      expect(result.metrics.totalSessions).toBe(1);

      // 结论落库 (改动 9): 一批一行, valid + flags.
      expect(saved).toHaveLength(1);
      expect(saved[0].batchId).toBe('batch-1');
      expect(saved[0].valid).toBe(1);

      // 索引文件: 字段与 DB 逐字段一致.
      const indexPath = join(dir, '_batches', 'batch-1.json');
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
        batchId: string;
        scope: string;
        engineVersion: string;
        sessions: { practiceSessionId: string; debugSessionId: string; characterSlug: string; status: string; turnCount: number }[];
      };
      expect(index.batchId).toBe('batch-1');
      expect(index.scope).toBe('batch');
      expect(index.engineVersion).toBe('f59c307-dirty');
      expect(index.sessions).toEqual([
        {
          practiceSessionId: 'sess-a',
          debugSessionId: 'dbg-a',
          characterSlug: 'secure',
          counselorModeId: 'expert',
          status: 'completed',
          turnCount: 10,
        },
      ]);

      // 零对话文本: 索引里只有 id / 枚举 / 计数 / 版本号.
      //
      // ⚠️ 为什么 prompt 这一条从"查子串 'prompt'"改成"查**内容特征**":
      //   WP-B 给索引加了 promptVersion (16 位哈希的版本号), 字段名本身含 'prompt'
      //   → 老探针必然误报, 而它本来想拦的是"**prompt 全文**漏进索引".
      //   改成查真实的 prompt 文本特征 (渲染层 system 开头 / 咨询师输出纪律开头):
      //   判据更准, 而且比原来**更严** —— 原来那三个子串本来就拦不住任何中文正文.
      const raw = readFileSync(indexPath, 'utf8');
      expect(raw).not.toContain('text');
      expect(raw).not.toContain('reply');
      expect(raw).not.toContain('你正在扮演一位来访者');
      expect(raw).not.toContain('输出纪律');
      // 版本号要真的进索引 (WP-B: prompt 模板版本与 engine_version 并列).
      expect(raw).toContain('promptVersion');
    });

    it('单场实时跑也能生成索引 (scope=single, batchId=null)', async () => {
      const sessions = [makeSession({ id: 'sess-single', batchId: null })];
      const { sessionRepo, batchRepo } = stubRepos(sessions);
      const service = new PracticeBatchHealthService(
        stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never,
        sessionRepo as never,
        batchRepo as never,
        {} as never,
      );

      await service.refreshSingleSession('sess-single');

      const indexPath = join(dir, '_batches', 'sess-single.json');
      expect(existsSync(indexPath)).toBe(true);
      const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { batchId: string | null; scope: string };
      expect(index.batchId).toBeNull();
      expect(index.scope).toBe('single');
    });

    it('不合格批次 → 落库 valid=0 + validity_flags', async () => {
      const sessions = [
        makeSession({ id: 'sess-a', batchId: 'batch-x', turnCount: 10, renderFallbackTurns: 5, llmCallTurns: 5, renderFallbackRatio: 0.5 }),
      ];
      const { sessionRepo, batchRepo, saved } = stubRepos(sessions);
      const service = new PracticeBatchHealthService(
        stubConfig({ ADMIN_DEBUG_SESSION_DIR: dir }) as never,
        sessionRepo as never,
        batchRepo as never,
        {} as never,
      );

      const result = await service.refreshBatch('batch-x');
      expect(result.health.valid).toBe(false);
      expect(saved[0].valid).toBe(0);
      expect(saved[0].validityFlags).toContain(BATCH_VALIDITY_FLAGS.fallbackRatioHigh);
    });

    it('文件名安全化 (id 会拼进文件路径)', () => {
      // 路径分隔符与点号全部替换掉 → 拼不出目录外的路径.
      expect(sanitizeFileKey('../../etc/passwd')).toBe('______etc_passwd');
      expect(sanitizeFileKey('../../etc/passwd')).not.toContain('/');
      expect(sanitizeFileKey('')).toBe('unknown');
    });
  });

  describe('⑤ 新增 10 · DB_QUERY_LOGGING 日志降噪', () => {
    it('缺省 (未配) → 不开 query 日志', () => {
      expect(resolveDbQueryLogging(void 0)).toBe(false);
      expect(resolveDbLoggingLevels(void 0)).not.toContain('query');
    });

    it('配 true → 开 query 日志', () => {
      expect(resolveDbQueryLogging('true')).toBe(true);
      expect(resolveDbLoggingLevels('true')).toContain('query');
    });

    it('error / warn / migration 永远保留 (两种情况都在)', () => {
      for (const raw of [undefined, 'false', 'true']) {
        const levels = resolveDbLoggingLevels(raw);
        expect(levels).toContain('error');
        expect(levels).toContain('warn');
        expect(levels).toContain('migration');
      }
      expect(ALWAYS_ON_DB_LOG_LEVELS).toEqual(['error', 'warn', 'migration']);
    });

    it('非 "true" 的值一律当关 (不猜)', () => {
      expect(resolveDbQueryLogging('1')).toBe(false);
      expect(resolveDbQueryLogging('TRUE')).toBe(true);
      expect(resolveDbQueryLogging('yes')).toBe(false);
    });
  });

  describe('⑥ 新增 11 · WS 空房间短路', () => {
    let gateway: AutoPracticeGateway;
    let emitted: { event: string; payload: unknown }[];
    let rooms: Map<string, { size: number }>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let debugSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      emitted = [];
      rooms = new Map();
      gateway = new AutoPracticeGateway();
      Object.assign(gateway, {
        server: {
          sockets: { adapter: { rooms } },
          to: (_room: string) => ({
            emit: (event: string, payload: unknown) => {
              emitted.push({ event, payload });
            },
          }),
        },
      });
      warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      debugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('无订阅 → 不 emit、不打 WARN, 同一场次只打一条 debug', () => {
      rooms.set('ap:sess-1', { size: 0 });

      gateway.publishToSession('sess-1', 'ap:turn', { text: 'x' });
      gateway.publishToSession('sess-1', 'ap:turn', { text: 'y' });

      expect(emitted).toHaveLength(0);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledTimes(1);
    });

    it('有订阅 → 消息照常到达 (单场实时路径的行为与延迟不变)', () => {
      rooms.set('ap:sess-1', { size: 2 });

      gateway.publishToSession('sess-1', 'ap:turn', { text: 'x' });

      expect(emitted).toHaveLength(1);
      expect(emitted[0].event).toBe('ap:turn');
      expect(debugSpy).toHaveBeenCalled();
    });

    it('场次结束 → 清掉去重记录 (不留内存)', () => {
      rooms.set('ap:sess-1', { size: 0 });
      gateway.publishToSession('sess-1', 'ap:turn', { text: 'x' });
      gateway.publishToSession('sess-1', 'ap:session_end', { status: 'completed' });

      // 结束后同一场次再推 → 又会打一条 debug (说明记录已被清掉).
      gateway.publishToSession('sess-1', 'ap:turn', { text: 'z' });
      expect(debugSpy).toHaveBeenCalledTimes(2);
    });
  });
});

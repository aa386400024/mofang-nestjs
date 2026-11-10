// V2026-11-11 WP-K (批次指标计算服务):
//   职责: 把 DB 场次行 + 逐字稿文件, 经"合规投影"喂给纯计算, 产出固化快照.
//   边界: 本服务负责 IO (DB / 文件); 计算逻辑在 batch-metrics.compute.ts (纯函数).
//
//   合规要点 (隐私红线):
//     · 投影时只取计算所需字段, 逐字稿里的 messages / renderSpec / intention.rationale
//       在投影后即随原始对象释放, 不进任何下游 / 日志;
//     · 任何日志只报计数 / id / 枚举, 绝不打印对话文本或 prompt.

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
// eslint-disable-next-line unicorn/import-style
import { isAbsolute, join, resolve } from 'node:path';
import { Repository } from 'typeorm';

import { resolveStoreDir } from '../../admin-debug/debug-session-store.js';
import { computeConfigFingerprint } from '../config-fingerprint.js';
import { PracticeSession } from '../entities/practice-session.entity.js';
import { computePromptVersion } from '../prompt-fingerprint.js';
import { computeBatchSnapshot, type SessionComputationInput, type SkippedSession, type TraceInput } from './batch-metrics.compute.js';
import type { BatchMetricsV1 } from './batch-metrics.schema.js';
import { round6 } from './round.js';

/** 投影阶段的错误 (携带 skipReason). */
class ProjectError extends Error {
  constructor(readonly reason: SkippedSession['reason']) {
    super(reason);
  }
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 把一个原始 trace 投影成合规 TraceInput.
 * 只取需要的字段; 不含任何文本 / prompt.
 */
function projectTrace(raw: unknown): TraceInput {
  if (typeof raw !== 'object' || raw === null) throw new ProjectError('json_invalid');
  const trace = raw as Record<string, unknown>;
  const snapshot = (trace['bdiSnapshot'] ?? {}) as Record<string, unknown>;
  const intention = (trace['intention'] ?? {}) as Record<string, unknown>;
  const eventTags = Array.isArray(trace['eventTags']) ? trace['eventTags'].filter((tag): tag is string => typeof tag === 'string') : [];
  return {
    turnIndex: toNumber(trace['turnIndex']),
    bdiSnapshot: {
      trust: toNumber(snapshot['trust']),
      safety: toNumber(snapshot['safety']),
      bond: toNumber(snapshot['bond']),
      valence: toNumber(snapshot['valence']),
      arousal: toNumber(snapshot['arousal']),
      resistanceVerbal: toNumber(snapshot['resistanceVerbal']),
      resistanceDepth: toNumber(snapshot['resistanceDepth']),
      resistanceStyle: toNumber(snapshot['resistanceStyle']),
    },
    eventTags,
    strategy: typeof intention['strategy'] === 'string' ? intention['strategy'] : 'recounting',
    degraded: Boolean(trace['degraded']),
  };
}

/** 把逐字稿原始内容投影成 trace 列表. */
function projectTraces(fileContent: string): TraceInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new ProjectError('json_invalid');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new ProjectError('json_invalid');
  const rawTraces = (parsed as Record<string, unknown>)['traces'];
  if (!Array.isArray(rawTraces)) throw new ProjectError('no_traces');
  if (rawTraces.length === 0) throw new ProjectError('no_traces');
  const traces = rawTraces.map(projectTrace);
  if (traces.every((trace) => typeof trace.bdiSnapshot.trust !== 'number')) throw new ProjectError('no_snapshot');
  return traces;
}

@Injectable()
export class BatchMetricsService {
  private readonly logger = new Logger('BatchMetricsService');

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(PracticeSession) private readonly sessionRepo: Repository<PracticeSession>,
  ) {}

  /**
   * 构建归档文件索引 (文件名 -> 绝对路径), 单次调用只扫描一次.
   *
   * 约定: data/archives/<子目录>/<debugSessionId>.json. 主目录找不到的逐字稿
   * 自动回退到这里, 使 --all 无需手动指定目录即可回填历史批次.
   * 只读取文件名, 不打开内容, 不触碰对话文本.
   */
  private buildArchiveIndex(): Map<string, string> {
    const index = new Map<string, string>();
    const archiveRoot = resolve(process.cwd(), 'data/archives');
    if (!existsSync(archiveRoot)) return index;

    let dirs: string[];
    try {
      dirs = readdirSync(archiveRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(archiveRoot, entry.name));
    } catch {
      return index;
    }

    for (const dir of dirs) {
      let names: string[];
      try {
        names = readdirSync(dir).filter((name) => name.endsWith('.json'));
      } catch {
        continue;
      }
      for (const name of names) {
        // debugSessionId 全局唯一; 同名保留首个, 不覆盖.
        if (!index.has(name)) index.set(name, join(dir, name));
      }
    }
    return index;
  }

  /**
   * 构建一个批次的固化快照.
   *
   * @param batchId 批次 id
   * @param options.transcriptRoot 逐字稿来源目录 (相对仓库根; 归档批次用归档路径)
   * @returns 快照 v1
   */
  async buildBatchSnapshot(batchId: string, options: { readonly transcriptRoot?: string } = {}): Promise<BatchMetricsV1> {
    const rows = await this.sessionRepo.find({ where: { batchId } });
    const defaultDir = resolveStoreDir(this.config);
    const transcriptRoot = options.transcriptRoot ?? 'data/debug-sessions';
    // 读文件目录: 显式 transcriptRoot 支持归档回填 (相对 cwd 解析); 缺省用默认 storeDir.
    let readDir = defaultDir;
    if (options.transcriptRoot) {
      readDir = isAbsolute(options.transcriptRoot) ? options.transcriptRoot : resolve(process.cwd(), options.transcriptRoot);
    }

    const archiveIndex = this.buildArchiveIndex();
    const included: SessionComputationInput[] = [];
    const skipped: SkippedSession[] = [];

    for (const row of rows) {
      const fileName = `${row.debugSessionId}.json`;
      const primary = join(readDir, fileName);
      const archived = archiveIndex.get(fileName);
      // 主目录优先; 缺失时回退归档路径; 都没有时 readFileSync 抛错 → file_missing.
      let file = primary;
      if (!existsSync(primary) && archived) {
        file = archived;
      }
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        skipped.push({ debugSessionId: row.debugSessionId, reason: 'file_missing' });
        continue;
      }
      let traces: TraceInput[];
      try {
        traces = projectTraces(content);
      } catch (error) {
        const reason = error instanceof ProjectError ? error.reason : 'json_invalid';
        skipped.push({ debugSessionId: row.debugSessionId, reason });
        continue;
      }
      included.push({
        debugSessionId: row.debugSessionId,
        characterSlug: row.characterSlug,
        counselorModeId: row.counselorModeId,
        status: row.status,
        fileSha256: createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16),
        traces,
      });
    }

    // 管道健康 (weighted 口径, 与批次健康一致).
    const llmCallSessions = rows.filter((row) => row.llmCallTurns > 0).length;
    const totalTurnCount = rows.reduce((acc, row) => acc + row.turnCount, 0);
    const totalFallback = rows.reduce((acc, row) => acc + row.renderFallbackTurns, 0);
    const fallbackRatio = totalTurnCount > 0 ? totalFallback / totalTurnCount : null;

    const promptVersion = computePromptVersion();
    const fingerprint = computeConfigFingerprint({ promptVersion });

    const snapshot = computeBatchSnapshot(included, skipped, rows.length, {
      batchId,
      transcriptRoot,
      fingerprint,
      pipeline: {
        llmCallRatio: rows.length > 0 ? llmCallSessions / rows.length : 0,
        fallbackRatio: fallbackRatio === null ? null : round6(fallbackRatio),
      },
    });

    if (skipped.length > 0) {
      this.logger.warn(`批次 ${batchId} 有 ${skipped.length}/${rows.length} 场被跳过 (见 coverage), 快照仍生成`);
    }
    return snapshot;
  }
}

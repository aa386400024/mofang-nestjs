// V2026-10-30 治本 (WP12 · B 层 · 会话收尾编排):
//   职责: 会话结束时的两件"会话级"善后 ——
//           ① 逐字稿**全量落库** (不靠进程内 Map 扛重启);
//           ② 本场摘要**晋升为长时记忆** (跨会话可召回).
//   边界: B 层 (src/engine-adapters/persistence/); 只做"编排 + 记账",
//         不认识具体存储实现 (记忆走内核 MemoryStore 端口, 逐字稿走窄面 sink).
//
//   为什么收尾逻辑必须住在 B 层而不是内核:
//     内核 `EngineSessionPort.closeSession` 是**同步、幂等、不做持久化**的契约 ——
//     把它改成 async = 破坏已发布契约; 把仓储写塞进去 = 让同步关闭路径去等 I/O,
//     关闭时延不可控, 且失败时"会话关不掉".
//     内核 `memory/promotion.ts` 的注释里已经把这条写死了:
//     "关闭只释放运行时句柄; 落库由**会话结束编排层 (B 层)** 负责".
//     本文件就是那一层.
//
//   为什么"逐字稿要全量落库"而不是靠每轮增量:
//     现状是**每轮** append 进 `training_sessions.transcript` (counselor 侧落库桥).
//     那份增量在进程中途崩溃时会停在最后一轮 —— 逐字稿**不全**.
//     收尾时再全量写一遍 (覆盖语义) 等于给出一份"以内存副本为准"的定稿:
//       - 补上了增量写入失败的那些轮次;
//       - 明确了落库边界 —— 落不下去要**报错留痕**, 不留"好像存了"的模糊.
//
//   失败语义 (两层, 不一样):
//     - **逐字稿落库失败** → 记 **error**, 结果里 `transcriptPersisted=false`.
//       这是"数据没存下来", 属于必须有人知道的事.
//     - **摘要生成/晋升失败** → 记 **warn**, 结果里 `summaryPromoted=false`.
//       摘要只是**增强** (下次开场能提一句上次聊了什么), 它挂了不影响这场会谈
//       已经发生过的事实, 更不该把"会话关不掉"这种更大的问题带出来.
//     两者都**不抛错**: 收尾路径常出现在 finally / 断连路径上, 抛错会把
//     "清理失败"升级成"主流程失败", 反而掩盖真实错因 (与内核 closeSession 同款理由).
//
//   反双胞胎:
//     - 不自己判断"该不该晋升" —— 晋升用内核纯函数 `promoteShortTermToLongTerm`,
//       派生规则 (tier 改写 / TTL 转永久 / 继承 visitorId / 换新 id) 只有那一份.
//     - 不直接把摘要当长时记忆写 —— 先构造一条**短时**记忆再派生, 走内核同款流程.
//     - 不在收尾时物理删除任何东西 —— 记忆侧的"只标记不删除" (M4) 与本文件无关,
//       但同一原则: 收尾只补数据, 不动别人的数据.
//     - 不把 LLM 调用写在本文件里 —— 摘要生成走窄面 `SessionSummaryGenerator`,
//       本文件只管"拿到摘要 → 派生 → 落库".
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp12-memory-closeout.spec.ts:
//       摘要成功→晋升 / 摘要失败→不晋升但不阻断 / 落库失败→记 error / 空逐字稿→不生摘要

import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TranscriptTurn } from '../../agent/supervisor/supervisor.types';
import { MemorySource, MemoryTier, promoteShortTermToLongTerm, type MemoryEntry, type MemoryStore } from '../../engine-core';

/**
 * 摘要重要度种子值 (工程种子值, **未标定**).
 *
 * 为什么是 0.9: 内核 `collectOpeningContext` 召回长时记忆时带 `minImportance: 0.5`,
 * 而访客范围的有效重要度是**衰减后**的值 (半衰期 30 天).
 * 0.9 → 衰减到 0.5 需要 ≈23 天, 也就是"学员一周后回来还能被想起".
 * 调低 → 摘要很快淡出, resume 时开场想不起来上次聊了什么 —— 那这条记忆就白写了.
 *
 * ⚠️ 这是工程种子, 不是临床结论 —— 后期靠真实数据校准.
 */
export const DEFAULT_SESSION_SUMMARY_IMPORTANCE = 0.9;

/**
 * 会话摘要 (模型产出).
 */
export interface SessionSummary {
  /** 摘要正文 (≤200 字). */
  readonly content: string;
  /** 核心议题的短键 (冲突分组用); 无则省略. */
  readonly topicKey?: string;
}

/**
 * 摘要生成端口 (窄面).
 *
 * 为什么要窄面: 本文件不该知道"摘要怎么生成"(LLM / 规则 / 人工),
 * 只该知道"给我一段摘要". 单测用 stub, 换生成方式不用动收尾逻辑.
 */
export interface SessionSummaryGenerator {
  /**
   * 生成摘要.
   *
   * @param transcript 本场逐字稿 (一问一答两条)
   * @returns 摘要; 生成不出来应**抛错** (由调用方降级)
   */
  generate(transcript: readonly TranscriptTurn[]): Promise<SessionSummary>;
}

/**
 * 逐字稿落库端口 (窄面).
 *
 * 生产实现由**业务侧**提供 (counselor 侧写 `training_sessions.transcript`),
 * 引擎侧只声明"我要把逐字稿存下去"这个需求 —— 与仓库既有的
 * `VoiceSessionBridge` 插槽同款依赖倒置, 避免 engine → counselor 的反向依赖.
 */
export interface SessionTranscriptSink {
  /**
   * 全量覆盖写逐字稿 (定稿语义).
   *
   * @param input 覆盖写输入
   */
  saveTranscript(input: SessionTranscriptSaveInput): Promise<void>;
}

/**
 * 逐字稿覆盖写输入.
 *
 * 为什么带 `userId`: 业务侧写库要带归属校验 (谁的会话) —— 与既有
 * `training_sessions` 的按 `userId` 过滤口径一致, 不给"拿到 id 就能改别人会话"留口子.
 */
export interface SessionTranscriptSaveInput {
  /** 稳定落库 id (training_sessions.id). */
  readonly dbSessionId: string;
  /** 归属学员 id (缺省 = 不校验归属). */
  readonly userId?: string;
  /** 本场完整逐字稿. */
  readonly turns: readonly TranscriptTurn[];
}

/**
 * 收尾入参.
 */
export interface SessionCloseoutInput {
  /** 租户隔离键. */
  readonly tenantId: string;
  /** 本场会话 id. */
  readonly sessionId: string;
  /** 稳定来访者 id (长时记忆的跨会话归属键; 缺省 = 不写长时记忆). */
  readonly visitorId?: string;
  /** 归属学员 id (逐字稿写库的归属校验用; 缺省 = 不校验). */
  readonly userId?: string;
  /** 稳定落库 id (无 = 本场没落库, 逐字稿无处可写). */
  readonly dbSessionId?: string;
  /** 本场逐字稿. */
  readonly transcript: readonly TranscriptTurn[];
}

/**
 * 收尾结果.
 */
export interface SessionCloseoutResult {
  /** 逐字稿是否已落库. */
  readonly transcriptPersisted: boolean;
  /** 摘要是否已晋升为长时记忆. */
  readonly summaryPromoted: boolean;
}

/**
 * 收尾编排构造入参.
 */
export interface SessionCloseoutDeps {
  /** 记忆仓储 (内核端口). */
  readonly memories: MemoryStore;
  /** 摘要生成器 (缺省 = 不做摘要晋升). */
  readonly generator?: SessionSummaryGenerator;
  /** 逐字稿落库口 (缺省 = 不落库). */
  readonly sink?: SessionTranscriptSink;
  /** 时钟 (测试可注入; 默认 Date.now). */
  readonly now?: () => number;
  /** id 工厂 (测试可注入; 默认 randomUUID). */
  readonly makeId?: () => string;
  /** 摘要重要度 (缺省 = 种子值 0.9). */
  readonly summaryImportance?: number;
}

/**
 * 会话收尾编排服务.
 */
export class SessionCloseoutService {
  private readonly logger = new Logger(SessionCloseoutService.name);
  private readonly memories: MemoryStore;
  private readonly generator?: SessionSummaryGenerator;
  private readonly sink?: SessionTranscriptSink;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly summaryImportance: number;

  constructor(deps: SessionCloseoutDeps) {
    this.memories = deps.memories;
    this.generator = deps.generator;
    this.sink = deps.sink;
    this.now = deps.now ?? Date.now;
    this.makeId = deps.makeId ?? (() => randomId());
    this.summaryImportance = deps.summaryImportance ?? DEFAULT_SESSION_SUMMARY_IMPORTANCE;
  }

  /**
   * 执行收尾 (永不抛错).
   *
   * @param input 收尾入参
   * @returns 收尾结果 (逐字稿是否落库 / 摘要是否晋升)
   */
  async finalize(input: SessionCloseoutInput): Promise<SessionCloseoutResult> {
    const transcriptPersisted = await this.persistTranscript(input);
    const summaryPromoted = await this.promoteSummary(input);
    return { transcriptPersisted, summaryPromoted };
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 逐字稿全量落库.
   *
   * @param input 收尾入参
   * @returns 是否落库成功
   */
  private async persistTranscript(input: SessionCloseoutInput): Promise<boolean> {
    const dbSessionId = input.dbSessionId?.trim() ?? '';
    if (!dbSessionId) {
      // 本场没落库 (纯内存降级) → 无处可写. 这不是错误, 是"没有落库 id"的常态.
      this.logger.log(`[closeout] 跳过逐字稿落库 (无落库 id) session=${input.sessionId}`);
      return false;
    }
    if (!this.sink) {
      this.logger.warn(`[closeout] 逐字稿落库口未装配, 逐字稿未落库 session=${input.sessionId} db_session=${dbSessionId}`);
      return false;
    }
    try {
      await this.sink.saveTranscript({
        dbSessionId,
        ...(input.userId ? { userId: input.userId } : {}),
        turns: input.transcript,
      });
      this.logger.log(`[closeout] 逐字稿已落库 session=${input.sessionId} db_session=${dbSessionId} msgs=${input.transcript.length}`);
      return true;
    } catch (error) {
      // 记 error 而不是 warn: 逐字稿没存下来 = 数据缺失, 必须有人知道.
      this.logger.error(`[closeout] 逐字稿落库失败 session=${input.sessionId} db_session=${dbSessionId}: ${messageOf(error)}`);
      return false;
    }
  }

  /**
   * 摘要生成 + 晋升长时记忆.
   *
   * @param input 收尾入参
   * @returns 是否晋升成功
   */
  private async promoteSummary(input: SessionCloseoutInput): Promise<boolean> {
    if (!this.generator) {
      this.logger.log(`[closeout] 跳过摘要晋升 (摘要生成器未装配) session=${input.sessionId}`);
      return false;
    }
    // 没有归属作用域 → **不写**长时记忆.
    //   理由: 长时记忆是**跨会话**的, 没有归属键就等于把内容写进公共池 ——
    //   下一个学员开会话就会把别人的咨询内容召回出来. "没有归属就没有隔离".
    const visitorId = input.visitorId?.trim() ?? '';
    if (visitorId.length === 0) {
      this.logger.warn(`[closeout] 跳过摘要晋升 (无归属作用域, 不写长时记忆) session=${input.sessionId}`);
      return false;
    }
    // 空逐字稿 → 没有可摘要的内容 (学员一句没说就结束了) → 不生摘要.
    if (input.transcript.length === 0) {
      this.logger.log(`[closeout] 跳过摘要晋升 (空逐字稿) session=${input.sessionId}`);
      return false;
    }

    let summary: SessionSummary;
    try {
      summary = await this.generator.generate(input.transcript);
    } catch (error) {
      // 记 warn: 摘要只是增强, 它挂了不影响这场会谈已经发生的事实.
      this.logger.warn(`[closeout] 摘要生成失败, 本场不晋升长时记忆 session=${input.sessionId}: ${messageOf(error)}`);
      return false;
    }

    const content = summary.content.trim();
    if (content.length === 0) {
      this.logger.warn(`[closeout] 摘要为空, 本场不晋升长时记忆 session=${input.sessionId}`);
      return false;
    }

    try {
      // 先造一条**短时**记忆, 再走内核纯函数派生为长时 ——
      // 派生规则 (tier 改写 / TTL 转永久 / 继承 visitorId / 换新 id) 只有内核那一份.
      const shortTerm: MemoryEntry = {
        tenantId: input.tenantId,
        id: `st-${this.makeId()}`,
        sessionId: input.sessionId,
        tier: MemoryTier.SHORT_TERM,
        source: MemorySource.SUMMARY,
        content,
        importance: this.summaryImportance,
        occurredAt: this.now(),
        ttlMs: null,
        ...(summary.topicKey ? { topicKey: summary.topicKey } : {}),
      };
      const longTerm = promoteShortTermToLongTerm(shortTerm, visitorId, () => this.makeId());
      await this.memories.remember(longTerm);
      this.logger.log(
        `[closeout] 摘要已晋升长时记忆 session=${input.sessionId} visitor=${visitorId} id=${longTerm.id} ` +
          `topic=${summary.topicKey ?? '<none>'} chars=${content.length}`,
      );
      return true;
    } catch (error) {
      this.logger.warn(`[closeout] 摘要晋升失败 session=${input.sessionId}: ${messageOf(error)}`);
      return false;
    }
  }
}

/**
 * 错误转可读文案.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 默认 id 工厂 (node:crypto randomUUID).
 */
function randomId(): string {
  return randomUUID();
}

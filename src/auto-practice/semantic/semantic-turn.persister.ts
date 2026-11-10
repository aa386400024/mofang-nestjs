// V2026-11-10 治本 (WP-J P1e Phase2 — 来访者语义落库服务):
//   职责: 把一轮来访者回复拆成**三份**并落库:
//     displayText (纯文本) / ttsText (带 MiniMax 标记) / semanticJson (语义中间表示)
//     + 解析降级级别 + 语义层版本.
//
// ── 为什么在**离线对练**这头落, 而不是在线语音链路 ─────────────────────────
//   离线批量对练是"数据工厂": 一次跑几十场, 产出的逐字稿是后面所有评测/校准的原料.
//   在线对练 (真人咨询师 + 耳机 TTS) 走的是另一条路, 本批**不碰**.
//   这一层落库的价值: 事后能回答三个问题 ——
//     ① 这批来访者的话如果喂给 TTS, 会是什么效果? (ttsText)
//     ② 这一批有多少轮因为标记格式问题被降级了? (visitor_semantic_level)
//     ③ 解析口径升级后, 老数据还能不能和新数据直接比? (visitor_semantic_version)
//
// ── 契约 ────────────────────────────────────────────────────────────────
//   · **只处理来访者文本** —— 咨询师那半边本批不落语义列 (调试模式, 看逐字稿就够).
//   · **5 列在同一条 SQL 里写完** (upsert) —— 要么全成要么全败, 不留"写了 3 列"的脏行.
//   · **不发网络请求、不连 TTS** —— 纯本地解析 + 一次 DB 写.
//   · **失败以异常抛给调用方**: 调用方 (runner) 负责兜住, 不让落库失败炸掉整批对练.
//     这里**不吞异常** —— 吞了就没人知道这一轮的语义丢了.
//
// ── 隐私红线 ────────────────────────────────────────────────────────────
//   本服务处理的原始回复是**心理对话原文**:
//     · 原文只进 DB 列, **不进任何日志**;
//     · 诊断只出**码 + 计数** (P1e 已立的规矩), 不出原文;
//     · 日志里只打 sessionId / turnIndex / 级别 / 标签计数.
//
//   时间戳: 2026-11-10 GMT+8

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';

import { MiniMaxTtsAdapter } from '../adapters/minimax-tts-adapter.js';
import { PracticeTurn } from '../entities/practice-turn.entity.js';
import { SemanticTagParser } from '../utils/semantic-tag-parser.js';

/**
 * 语义层版本号 (落库到 visitor_semantic_version 列).
 *
 * 用途: parser 的解析口径升级后 (标签表变了 / 归一化规则变了), 老行与新行靠这列
 * 区分 —— 否则事后拿两批数据对比时, 分不清"数据不同"还是"**解析口径**不同".
 *
 * ⚠️ 改这个常量 = 声明"新旧数据不可直接比" —— 那时要么双跑, 要么重跑老批次.
 */
export const SEMANTIC_VERSION = 'semantic-v1' as const;

/** 落库入参 (只认来访者那半边). */
export interface PersistVisitorTurnArgs {
  /** 所属场次 id (ap_practice_sessions.id). */
  readonly practiceSessionId: string;
  /** 轮次序号 (从 1 起). */
  readonly turnIndex: number;
  /** 来访者这一轮的原始回复 (**带标记的裸文本**, 来自 result.reply). */
  readonly rawVisitorText: string;
}

/**
 * 来访者语义落库服务 (离线对练链路专用).
 */
@Injectable()
export class SemanticTurnPersister {
  private readonly logger = new Logger('SemanticTurnPersister');
  /**
   * 解析器 / 适配器: **纯工具类, 内部自持** —— 不走 DI.
   *
   * 为什么不用 @Inject: 它们没有外部依赖 (不起 NestJS / 不读配置 / 不连网络),
   * 自持比注册 provider 更省事, 也让单测可以真的跑一遍解析 (而不是 mock 掉解析逻辑,
   * 那样测的就不是"落库服务"而是"mock 的回声").
   */
  private readonly parser = new SemanticTagParser();
  private readonly adapter = new MiniMaxTtsAdapter();

  /**
   * @param turnRepo 轮次表 repo (ap_practice_turns)
   */
  constructor(@InjectRepository(PracticeTurn) private readonly turnRepo: Repository<PracticeTurn>) {}

  /**
   * 解析并落库一轮来访者回复 (5 列一条 SQL 写完).
   *
   * @param args 场次 id / 轮次 / 原始回复文本
   */
  async persistVisitorTurn(args: PersistVisitorTurnArgs): Promise<void> {
    const parsed = this.parser.parse(args.rawVisitorText);
    // baseVoiceParams 传空对象: 角色基线 (语速/音调) 本批不接 ——
    //   批量的角色参数还没定口径, 传 {} = 用 TTS 默认值, 不编数据.
    const rendered = this.adapter.render(parsed.turn, { baseVoiceParams: {} });

    await this.turnRepo.upsert(
      {
        id: randomUUID(),
        practiceSessionId: args.practiceSessionId,
        turnIndex: args.turnIndex,
        visitorDisplayText: parsed.turn.text,
        visitorTtsText: rendered.ttsText,
        visitorSemanticJson: JSON.stringify(parsed.turn),
        visitorSemanticLevel: parsed.level,
        visitorSemanticVersion: SEMANTIC_VERSION,
      },
      ['practiceSessionId', 'turnIndex'],
    );

    // 只打码与计数, 不打原文 (心理内容不进日志).
    this.logger.debug(
      '[semantic_turn] 已落库 session=' +
        args.practiceSessionId +
        ' turn=' +
        args.turnIndex +
        ' level=' +
        parsed.level +
        ' tags=' +
        parsed.stats.totalTags +
        ' unknown=' +
        parsed.stats.unknownTags,
    );
  }
}

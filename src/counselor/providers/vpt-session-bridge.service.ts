// V2026-10-26 治本 (vpt 会话落库桥 — counselor 侧实现, spec 任务 1):
//   原因: 任务 1 要求「vpt 建连成功 (ready 前) 写一条 `training_sessions` 记录」, 让
//     vpt 从"纯内存、结束即清"变成有稳定落库 id 的会话 —— 否则:
//       · 督导报告无处存 (fire-and-forget 生成完就丢)
//       · 4 流派反馈没有 sessionId 可挂
//       · 实时提示 / 技术统计 / 移情标记没有会话归属
//   修法: 本 service 实现 voice 侧的 `VoiceSessionBridge` 插槽 (依赖倒置):
//     - open       建一条 training_sessions 记录 (scenario_id = 'vpt_voice') → 返回稳定 id
//     - appendTurn 追加一轮逐字稿 (咨询师 + 来访者) → 入队该轮分析
//     - close      回写结束状态 / 结束时间
//   复用现有体系 (不另造轮子):
//     - 落 `training_sessions` 表 (已有 transcript json / tech_stats json / started_at /
//       ended_at / supervision_report_id 列) —— **0 新表、0 新列、0 migration**
//     - 逐字稿格式沿用 `TrainingTranscriptTurn` (ChatRole 3 档), 与单次训练同一口径
//     - 该轮分析沿用既有 `TurnAnalysisProcessor` (BullMQ) —— 轻提示 / 移情标记 / 技术统计
//       三段产出**全部**复用既有分析器, 本期不重写
//   反双胞胎:
//     - 不新建 `vpt_sessions` 表: vpt 与单次训练同属"训练会话", 逐字稿 / 统计 / 标记 /
//       督导全在同一套体系里; 另开一张表 = 两套逐字稿格式 + 两套分析入口, 必然漂移
//     - 不用内存 sessionId 当主键: 客户端给的 id 不是稳定落库 id, 报告 / 反馈都要按它查
//     - 不在 open 里同步跑分析: 分析是 LLM 调用 (3-8s), 建连关键路径上不能等
//     - 不覆盖 `duration_minutes` (那是**计划**时长 L1=10/L2=15/L3=20): 实际时长由
//       started_at → ended_at 推导, 覆盖计划值会让"计划 vs 实际"两个语义撞在一起
//   验证:
//     1. tsc 0 错
//     2. vpt 建连 → training_sessions 出现 1 条 scenario_id='vpt_voice' 的行
//     3. 会话结束 → 该行 status=finished, ended_at 有值
//     4. 跨用户查该 sessionId → 404 (归属校验在查询侧, 不靠前端)
//   时间戳: 2026-10-26
//
// V2026-10-30 治本 (WP12 · 逐字稿全量覆盖写):
//   原因: 逐字稿原本**只靠每轮增量**落库 —— 进程中途崩了就停在最后一轮, 而引擎侧
//     的内存副本 (`EngineStreamBackend.transcripts`) 重启即丢, 两边都不够.
//     任务单 §1.4: "close 时必须落库, 不落库就报错; 落库边界写死, 不留模糊".
//     本桥实现 voice 侧插槽的可选方法 `replaceTranscript`: 收尾时把本场**完整**逐字稿
//     覆盖写回 `training_sessions.transcript` (报告链路的逐字稿表).
//   为什么是"覆盖"而不是"追加":
//     覆盖 = 定稿语义. 追加会让同一段话在库里出现两份, 督导分析看到重复对话.
//     引擎副本是本场会话的权威快照 —— 它记的是**完整跑完**的轮次; 引擎全挂走兜底句的
//     降级轮次本就不进逐字稿 (与旧链路"早退不落逐字稿"同口径), 覆盖写会把它从定稿里
//     去掉, 这是**刻意**的: 兜底句不是来访者的真实表达, 留在逐字稿里只会污染督导分析.
//     代价 (轮次数变少) 会记 warn, 不静默.
//   反双胞胎:
//     - 不用"空快照覆盖": 引擎副本为空时**跳过写入** —— 拿空去覆盖会抹掉已落库的逐字稿.
//     - 不在 flush 时把状态改成 finished: 状态归 `close` 管, flush 只碰逐字稿
//       (且只在 IDLE → LISTENING, 绝不把 finished 退回 listening).
//     - 不绕过内部串行链: flush 与 close 共用一条链 → flush 一定排在 close 之前
//       (close 要读库里的逐字稿算素材量, 顺序反了会读到截断版).
//   验证:
//     1. tsc 0 错
//     2. 收尾后 training_sessions.transcript == 引擎副本全量
//     3. 引擎副本为空 → transcript 不变 (不抹)
//   时间戳: 2026-10-30

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import { IsNull, type Repository } from 'typeorm';

import { CounselorSupervisionProcessor } from './counselor-supervision.processor.js';
import { TurnAnalysisProcessor } from './turn-analysis.processor.js';
import type { TurnTrace } from '../../admin-debug/trace-recorder.service.js';
import type { TranscriptTurn } from '../../agent/supervisor/supervisor.types.js';
import { safeString } from '../../shared/infra/string-utils/index.js';
import { CharacterVersionRegistry } from '../../voice/character-version-slot.js';
import {
  VoiceSessionBridgeRegistry,
  type VoiceSessionBridge,
  type VoiceSessionCloseInput,
  type VoiceSessionCloseResult,
  type VoiceSessionCommittedTurnsInput,
  type VoiceSessionCommittedTurnsResult,
  type VoiceSessionOpenInput,
  type VoiceSessionOpenResult,
  type VoiceSessionTranscriptInput,
  type VoiceSessionTurnInput,
} from '../../voice/voice-session-bridge.js';
import type { VoiceDifficulty, VoiceVisitorStyle } from '../../voice/voice-session.types.js';
import type { VoiceCatchUpTurn } from '../../voice/voice.types.js';
import { SUPERVISION_MIN_EFFECTIVE_CHARS, SUPERVISION_MIN_EFFECTIVE_TURNS } from '../config/supervision.config.js';
import { VPT_SCENARIO_ID } from '../config/vpt.config.js';
import { isInsufficientMaterial, measureEffectiveMaterial } from '../domain/session-view/session-material.js';
import { TrainingSession, type TrainingTranscriptTurn } from '../entities/training-session.entity.js';
import { ChatRole } from '../enums/chat-role.enum.js';
import { DimensionVariance } from '../enums/dimension-variance.enum.js';
import { SessionType } from '../enums/session-type.enum.js';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum.js';
import { TrainingDifficulty } from '../enums/training-difficulty.enum.js';
import { TrainingSessionStatus } from '../enums/training-session-status.enum.js';
import { VisitorMode } from '../enums/visitor-mode.enum.js';
import { VisitorStyle } from '../enums/visitor-style.enum.js';

/**
 * vpt 会话在 `training_sessions` 表里的场景标识 → 见 `../config/vpt.config`.
 * 放在 config 而不放在本文件: 写方 (本桥) 与读方 (报告查询, 据此判定 sessionType)
 * 都要用它, 两边各写一份字面量, 改一处就断链.
 */

/** 难度 → 计划时长 (分钟), 跟单次训练同一口径 (L1=10 / L2=15 / L3=20). */
const DURATION_BY_DIFFICULTY: Readonly<Record<TrainingDifficulty, number>> = {
  [TrainingDifficulty.L1]: 10,
  [TrainingDifficulty.L2]: 15,
  [TrainingDifficulty.L3]: 20,
};

/** 年龄区间解析不出时的兜底年龄 (与单次训练 create 的缺省一致). */
const DEFAULT_PERSONA_AGE = 28;

/**
 * voice 侧难度 → counselor 侧难度 (显式映射, 不 cast).
 *
 * @param difficulty voice 侧难度
 */
function toTrainingDifficulty(difficulty: VoiceDifficulty): TrainingDifficulty {
  switch (difficulty) {
    case 'L1': {
      return TrainingDifficulty.L1;
    }
    case 'L2': {
      return TrainingDifficulty.L2;
    }
    case 'L3': {
      return TrainingDifficulty.L3;
    }
  }
}

/**
 * voice 侧配合风格 → counselor 侧配合风格 (显式映射, 不 cast).
 *
 * @param style voice 侧风格
 */
function toVisitorStyle(style: VoiceVisitorStyle): VisitorStyle {
  switch (style) {
    case 'defensive': {
      return VisitorStyle.DEFENSIVE;
    }
    case 'cooperative': {
      return VisitorStyle.COOPERATIVE;
    }
    case 'resistant': {
      return VisitorStyle.RESISTANT;
    }
    case 'avoidant': {
      return VisitorStyle.AVOIDANT;
    }
    case 'mixed': {
      return VisitorStyle.MIXED;
    }
  }
}

/**
 * vpt 会话落库桥 (counselor 侧实现).
 */
@Injectable()
export class VptSessionBridgeService implements OnModuleInit, VoiceSessionBridge {
  /** 桥标识 (日志用). */
  readonly name = 'counselor-vpt';

  private readonly logger = new Logger(VptSessionBridgeService.name);

  /**
   * 内部串行链 (V2026-10-26, spec 任务 6 — 顺序保证).
   *
   * 原因: voice 侧对桥的调用是 **fire-and-forget** (`void bridges.appendTurn(...)` /
   *   `void bridges.close(...)`), 两者可以**并发**在飞. 而:
   *     - `appendTurn` 往 training_sessions 追加逐字稿
   *     - `close` 回写结束状态, 并派发 4 流派任务 (它要**读库里的逐字稿**)
   *   若 close 抢在最后一轮 appendTurn 之前落地, 流派任务读到的逐字稿就是**截断的**
   *   —— 技术统计 / 反馈会基于半句话算, 且报告里的轮次数对不上.
   *   治本: 桥内部用一条 promise 链串行化, 保证 appendTurn → close 的先后.
   *   (单次训练没这个问题: 它的 finish 是 HTTP 端点, 逐字稿早就写完了.)
   */
  private chain: Promise<void> = Promise.resolve();

  /**
   * @param sessionRepo training_sessions 仓储
   * @param turnAnalysisProcessor 每轮分析入队器
   * @param supervisionProcessor 4 流派反馈入队器 (技术统计的唯一来源)
   * @param registry voice 侧落库桥注册表 (@Global)
   */
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    private readonly turnAnalysisProcessor: TurnAnalysisProcessor,
    private readonly supervisionProcessor: CounselorSupervisionProcessor,
    private readonly registry: VoiceSessionBridgeRegistry,
    /** 角色版本插槽 (WP38): 取建会话那一刻的实时角色版本号. */
    private readonly characterVersions: CharacterVersionRegistry,
    // 全局配置 (最小可分析量阈值) — 空局拦截要用.
    private readonly config: ConfigService,
  ) {}

  /** 启动时注册进 voice 侧全局注册表. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 建会话 (落一条 training_sessions 记录).
   *
   * @param input 建连输入
   * @returns 落库结果
   */
  async open(input: VoiceSessionOpenInput): Promise<VoiceSessionOpenResult> {
    const difficulty = toTrainingDifficulty(input.preset.difficulty);
    // WP38: 角色版本 —— 建会话这一刻的**实时**版本号 (角色刚被改过, 这里读到的就是新值).
    //   读不到 (无角色 / 兜底通道) → null, 不阻断建会话 (角色是可选增强).
    const characterVersion = input.templateId ? await this.characterVersions.resolve(input.templateId) : null;
    const entity = this.sessionRepo.create({
      // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
      tenantId: input.tenantId,
      userId: input.userId,
      scenarioId: VPT_SCENARIO_ID,
      difficulty,
      durationMinutes: DURATION_BY_DIFFICULTY[difficulty],
      status: TrainingSessionStatus.IDLE,
      // 来访者表层字段来自速查卡 (可公开的那几项); 没有卡 (兜底通道) 时用中性缺省.
      personaName: input.visitor.codename || '来访者',
      personaAge: input.visitor.ageLowerBound ?? DEFAULT_PERSONA_AGE,
      personaOccupation: input.visitor.occupation,
      personaComplaint: input.visitor.presentingComplaint,
      // 背景不落: 公共人物只对外呈现区间 + 居住状态, 完整背景属 7 大块剧本 (不下发).
      personaBackground: '',
      visitorStyle: toVisitorStyle(input.preset.style),
      emotionBaseline: input.preset.emotionBaseline,
      defenseLevel: input.preset.defenseLevel,
      randomSeed: this.generateRandomSeed(),
      mode: VisitorMode.USE_MY_SETTINGS,
      styleVariance: DimensionVariance.MEDIUM,
      emotionVariance: DimensionVariance.MEDIUM,
      defenseVariance: DimensionVariance.MEDIUM,
      transcript: [],
      supervisionReportId: null,
      // WP38: 绑定本场用的角色与版本 (可空 = 兜底人设通道 / 无角色).
      characterTemplateId: input.templateId,
      characterVersion,
      // 建连成功即计时起点 (与语音侧的墙钟起点一致).
      startedAt: new Date(),
      endedAt: null,
    });
    const saved = await this.sessionRepo.save(entity);
    this.logger.log(
      `[open] ws_session=${input.sessionId} db_session=${saved.id} user=${input.userId} ` +
        `template=${input.templateId ?? '<fallback>'} skill=${input.skillCode ?? '<none>'}`,
    );
    return { persisted: true, dbSessionId: saved.id };
  }

  /**
   * 追加一轮对话 (逐字稿落库 + 入队该轮分析).
   *
   * @param input 一轮对话
   */
  async appendTurn(input: VoiceSessionTurnInput): Promise<void> {
    await this.enqueueOp(() => this.doAppendTurn(input));
  }

  /**
   * 结束会话 (回写结束状态 / 结束时间 + 派发 4 流派反馈).
   *
   * @param input 结束输入
   * @returns 收尾结果 (落库与否 + 报告状态; 供 voice 侧 `session_ended` 帧回传)
   */
  async close(input: VoiceSessionCloseInput): Promise<VoiceSessionCloseResult> {
    // enqueueOp 在链上抛错时返回 null —— 桥**永远要给结论**, 不能把 null 抛给 voice 层
    // (voice 侧要的是"这场会不会有报告"的答案): 降级成"未落库 / 结论未知",
    // 前端按旧行为 (进轮询页) 处理.
    const result = await this.enqueueOp(() => this.doClose(input));
    return result ?? { persisted: false, reportStatus: null };
  }

  /**
   * 全量覆盖写逐字稿 (WP12).
   *
   * 与 `appendTurn` 的区别: 追加 vs **定稿**. 收尾时用引擎侧的权威快照把逐字稿
   * 一次写全 —— 补上增量写入失败的那些轮次, 并把落库边界钉死.
   *
   * 失败**必须冒泡**: 这里抛错 → voice 侧注册表记 warn → 引擎侧收尾记 error.
   * 逐字稿没存下来是数据缺失, 不能静默 (与 `appendTurn` 的"失败只记 warn"不同:
   * 那是每轮的增量, 这里是一次性的定稿).
   *
   * @param input 覆盖写输入
   */
  async replaceTranscript(input: VoiceSessionTranscriptInput): Promise<void> {
    await this.enqueueOpOrThrow(() => this.doReplaceTranscript(input));
  }

  /**
   * 读回本场已提交轮次 (V2026-11-03, WP23 · 进程重启后的补漏数据源).
   *
   * 数据来源两处, 各管一段:
   *   · `training_sessions.transcript` (WP18 每轮增量写) → "这一轮说了什么";
   *   · `training_sessions.turn_debug_trace` (WP19-R 每轮写) → "这一轮的 BDI 快照".
   *
   * ⚠️ 归属校验**在这里**做 (按 id + userId 查): `dbSessionId` 是客户端带来的,
   *   不校验就等于"谁的咨询记录我都能读出来". 查不到 → null → voice 层按不可续处理.
   *
   * @param input 读回入参
   * @returns 已提交轮次; null = 会话不存在 / 不属于该学员
   */
  async readCommittedTurns(input: VoiceSessionCommittedTurnsInput): Promise<VoiceSessionCommittedTurnsResult | null> {
    const row = await this.sessionRepo.findOne({
      where: { id: input.dbSessionId, userId: input.userId, deletedAt: IsNull() },
    });
    if (!row) {
      this.logger.warn(`[read_committed_turns_no_row] db_session=${input.dbSessionId} user=${input.userId}`);
      return null;
    }
    const rounds = pairTranscriptRounds(row.transcript ?? []);
    const traces = readTraceArray(row.turnDebugTrace);
    // 只有当 trace 与轮次**逐号对齐**时才附 BDI 快照 —— 对不上宁可不附:
    //   trace 的轮次号是内核的累计轮次 (含被 barge-in 掐掉的半截轮), 逐字稿的轮次是
    //   voice 层的完成轮次. 两者一旦错位, 按序 zip 会把**别的轮次**的快照贴上去 ——
    //   贴错比不贴更糟 (客户端会照着错的 BDI 继续这段对话).
    const aligned = traces.length === rounds.length && traces.every((trace, index) => trace.turnIndex === index + 1);
    const turns: VoiceCatchUpTurn[] = rounds.map((round, index) => {
      const trace = aligned ? traces[index] : undefined;
      return {
        turnIndex: index + 1,
        userText: round.userText,
        replyText: round.replyText,
        ...(trace?.bdiSnapshot ? { bdiSnapshot: trace.bdiSnapshot } : {}),
        // 标记恒空: 标记由 counselor 侧 worker 实时推帧, 没有可回读的逐轮标记存储.
        marks: [],
        // trace 只记了 `detected` / `category`, 没有档位 —— detected 映射成 warn
        // (三档里最接近的一档); block 档在这一条链路上**还原不出来**.
        crisisLevel: trace?.crisis?.detected === true ? 'warn' : 'pass',
      };
    });
    this.logger.log(
      `[read_committed_turns] db_session=${input.dbSessionId} rounds=${rounds.length} ` + `traces=${traces.length} aligned=${aligned}`,
    );
    return { turns };
  }

  // ── private ────────────────────────────────────────────────────

  /**
   * 把一个操作挂到内部串行链上.
   *
   * 单个 op 失败**不能断链** —— 否则后面的 close 永远不执行, 会话永远收不了尾
   * (逐字稿停在最后一轮, 状态永远不是 finished).
   *
   * @param op 操作
   * @returns op 的返回值 (失败时返回 null)
   */
  private async enqueueOp<T>(op: () => Promise<T>): Promise<T | null> {
    let result: T | null = null;
    const next = this.chain
      .then(async () => {
        result = await op();
      })
      .catch((err) => {
        this.logger.warn(`[chain_op_failed] err=${err instanceof Error ? err.message : String(err)}`);
      });
    this.chain = next;
    await next;
    return result;
  }

  /**
   * 把一个操作挂到内部串行链上, 但**失败要冒泡给调用方**.
   *
   * 与 `enqueueOp` 的唯一区别: 错误不再被链吞掉, 而是抛回调用方.
   * 链本身**不断** (失败后后续 op 照常执行) —— 否则一次写入失败会让这场会话再也收不了尾.
   *
   * 为什么逐字稿定稿要用这个而不是 `enqueueOp`: "不落库就报错"是任务单 §1.4 的硬要求,
   *   静默吞掉 = 落库边界留模糊.
   *
   * @param op 操作
   * @returns op 的返回值
   * @throws op 抛错时原样抛出
   */
  private async enqueueOpOrThrow<T>(op: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    let failure: unknown;
    const next = this.chain.then(async () => {
      try {
        result = await op();
      } catch (error) {
        failure = error;
      }
    });
    // 链不断: 失败只影响本次 op, 后续 op 照常排队.
    this.chain = next.then(() => {});
    await next;
    if (failure !== undefined) throw failure instanceof Error ? failure : new Error(safeString(failure, 'unknown error'));
    return result as T;
  }

  /**
   * 追加一轮对话 (实际执行体).
   *
   * @param input 一轮对话
   */
  private async doAppendTurn(input: VoiceSessionTurnInput): Promise<void> {
    const dbSessionId = input.dbSessionId;
    if (!dbSessionId) {
      // 未落库 (降级) → 无处可写, 直接跳过 (逐字稿仍然在 agent 侧内存里, 报告仍能生成)
      return;
    }
    const row = await this.sessionRepo.findOne({
      where: { id: dbSessionId, userId: input.userId, deletedAt: IsNull() },
    });
    if (!row) {
      this.logger.warn(`[append_turn_no_row] db_session=${dbSessionId} user=${input.userId}`);
      return;
    }

    const now = Date.now();
    const turns: TrainingTranscriptTurn[] = [
      {
        id: randomUUID(),
        role: ChatRole.COUNSELOR,
        text: input.counselorText,
        timestamp: now,
      },
      {
        id: randomUUID(),
        role: ChatRole.VISITOR,
        text: input.visitorText,
        timestamp: now,
      },
    ];
    row.transcript = [...(row.transcript ?? []), ...turns];
    // 首次发言即视为进入"会谈中" (跟单次训练的 LISTENING 语义一致).
    const nextStatus = row.status === TrainingSessionStatus.IDLE ? TrainingSessionStatus.LISTENING : row.status;
    // V2026-10-30 治本 (WP19-R · 只写自己管的列):
    //   这里**不能**用 `save(row)` —— TypeORM 的 save 会把"加载时的整行快照"写回去,
    //   而 JSON 列在它的 diff 里是**按引用**比较的 (加载出来的对象 ≠ 新对象) →
    //   于是 `turn_debug_trace` (WP19 每轮留痕) 会被**逐字稿写手的旧副本覆盖**:
    //   逐字稿与留痕并发写同一行时, 留痕会丢轮次 (实测: 2 轮只留 1 轮).
    //   改成**只更新自己管的列** (transcript / status): 别的列谁写谁负责, 互不覆盖.
    await this.sessionRepo.update({ id: dbSessionId }, { transcript: row.transcript, status: nextStatus });

    // 该轮分析: 触发点是"来访者那一轮落库后" (与单次训练同款口径 ——
    // 咨询师发言本身不足以判定, 提示要看来访者的反应).
    const visitorTurnIndex = row.transcript.length - 1;
    const enqueued = await this.turnAnalysisProcessor.enqueue({
      sessionId: dbSessionId,
      userId: input.userId,
      turnIndex: visitorTurnIndex,
    });
    if (!enqueued) {
      this.logger.warn(`[turn_analysis_enqueue_failed] db_session=${dbSessionId} turn=${visitorTurnIndex}`);
    }
  }

  /**
   * 结束会话 (实际执行体).
   *
   * V2026-10-27 治本 (spec 任务 B — 结束前置拦截):
   *   旧实现无条件派发 4 流派督导 job → 空素材抛永久失败 → **不落任何报告行** →
   *   列表把它误判成 pending (永久"生成中") → 学员永远等不到.
   *   新实现: 写 `finished` **之前**先量素材:
   *     · 素材不足 (空局) → **不派 job** (不烧永久失败 job / 不刷 warn / 不堆队列),
   *       会话仍置 finished + 写 endedAt (记录保留, D4), 收尾结果回传 `no_content`
   *     · 素材充足 → 维持原行为 (派发默认流派 CBT)
   *   注: `no_content` 是**派生**状态 (finished + 素材不足 + 无报告行), 不新增 DB 列、
   *   不写 migration —— 收尾回包只是实时把结果告诉前端.
   *
   * @param input 结束输入
   * @returns 收尾结果 (未落库 / 降级 → persisted=false)
   */
  private async doClose(input: VoiceSessionCloseInput): Promise<VoiceSessionCloseResult> {
    const dbSessionId = input.dbSessionId;
    if (!dbSessionId) {
      return { persisted: false, reportStatus: null };
    }
    const row = await this.sessionRepo.findOne({
      where: { id: dbSessionId, userId: input.userId, deletedAt: IsNull() },
    });
    if (!row) {
      this.logger.warn(`[close_no_row] db_session=${dbSessionId} user=${input.userId}`);
      return { persisted: false, reportStatus: null };
    }
    if (row.status === TrainingSessionStatus.FINISHED) {
      // 重复收尾 (幂等): 状态已是 finished, 不重复派发.
      return { persisted: true, reportStatus: null };
    }

    // 结束前置拦截: 素材量必须在写 finished **之前**算 (逐字稿在这行上).
    const material = measureEffectiveMaterial(row.transcript);
    const insufficient = isInsufficientMaterial(material, this.materialThresholds());

    row.status = TrainingSessionStatus.FINISHED;
    row.endedAt = row.endedAt ?? new Date();
    // V2026-10-30 治本 (WP19-R · 只写自己管的列): 收尾同样不用 `save(row)` ——
    //   否则会把加载时的旧 `turn_debug_trace` 副本写回去, 覆盖掉最后一轮留痕.
    await this.sessionRepo.update({ id: dbSessionId }, { status: row.status, endedAt: row.endedAt });
    this.logger.log(`[close] db_session=${dbSessionId} reason=${input.reason} turns=${input.turnCount} duration_ms=${input.durationMs}`);

    // 空局: 不派发 4 流派督导 (记录保留, 报告派生为 `no_content`).
    if (insufficient) {
      this.logger.log(
        `[close] empty_session_no_supervision db_session=${dbSessionId} ` +
          `effectiveTurns=${material.effectiveTurns} effectiveChars=${material.effectiveChars}`,
      );
      return { persisted: true, reportStatus: 'no_content' };
    }

    // V2026-10-26 治本 (spec 任务 6 — 补上「技术统计」的来源):
    //   **技术统计 (techStats) 的唯一来源是 4 流派那一次 LLM 调用** —— 它一次同时产
    //   反馈 + 技术统计 + 错误分类 + 成长建议, 然后 `writeTechStats` 写回 session 行.
    //   主报告链路 (agent/supervisor) 只产亮点 / 建议 / 标注, **不产**技术统计.
    //   所以 vpt 不派发流派队列 → training_sessions.tech_stats 永远为 null →
    //   报告里的技术统计是空的, 学员复盘时看不到「你今天问了几次开放提问」这类最关键的量.
    //   派发缺省流派 (CBT, 与单次训练 finish 同款口径); 其余流派前端可随时调
    //   POST /counselor/supervision/feedback 现生成 (jobId 幂等, 不会堆重复 job).
    //
    //   放在**保存 row 之后**: 流派任务要读库里的逐字稿 + 状态, 必须看到收尾后的行.
    const enqueued = await this.supervisionProcessor.enqueue({
      sessionId: dbSessionId,
      sessionType: SessionType.VPT_VOICE,
      schoolCode: SupervisionSchoolCode.CBT,
      userId: input.userId,
      tenantId: input.tenantId,
    });
    if (!enqueued) {
      this.logger.warn(`[supervision_enqueue_failed] db_session=${dbSessionId} school=${SupervisionSchoolCode.CBT}`);
    }
    return { persisted: true, reportStatus: enqueued ? 'pending' : null };
  }

  /**
   * 全量覆盖写逐字稿 (实际执行体).
   *
   * V2026-10-30 治本 (WP12 · 逐字稿定稿):
   *   写的是**引擎侧的权威快照** —— 覆盖语义, 不是追加.
   *   两条硬边界:
   *     ① **空快照不写**: 拿空去覆盖会抹掉已经落库的逐字稿 (数据丢失), 所以空 → 跳过 + warn;
   *     ② **状态只进不退**: IDLE → LISTENING 可以, finished 绝不被改回 listening
   *        (状态归 `close` 管, flush 只碰逐字稿).
   *
   * @param input 覆盖写输入
   */
  private async doReplaceTranscript(input: VoiceSessionTranscriptInput): Promise<void> {
    const dbSessionId = input.dbSessionId;
    const row = await this.sessionRepo.findOne({
      where: {
        id: dbSessionId,
        ...(input.userId ? { userId: input.userId } : {}),
        deletedAt: IsNull(),
      },
    });
    if (!row) {
      // 行不存在 = 落库 id 无效 → 明确报错 (不静默): "不落库就报错".
      throw new Error(`逐字稿覆盖写失败: 落库会话不存在 db_session=${dbSessionId}`);
    }

    const incoming = toTrainingTurns(input.turns);
    if (incoming.length === 0) {
      this.logger.warn(`[replace_transcript_empty] db_session=${dbSessionId} 引擎副本为空, 保留库里已有逐字稿`);
      return;
    }

    const before = (row.transcript ?? []).length;
    row.transcript = incoming;
    const nextStatus = row.status === TrainingSessionStatus.IDLE ? TrainingSessionStatus.LISTENING : row.status;
    // V2026-10-30 治本 (WP19-R · 只写自己管的列): 同 doAppendTurn ——
    //   `save(row)` 会把加载时的旧 `turn_debug_trace` 副本一起写回去, 覆盖掉
    //   这段时间里新落库的留痕. 定向 update 只碰 transcript / status.
    await this.sessionRepo.update({ id: dbSessionId }, { transcript: row.transcript, status: nextStatus });
    this.logger.log(`[replace_transcript] db_session=${dbSessionId} turns=${before}->${incoming.length}`);
  }

  /**
   * 最小可分析量阈值 (从 config 读; 缺失时用 config 模块的默认值).
   *
   * @returns 阈值
   */
  private materialThresholds(): { readonly minTurns: number; readonly minChars: number } {
    return {
      minTurns: this.config.get<number>('supervision.minEffectiveTurns') ?? SUPERVISION_MIN_EFFECTIVE_TURNS,
      minChars: this.config.get<number>('supervision.minEffectiveChars') ?? SUPERVISION_MIN_EFFECTIVE_CHARS,
    };
  }

  /**
   * 生成 randomSeed (跟单次训练同格式 'YYYY-MM-DD-HH-mm-ss-{0-99}').
   *
   * 用 node:crypto 的 randomInt 而不是 Math.random: 后者是非密码学安全的伪随机源,
   * 种子可被观测输出反推 (仓库既有 4 处历史 disable 是压错不是治本, 新代码不复制).
   *
   * @returns 随机种子
   */
  private generateRandomSeed(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const base =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    // randomInt 的 max 是开区间 → randomInt(0, 100) 产出 0-99 闭区间.
    return `${base}-${String(randomInt(0, 100)).padStart(2, '0')}`;
  }
}

/**
 * 引擎逐字稿 → 业务逐字稿表格式 (WP12).
 *
 * 角色映射**不能反**: 引擎链路里 role='user' 是**咨询师** (学员扮演), role='assistant'
 * 是**来访者** (AI 扮演). 报告链路按 counselor/visitor 判定"评估对象是谁", 映射反了
 * 整份报告就评错人.
 *
 * @param turns 引擎逐字稿
 * @returns 业务表格式逐字稿
 */
function toTrainingTurns(turns: readonly TranscriptTurn[]): TrainingTranscriptTurn[] {
  return turns.map((turn) => ({
    id: randomUUID(),
    role: turn.role === 'user' ? ChatRole.COUNSELOR : ChatRole.VISITOR,
    text: turn.content,
    timestamp: turn.at,
  }));
}

/**
 * 逐字稿 → 一轮一轮 (咨询师问 + 来访者答) (V2026-11-03, WP23).
 *
 * 落库的逐字稿是**扁平数组** (一问一答两条交替追加), 补漏要的是"一轮"为单位 ——
 * 客户端把一轮补回去, 才是"我问了一句, 它回了一句".
 *
 * 两条硬边界:
 *   · **成对才收**: 落库是两条两条写的, 进程崩在两条之间时会留下**落单**的一条 ——
 *     落单的那条不算一轮 (它没有对应的回答), 丢掉它比凑成一轮更真实;
 *   · **角色必须对上**: 形状不对 (不是 counselor/visitor 交替) 就**停**在那 ——
 *     继续往下猜会把后面的轮次整体错位.
 *
 * @param turns 业务表格式逐字稿
 * @returns 一轮一轮的对话
 */
function pairTranscriptRounds(turns: readonly TrainingTranscriptTurn[]): { userText: string; replyText: string }[] {
  const rounds: { userText: string; replyText: string }[] = [];
  for (let index = 0; index + 1 < turns.length; index += 2) {
    const counselor = turns[index];
    const visitor = turns[index + 1];
    if (!counselor || !visitor) break;
    if (counselor.role !== ChatRole.COUNSELOR || visitor.role !== ChatRole.VISITOR) break;
    rounds.push({ userText: counselor.text, replyText: visitor.text });
  }
  return rounds;
}

/**
 * 读回调试快照数组 (V2026-11-03, WP23).
 *
 * `turn_debug_trace` 是 json 列, 里面的东西**不保证**是我们写进去的那种 ——
 * 别的分支写过 / 手工改过 / 老版本写的, 形状都可能不同. 所以这里逐条校验,
 * 形状不对的直接丢 (宁可少一条, 不要一个坏对象把整轮补漏带歪).
 *
 * @param raw json 列的原始值
 * @returns 形状合法的快照数组
 */
function readTraceArray(raw: unknown): TurnTrace[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is TurnTrace => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as { turnIndex?: unknown; bdiSnapshot?: unknown };
    return typeof candidate.turnIndex === 'number' && typeof candidate.bdiSnapshot === 'object' && candidate.bdiSnapshot !== null;
  });
}

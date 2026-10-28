// V2026-10-21 治本 (V1.2 VS-A — training session 生命周期 service):
//   原因: training_sessions 表自 V1.1 §6.5 起就存在 (25 列 / 5 态状态机 / transcript json),
//     但 **0 service / 0 controller** — 表有数据没人写没人读. v1.2 的 4 个模块全部挂在
//     "会话生命周期 API" 上:
//       - §5.2 知情同意 (要写 informed_consent_* 字段 + 读当前进度)
//       - §6.1 实时轻提示 (要 "每轮 counselor 发言后" 事件源)
//       - §7.1 长程 24h 间隔校验 (要上一节 endedAt)
//       - §10.1 初访分流 (单次结束 / 暂存 / 转长程)
//     没有这层 API, v1.2 只能新建 12 张没有宿主的孤儿表.
//   修法: 6 个 method 一把补齐 (thin delegate 风格, 业务全在本 service):
//     - create        建会话 (只强制 3 个字段, 其余给服务端默认值)
//     - list          我的会话列表 (分页 + 场景/状态过滤)
//     - findDetail    会话详情 (含 transcript)
//     - updateStatus  状态机推进 (合法性走领域守卫 domain/session-status.guard.ts)
//     - appendTranscript 逐字稿写入 (append / replace 双模)
//     - finish        结束会话 + 异步派发督导生成 (BullMQ)
//   治本点 (为什么这么写):
//     - 状态迁移合法性**不写在本 service 的 if 里**, 走 domain/session-status.guard.ts 单一真值源,
//       否则后面 3 个消费方 (client PATCH / BullMQ 收尾 / 长程转档) 会长出 3 份不一致判断
//     - finished 迁移**不走守卫** (守卫表里非终态都能到 finished, 但 finish 端点要能
//       从任意非终态直接收尾), 统一走守卫 + 显式允许
//     - 终态会话拒绝写 transcript: 会话已结束还在追加对话 = 数据不一致
//     - transcript 用 JSON 列整体读写 (不做增量 UPDATE), 单次训练 200 轮以内, 读写成本可接受;
//       增量 UPDATE 要处理 JSON_ARRAY_APPEND 的方言差异, 收益不抵复杂度
//   反双胞胎:
//     - 不加 paused / abandoned 态: V1.1 §4.2.7 明确 5 态 1:1 wire, 不扩 client 契约
//     - 不在 finish 里同步生成督导: 真接 LLM 后单次 30-120s, 同步会拖死 HTTP 连接;
//       改为 BullMQ 异步, client 轮询既有 GET /counselor/supervision/feedback/:sessionId/:sessionType 取结果
//     - 不做自动 commit / push: 提交等大炮指令
//   验证:
//     1. tsc 0 错
//     2. 大炮跑 6 个 endpoint 端到端 (见 docs/progress/v1.2-landing-plan-2026-10-21.md §4.4)
//     3. 非法状态迁移返 400 且带 reason
//   时间戳: 2026-10-21

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { In, IsNull, Repository } from 'typeorm';

import { CounselorSupervisionProcessor } from './counselor-supervision.processor';
import { TurnAnalysisProcessor } from './turn-analysis.processor';
import {
  SUPERVISION_REPORT_REPOSITORY,
  type SupervisionReportRepository,
} from '../../agent/supervisor/domain/repositories/supervision-report.repository';
import type { SupervisionReportRow } from '../../agent/supervisor/supervisor.types';
import { SUPERVISION_MIN_EFFECTIVE_CHARS, SUPERVISION_MIN_EFFECTIVE_TURNS } from '../config/supervision.config';
import { VPT_SCENARIO_ID } from '../config/vpt.config';
import {
  resolveHasMainReportChannel,
  resolveSchoolFeedbackState,
  toSupervisionFailureCode,
  type SchoolFeedbackRow,
  type SessionSchoolFeedbackState,
} from '../domain/session-core/session-core.types';
import { checkSessionTransition, isTerminalSessionStatus } from '../domain/session-status.guard';
import {
  isInsufficientMaterial,
  measureEffectiveMaterial,
  type EffectiveMaterialThresholds,
} from '../domain/session-view/session-material';
import {
  resolveSessionListDurationSeconds,
  resolveSessionListInterrupted,
  resolveSessionListReportAggregate,
  resolveSessionTypeByScenarioId,
} from '../domain/session-view/session-view.types';
import {
  type AppendTranscriptDto,
  type CreateTrainingSessionDto,
  type FinishTrainingSessionDto,
  type FinishTrainingSessionResultDto,
  type TrainingSessionDetailDto,
  type TrainingSessionListItemDto,
  type TrainingSessionListQueryDto,
  type UpdateTrainingSessionStatusDto,
} from '../dto/training-session.dto';
import { SupervisionFeedback } from '../entities/supervision-feedback.entity';
import { SupervisionSchool } from '../entities/supervision-school.entity';
import { TrainingSession, type TrainingTranscriptTurn } from '../entities/training-session.entity';
import { ChatRole } from '../enums/chat-role.enum';
import { DimensionVariance } from '../enums/dimension-variance.enum';
import { SessionType } from '../enums/session-type.enum';
import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { TrainingSessionStatus } from '../enums/training-session-status.enum';
import { VisitorMode } from '../enums/visitor-mode.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

/** 难度 → 计划时长 (分钟), 跟 V0.5 client 1:1 (L1=10 / L2=15 / L3=20). */
const DURATION_BY_DIFFICULTY: Readonly<Record<TrainingDifficulty, number>> = {
  [TrainingDifficulty.L1]: 10,
  [TrainingDifficulty.L2]: 15,
  [TrainingDifficulty.L3]: 20,
};

/** 主诉在列表里的最大展示长度. */
const LIST_COMPLAINT_MAX_LEN = 60;

/**
 * 训练会话生命周期 service.
 */
@Injectable()
export class TrainingSessionService {
  private readonly logger = new Logger(TrainingSessionService.name);

  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    private readonly supervisionProcessor: CounselorSupervisionProcessor,
    // V2026-10-21 治本 (V1.2 VS-C — 每轮分析触发):
    //   原因: v1.2 §6.1「后端在每轮 counselor 发言后, 异步跑一个轻量 classifier」的触发点
    //     就在这个端点 (逐字稿是唯一知道"新来了哪一轮"的地方).
    private readonly turnAnalysisProcessor: TurnAnalysisProcessor,
    // V2026-10-27 治本 (练习历史列表 — 报告聚合):
    //   原因: 列表项要显示"报告状态 / 总分", 报告行在 agent 侧的 supervision_reports 表,
    //     仓储出口是 SUPERVISION_REPORT_REPOSITORY (SupervisorModule 导出, AgentModule 转出,
    //     CounselorModule 已 import AgentModule) —— 跟 supervision.service 读的是同一份数据,
    //     两处口径不会漂移.
    @Inject(SUPERVISION_REPORT_REPOSITORY)
    private readonly reportRepo: SupervisionReportRepository,
    // V2026-10-27 治本 (spec 任务 C — 空局 / 失败终态的列表派生):
    //   列表的"报告状态"不再只看主报告行 —— 单次训练场景**没有**主报告链路
    //   (主报告由 voice 侧 endSession 产出, 只覆盖 vpt), 它的报告内容就是这份
    //   4 流派反馈. 不读它, 单次训练永远是 pending → 5 分钟后被误判成"生成失败".
    @InjectRepository(SupervisionFeedback)
    private readonly feedbackRepo: Repository<SupervisionFeedback>,
    // 流派码查表 (反馈行存的是 schoolId, 列表要按流派码归并).
    @InjectRepository(SupervisionSchool)
    private readonly schoolRepo: Repository<SupervisionSchool>,
    // 全局配置 (最小可分析量阈值 / 陈旧 pending 兜底阈值).
    private readonly config: ConfigService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // 1. create — 建会话
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/training-sessions 主入口.
   *
   * @param userId 当前用户 id
   * @param input 创建输入 (只强制 scenarioId / personaName / personaComplaint)
   * @returns 新建会话详情
   */
  async create(userId: string, input: CreateTrainingSessionDto): Promise<TrainingSessionDetailDto> {
    const difficulty = input.difficulty ?? TrainingDifficulty.L1;
    const entity = this.sessionRepo.create({
      // V0.x: tenantId = userId (一人一租户, A9). V1.x 多租户上线后 backfill.
      tenantId: userId,
      userId,
      scenarioId: input.scenarioId,
      difficulty,
      durationMinutes: input.durationMinutes ?? DURATION_BY_DIFFICULTY[difficulty],
      status: TrainingSessionStatus.IDLE,
      personaName: input.personaName,
      personaAge: input.personaAge ?? 28,
      personaOccupation: input.personaOccupation ?? '',
      personaComplaint: input.personaComplaint,
      personaBackground: input.personaBackground ?? '',
      visitorStyle: input.visitorStyle ?? VisitorStyle.MIXED,
      emotionBaseline: input.emotionBaseline ?? 0.5,
      defenseLevel: input.defenseLevel ?? 0.3,
      // randomSeed 服务端生成 (跟 V0.5 client 的 'YYYY-MM-DD-HH-mm-ss-{0-99}' 格式一致),
      // 保证「同 seed → 同来访者行为」在服务端也能复现.
      randomSeed: this.generateRandomSeed(),
      mode: input.mode ?? VisitorMode.USE_MY_SETTINGS,
      styleVariance: input.styleVariance ?? DimensionVariance.MEDIUM,
      emotionVariance: input.emotionVariance ?? DimensionVariance.MEDIUM,
      defenseVariance: input.defenseVariance ?? DimensionVariance.MEDIUM,
      transcript: [],
      supervisionReportId: null,
      startedAt: null,
      endedAt: null,
    });
    const saved = await this.sessionRepo.save(entity);
    return this.toDetail(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. list — 我的会话列表
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/training-sessions 主入口.
   *
   * V2026-10-27 治本 (练习历史列表 — 聚合字段 + 类型过滤):
   *   原因: 成长 tab「练习历史」二级页要在一张卡上同时显示"会话类型 / 报告状态 / 总分 /
   *     是否中断", 而这些全是**派生值** (库里没有对应列), 之前列表接口一个都不下发.
   *   修法: 列表项补 4 个派生字段 (判定集中在 domain/session-view/session-view.types.ts);
   *     报告状态用**一次批量查询**取回本页会话的报告行 (禁止逐行查 → N+1).
   *   反双胞胎:
   *     - 不用 `Promise.all(rows.map(r => findBySessionId(...)))`: 那还是 N+1, 只是并发化,
   *       DB 往返次数没变; 走仓储的批量出口.
   *     - 不用 find-options 的 where 对象: 「scenarioId != vpt_voice」与「scenarioId = 场景」
   *       两个条件落在**同一列**上, 对象写法表达不了 (后者会覆盖前者), 改 QueryBuilder.
   *   @param userId 当前用户 id
   * @param query 过滤 + 分页
   * @returns 倒序会话列表
   */
  async list(userId: string, query: TrainingSessionListQueryDto): Promise<TrainingSessionListItemDto[]> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const rows = await this.findListRows(userId, query, page, pageSize);
    // 报告行一次批量取回 (按会话自己的 tenant 分组, 口径与 supervision.service.getSessionReport 一致).
    const reports = await this.loadReportsBySessionId(rows);
    // 4 流派反馈也一次批量取回 (单次训练的唯一报告内容来源; 失败终态也在这张表里).
    const feedbackStates = await this.loadFeedbackStatesBySessionId(userId, rows);
    const thresholds = this.materialThresholds();
    return rows.map((row) => this.toListItem(row, reports.get(row.id) ?? null, feedbackStates.get(row.id) ?? null, thresholds));
  }

  /**
   * 查我的会话行 (分页 + 过滤 + 排序 + 排除空会话).
   *
   * @param userId 当前用户 id
   * @param query 过滤 + 分页
   * @param page 页码 (从 1 开始)
   * @param pageSize 每页条数
   * @returns 会话行 (已按 createdAt 倒序)
   */
  private async findListRows(
    userId: string,
    query: TrainingSessionListQueryDto,
    page: number,
    pageSize: number,
  ): Promise<TrainingSession[]> {
    const qb = this.sessionRepo.createQueryBuilder('s');
    // 归属: 只返当前 userId 自己的记录 (跨用户不可见).
    qb.where('s.userId = :userId', { userId }).andWhere('s.deletedAt IS NULL');
    if (query.scenarioId) {
      qb.andWhere('s.scenarioId = :scenarioId', { scenarioId: query.scenarioId });
    }
    if (query.status) {
      qb.andWhere('s.status = :status', { status: query.status });
    }
    // sessionType 映射到 scenarioId (表内无独立 type 列):
    //   vpt_voice → scenarioId = 'vpt_voice'; training_session → scenarioId != 'vpt_voice'.
    // 与显式的 scenarioId 过滤**叠加** (两个条件都成立才命中), 不会互相覆盖.
    if (query.sessionType === SessionType.VPT_VOICE) {
      qb.andWhere('s.scenarioId = :vptScenarioId', { vptScenarioId: VPT_SCENARIO_ID });
    } else if (query.sessionType === SessionType.TRAINING_SESSION) {
      qb.andWhere('s.scenarioId != :vptScenarioId', { vptScenarioId: VPT_SCENARIO_ID });
    }
    // 排除"建了没开过"的空会话 (status=idle && startedAt IS NULL && 无对话轮次).
    // 放在 SQL 层而不是内存过滤: 内存过滤会让每页返回行数不足 pageSize, 而前端用
    // "本页行数 == pageSize" 判断还有没有下一页 → 会出现"翻不到底"的断页.
    // JSON_LENGTH 是 MySQL 函数 (本项目 DB 固定 MySQL 8.0; 其它方言需换 json_array_length).
    // COALESCE 兜底: transcript 若是 NULL (老数据/手工插入), JSON_LENGTH 返回 NULL,
    //   而 `NULL = 0` 是 NULL (非 true) → 会被误判成"有对话"而不被排除. 显式兜底成 0.
    qb.andWhere('NOT (s.status = :idleStatus AND s.startedAt IS NULL AND COALESCE(JSON_LENGTH(s.transcript), 0) = 0)', {
      idleStatus: TrainingSessionStatus.IDLE,
    });
    return qb
      .orderBy('s.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();
  }

  /**
   * 批量取本页会话的报告行 (sessionId → 报告行).
   *
   * 按**会话自己的 tenant** 分组: 同一页里可能同时存在 vpt 会话 (tenant 来自 WS 会话)
   * 与 REST 建的会话 (tenant = userId), 报告行的 tenant 必须跟会话行一致 —— 跟
   * supervision.service.getSessionReport 的 `row.tenantId` 口径相同.
   * 分组数是"页内不同 tenant 数" (实际 ≤ 2), 不是"行数" → 仍然是批量, 不是 N+1.
   *
   * @param rows 本页会话行
   * @returns sessionId → 报告行 (无报告的会话不在 Map 里)
   */
  private async loadReportsBySessionId(rows: TrainingSession[]): Promise<Map<string, SupervisionReportRow>> {
    const result = new Map<string, SupervisionReportRow>();
    const idsByTenant = new Map<string, string[]>();
    for (const row of rows) {
      const ids = idsByTenant.get(row.tenantId);
      if (ids) {
        ids.push(row.id);
      } else {
        idsByTenant.set(row.tenantId, [row.id]);
      }
    }
    for (const [tenantId, sessionIds] of idsByTenant) {
      const found = await this.reportRepo.findBySessionIds(tenantId, sessionIds);
      for (const [sessionId, report] of found) {
        result.set(sessionId, report);
      }
    }
    return result;
  }

  /**
   * 批量取本页会话的 4 流派反馈状态 (sessionId → 反馈状态).
   *
   * V2026-10-27 治本 (spec 任务 C/D — 列表派生补 4 流派反馈):
   *   原因: 单次训练场景**没有**主报告链路 (主报告由 voice 侧 `endSession` 产出, 只覆盖 vpt),
   *     它的报告内容就是这份 4 流派反馈; 失败终态 (带 failureCode 的那行) 也在这张表里.
   *     不读它 → 单次训练永远 pending → 5 分钟后被误判成"生成失败".
   *   修法: 一次 `sessionId IN (...)` 批量取回 (禁止逐行查 → N+1), 按会话聚合成状态.
   *   口径与 supervision.service.getSessionReport 一致: 失败优先于成功, 分数取默认流派 (CBT).
   *
   * @param userId 当前用户 id
   * @param rows 本页会话行
   * @returns sessionId → 反馈状态 (无反馈的会话不在 Map 里)
   */
  private async loadFeedbackStatesBySessionId(userId: string, rows: TrainingSession[]): Promise<Map<string, SessionSchoolFeedbackState>> {
    const result = new Map<string, SessionSchoolFeedbackState>();
    if (rows.length === 0) {
      return result;
    }
    const sessionIds = rows.map((r) => r.id);
    const feedbacks = await this.feedbackRepo.find({
      where: { userId, sessionId: In(sessionIds), deletedAt: IsNull() },
    });
    if (feedbacks.length === 0) {
      return result;
    }
    // 流派码: schoolId → code (反馈行存的是 schoolId).
    const schools = await this.schoolRepo.find({ where: { deletedAt: IsNull() } });
    const codeBySchoolId = new Map(schools.map((s) => [s.id, s.code]));
    // 按会话分组 → 每组交给 domain 判定 (`resolveSchoolFeedbackState`):
    //   口径与详情端**共用一份**, 这里不再写一遍"选默认流派 / 取码序最前" ——
    //   两份判定必然漂移 (列表说 78 分、详情说 80 分, 学员看到两张打架的卡片).
    const rowsBySession = new Map<string, SchoolFeedbackRow[]>();
    for (const fb of feedbacks) {
      const feedbackRow: SchoolFeedbackRow = {
        schoolCode: codeBySchoolId.get(fb.schoolId) ?? null,
        overallScore: fb.feedback.overallScore,
        failureCode: toSupervisionFailureCode(fb.feedback?.failureCode),
      };
      const list = rowsBySession.get(fb.sessionId);
      if (list) {
        list.push(feedbackRow);
      } else {
        rowsBySession.set(fb.sessionId, [feedbackRow]);
      }
    }
    for (const [sessionId, feedbackRows] of rowsBySession) {
      const state = resolveSchoolFeedbackState(feedbackRows);
      if (state) {
        result.set(sessionId, state);
      }
    }
    return result;
  }

  /**
   * 最小可分析量阈值 (从 config 读; 缺失时用 config 模块的默认值).
   *
   * @returns 阈值
   */
  private materialThresholds(): EffectiveMaterialThresholds {
    return {
      minTurns: this.config.get<number>('supervision.minEffectiveTurns') ?? SUPERVISION_MIN_EFFECTIVE_TURNS,
      minChars: this.config.get<number>('supervision.minEffectiveChars') ?? SUPERVISION_MIN_EFFECTIVE_CHARS,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. findDetail — 会话详情
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /counselor/training-sessions/:id 主入口.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @throws NotFoundException 不存在 / 不属于当前用户
   */
  async findDetail(userId: string, sessionId: string): Promise<TrainingSessionDetailDto> {
    const row = await this.loadSession(userId, sessionId);
    return this.toDetail(row);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. updateStatus — 状态机推进
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * PATCH /counselor/training-sessions/:id/status 主入口.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param input 目标状态
   * @returns 更新后的会话详情
   * @throws BadRequestException 非法状态迁移 (带 reason)
   */
  async updateStatus(userId: string, sessionId: string, input: UpdateTrainingSessionStatusDto): Promise<TrainingSessionDetailDto> {
    const row = await this.loadSession(userId, sessionId);
    const check = checkSessionTransition(row.status, input.status);
    if (!check.allowed) {
      throw new BadRequestException(check.reason);
    }

    row.status = input.status;
    // 首次进入 listening 时打 startedAt (计时起点), 迁到 finished 时打 endedAt.
    if (input.status === TrainingSessionStatus.LISTENING && row.startedAt === null) {
      row.startedAt = new Date();
    }
    if (input.status === TrainingSessionStatus.FINISHED) {
      row.endedAt = row.endedAt ?? new Date();
    }
    const saved = await this.sessionRepo.save(row);
    return this.toDetail(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. appendTranscript — 逐字稿写入
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * PATCH /counselor/training-sessions/:id/transcript 主入口.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param input 本批消息 + 写入模式
   * @returns 更新后的会话详情
   * @throws BadRequestException 会话已结束 (终态不可再追加对话)
   */
  async appendTranscript(userId: string, sessionId: string, input: AppendTranscriptDto): Promise<TrainingSessionDetailDto> {
    const row = await this.loadSession(userId, sessionId);
    if (isTerminalSessionStatus(row.status)) {
      throw new BadRequestException(`会话 ${sessionId} 已结束 (状态 ${row.status}), 不能继续追加对话记录`);
    }

    const incoming: TrainingTranscriptTurn[] = input.turns.map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      timestamp: t.timestamp,
      ...(t.isTyping === undefined ? {} : { isTyping: t.isTyping }),
    }));
    const current = row.transcript ?? [];
    row.transcript = input.mode === 'replace' ? incoming : [...current, ...incoming];
    const saved = await this.sessionRepo.save(row);

    // V2026-10-21 治本 (V1.2 VS-C — 触发每轮分析):
    //   原因: §6.1 实时轻提示 + §6.4 移情阻抗标记的触发点是"新来了一轮来访者回应".
    //     咨询师发言本身不足以判定 (提示要看来访者的反应, 标记也是打在来访者轮次上),
    //     所以只在**来访者那一轮**落库后触发.
    //   修法: 入队 BullMQ job (异步, 不阻塞本次写请求); 档位判定在 worker 里做 (关掉提示就不烧 LLM).
    //   反双胞胎:
    //     - 不用 fire-and-forget 直调 LLM: 进程重启就丢, 且会拖住写请求
    //     - 不在咨询师那一轮触发: 没有来访反应就没有可分析的信号, 只会白烧 token
    //     - 入队失败不抛: 逐字稿已经写成功 (业务已完成), 分析失败只是少一条提示, 不能让整个写请求 500
    await this.enqueueTurnAnalysis(userId, saved, row.transcript);
    return this.toDetail(saved);
  }

  /**
   * 若本轮新写入的是**来访者**的回应 → 入队一次每轮分析.
   *
   * @param userId 当前用户 id
   * @param saved 已保存的会话行
   * @param transcript 保存后的完整逐字稿
   */
  private async enqueueTurnAnalysis(userId: string, saved: TrainingSession, transcript: TrainingTranscriptTurn[]): Promise<void> {
    if (transcript.length === 0) {
      return;
    }
    const lastTurn = transcript.at(-1);
    if (!lastTurn || lastTurn.role !== ChatRole.VISITOR) {
      return;
    }
    const enqueued = await this.turnAnalysisProcessor.enqueue({
      sessionId: saved.id,
      userId,
      turnIndex: transcript.length - 1,
    });
    if (!enqueued) {
      this.logger.warn(`[turn_analysis_enqueue_failed] session=${saved.id} turn=${transcript.length - 1}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. finish — 结束会话 + 异步派发督导生成
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/training-sessions/:id/finish 主入口.
   *
   * V2026-10-27 治本 (spec 任务 B — 结束前置拦截):
   *   旧实现无条件派发督导 job → 空素材抛永久失败 → **不落任何报告行** → 列表把它
   *   误判成 pending (永久"生成中") → 学员永远等不到.
   *   新实现: 写 `finished` **之前**先量素材:
   *     · 素材不足 (空局) → **不派 job** (不烧永久失败、不刷 warn、不堆队列),
   *       会话仍置 finished + 写 endedAt (记录保留, D4), 响应直接带 `no_content`
   *     · 素材充足 → 维持原行为 (queued → completed / parse_error)
   *   注: `no_content` 是**派生**状态 (finished + 素材不足 + 无报告行), 不新增 DB 列、
   *   不写 migration —— 结束响应只是实时把结果告诉前端, 落库口径仍走派生.
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @param input 可选 schoolCode (缺省 CBT)
   * @returns 结束结果 + 督导派发状态
   * @throws BadRequestException 会话已结束
   */
  async finish(userId: string, sessionId: string, input: FinishTrainingSessionDto): Promise<FinishTrainingSessionResultDto> {
    const row = await this.loadSession(userId, sessionId);
    if (isTerminalSessionStatus(row.status)) {
      throw new BadRequestException(`会话 ${sessionId} 已结束 (状态 ${row.status}), 不能重复结束`);
    }

    const check = checkSessionTransition(row.status, TrainingSessionStatus.FINISHED);
    if (!check.allowed) {
      throw new BadRequestException(check.reason);
    }

    // 结束前置拦截: 素材量必须在写 finished **之前**算 (逐字稿在这行上).
    const material = measureEffectiveMaterial(row.transcript);
    const insufficient = isInsufficientMaterial(material, this.materialThresholds());

    row.status = TrainingSessionStatus.FINISHED;
    row.endedAt = row.endedAt ?? new Date();
    await this.sessionRepo.save(row);

    const schoolCode = input.schoolCode ?? SupervisionSchoolCode.CBT;

    // 空局: 不派 job. 记录保留 (D4), 报告状态派生为 `no_content`.
    if (insufficient) {
      this.logger.log(
        `[finish] empty_session_no_supervision sessionId=${row.id} ` +
          `effectiveTurns=${material.effectiveTurns} effectiveChars=${material.effectiveChars}`,
      );
      return {
        sessionId: row.id,
        status: row.status,
        endedAt: row.endedAt,
        supervision: {
          schoolCode,
          status: 'no_content',
        },
      };
    }

    const enqueued = await this.supervisionProcessor.enqueue({
      sessionId: row.id,
      sessionType: SessionType.TRAINING_SESSION,
      schoolCode,
      userId,
      tenantId: row.tenantId,
    });

    return {
      sessionId: row.id,
      status: row.status,
      endedAt: row.endedAt,
      supervision: {
        schoolCode,
        status: enqueued ? 'queued' : 'enqueue_failed',
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 私有 helper
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 取 1 个属于当前用户的会话 (软删过滤).
   *
   * @param userId 当前用户 id
   * @param sessionId 会话 id
   * @throws NotFoundException 不存在 / 不属于当前用户
   */
  private async loadSession(userId: string, sessionId: string): Promise<TrainingSession> {
    const row = await this.sessionRepo.findOne({
      where: { id: sessionId, userId, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException(`训练会话 ${sessionId} 不存在或不属于当前用户`);
    }
    return row;
  }

  /**
   * 生成 randomSeed (跟 V0.5 client 'YYYY-MM-DD-HH-mm-ss-{0-99}' 格式一致).
   *
   * V2026-10-21 治本 (V1.2 VS-A 第 2 轮 lint 修复 — sonarjs/pseudo-random):
   *   原因: 原实现用 `Math.random()` 生成 0-99 后缀, ESLint sonarjs/pseudo-random 报 error
   *     ("Make sure that using this pseudorandom number generator is safe here") —
   *     Math.random 是**非密码学安全**的伪随机源, 种子可被观测输出反推.
   *   修法: 改用 node:crypto 的 randomInt(0, 100) ——
   *     - 密码学安全, 满足规则的根治要求
   *     - node 内置模块, **0 新依赖** (大炮红线: 不自动装包)
   *     - 跟仓库既有范式一致 (src/profile/providers/companion-binding.service.ts:198 邀请码、
   *       src/auth/login-code.service.ts 验证码, 都是 randomInt 替 Math.random)
   *   反双胞胎:
   *     - 不写 `// eslint-disable-next-line sonarjs/pseudo-random`: 仓库里有 4 处历史 disable,
   *       那是压错不是治本, 新代码不复制这个坏习惯
   *     - 不用确定性 hash (djb2) 替随机源: randomSeed 的语义是"给本次会话的来访者行为
   *       定一个不可预测的种子", 不是"同输入同输出"的 mock 分数 (那个场景才用 hash, 见
   *       supervision.service.ts 旧版 mockRandomScore)
   *     - 不用 Math.random().toString().slice(): 既有精度问题又没过规则
   *   验证:
   *     1. pnpm lint 0 错
   *     2. 大炮建 2 个会话 → randomSeed 后缀不同 (0-99 均匀分布)
   *   时间戳: 2026-10-21 14:45 GMT+8
   */
  private generateRandomSeed(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const base =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    // randomInt 的 max 是开区间 → randomInt(0, 100) 产出 0-99 闭区间, 跟 V0.5 client 格式一致.
    const suffix = String(randomInt(0, 100)).padStart(2, '0');
    return `${base}-${suffix}`;
  }

  /**
   * entity → 详情 DTO.
   *
   * @param row training_sessions 表行
   */
  private toDetail(row: TrainingSession): TrainingSessionDetailDto {
    return {
      id: row.id,
      scenarioId: row.scenarioId,
      status: row.status,
      difficulty: row.difficulty,
      durationMinutes: row.durationMinutes,
      personaName: row.personaName,
      personaAge: row.personaAge,
      personaOccupation: row.personaOccupation,
      personaComplaint: row.personaComplaint,
      personaBackground: row.personaBackground,
      visitorStyle: row.visitorStyle,
      emotionBaseline: row.emotionBaseline,
      defenseLevel: row.defenseLevel,
      mode: row.mode,
      transcript: (row.transcript ?? []).map((t) => ({
        id: t.id,
        role: t.role,
        text: t.text,
        timestamp: t.timestamp,
        ...(t.isTyping === undefined ? {} : { isTyping: t.isTyping }),
      })),
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * entity → 列表项 DTO (不含 transcript, 减少流量).
   *
   * V2026-10-27 治本 (练习历史列表 — 聚合字段):
   *   原因: 列表项要显示"报告状态 / 总分 / 是否中断", 这些是派生值, 判定统一放
   *     domain/session-view/session-view.types.ts (纯函数, 可单测).
   *   修法: 本方法只做"取数 + 填形状", 不做任何状态判定.
   *   反双胞胎: 不在这里 inline 写 if 判定 (两处口径必然漂移 —— 列表说 pending、
   *     报告页说 parse_error, 学员看到的是自相矛盾的卡片).
   *
   * @param row training_sessions 表行
   * @param report 该会话的报告行 (无报告时为 null)
   */
  private toListItem(
    row: TrainingSession,
    report: SupervisionReportRow | null,
    schoolFeedback: SessionSchoolFeedbackState | null,
    thresholds: EffectiveMaterialThresholds,
  ): TrainingSessionListItemDto {
    const turnCount = (row.transcript ?? []).length;
    const sessionType = resolveSessionTypeByScenarioId(row.scenarioId, VPT_SCENARIO_ID);
    const aggregate = resolveSessionListReportAggregate({
      report,
      sessionStatus: row.status,
      material: measureEffectiveMaterial(row.transcript),
      thresholds,
      schoolFeedback,
      // vpt 有主报告链路 → 4 流派反馈只是附加, 不决定整体状态 (vpt 适用范围隔离).
      hasMainReportChannel: resolveHasMainReportChannel(sessionType),
    });
    return {
      id: row.id,
      scenarioId: row.scenarioId,
      status: row.status,
      difficulty: row.difficulty,
      personaName: row.personaName,
      personaComplaint:
        row.personaComplaint.length > LIST_COMPLAINT_MAX_LEN
          ? `${row.personaComplaint.slice(0, LIST_COMPLAINT_MAX_LEN)}…`
          : row.personaComplaint,
      turnCount,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      createdAt: row.createdAt,
      sessionType,
      reportStatus: aggregate.reportStatus,
      overallScore: aggregate.overallScore,
      reportReady: aggregate.reportReady,
      failureCode: aggregate.failureCode,
      retryable: aggregate.retryable,
      interrupted: resolveSessionListInterrupted({ status: row.status, startedAt: row.startedAt, turnCount }),
      durationSeconds: resolveSessionListDurationSeconds(row.startedAt, row.endedAt),
    };
  }
}

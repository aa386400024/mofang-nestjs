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

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';

import { CounselorSupervisionProcessor } from './counselor-supervision.processor';
import { checkSessionTransition, isTerminalSessionStatus } from '../domain/session-status.guard';
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
import { TrainingSession, type TrainingTranscriptTurn } from '../entities/training-session.entity';
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
  constructor(
    @InjectRepository(TrainingSession)
    private readonly sessionRepo: Repository<TrainingSession>,
    private readonly supervisionProcessor: CounselorSupervisionProcessor,
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
   * @param userId 当前用户 id
   * @param query 过滤 + 分页
   * @returns 倒序会话列表
   */
  async list(userId: string, query: TrainingSessionListQueryDto): Promise<TrainingSessionListItemDto[]> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const rows = await this.sessionRepo.find({
      where: {
        userId,
        deletedAt: IsNull(),
        ...(query.scenarioId ? { scenarioId: query.scenarioId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return rows.map((r) => this.toListItem(r));
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
    return this.toDetail(saved);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. finish — 结束会话 + 异步派发督导生成
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /counselor/training-sessions/:id/finish 主入口.
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
    row.status = TrainingSessionStatus.FINISHED;
    row.endedAt = row.endedAt ?? new Date();
    await this.sessionRepo.save(row);

    const schoolCode = input.schoolCode ?? SupervisionSchoolCode.CBT;
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
   * @param row training_sessions 表行
   */
  private toListItem(row: TrainingSession): TrainingSessionListItemDto {
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
      turnCount: (row.transcript ?? []).length,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      createdAt: row.createdAt,
    };
  }
}

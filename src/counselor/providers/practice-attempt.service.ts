// V2026-10-22 治本 (V1.3 §3.3 / §3.5 / §7.5 / §8.5 B1 / §8.5 E1 — 练习作答写入侧 service):
//   原因: §3.3 的"提交作答"不是单纯 insert —— 它要串起 5 件事:
//     ① 算清"这是本场景第几次作答" (attemptOrdinal, 决定批注侧重点轮换)
//     ② 语音引擎折算语速 (字/分)
//     ③ P2 多轮时把此前轮次还原成转写, 供评判时读上下文
//     ④ 落库 (零压批注 JSON) 并返回契约要求的形状
//     ⑤ §7.6 P3-c: 把本次信号回写五维画像
//     另加 §3.5 的私有场景生成 (转交 PracticeCustomScenarioService).
//   修法: 本 service 负责**编排**, 判定逻辑全部在 PracticeEvaluatorService;
//     场景可见性判定全部在 PracticeScenarioService; 私有场景的生成/落库全部在
//     PracticeCustomScenarioService —— 四层职责不交叉.
//
//   V2026-10-22 治本 (V1.3 §7.5 — 场景视图化):
//     本 service 现在只认 `PracticeScenarioView` (领域视图), 不认 TypeORM entity.
//     场景有两个物理来源 (共享库 / 私有库), 视图把差异收敛在投影处, 上层零分支.
//
//   V2026-10-22 治本 (§8.5 E1 — 取号原子化):
//     原因: 原来的 `attemptOrdinal = count() 再 insert` 存在竞态:
//       两个并发请求 (用户双击提交) 会同时 count 到 N, 都拿到 N+1,
//       于是两条记录的"第几次作答"序号相同 —— 批注侧重点轮换随之错乱.
//     修法: 取号与落库放进**同一个短事务**, 事务内用悲观写锁
//       (SELECT ... FOR UPDATE) 锁住该 (user, scenario) 的行区间:
//       - InnoDB 的间隙锁会让同一区间的并发插入**串行化**, 第二个请求等第一个提交完
//         再取号 → 拿到 N+2, 序号连续且唯一
//       - 事务里**不含** LLM 调用 (评判在事务外已完成), 所以锁只持有毫秒级,
//         不会因为 60s 的模型耗时而占着连接和锁
//       - 数据库侧另有 UNIQUE (user_id, scenario_id, attempt_ordinal) 兜底 (见 entity)
//     注意: 评判用的 ordinal 是**事务外**的预估值, 落库时用事务内取到的真值,
//       两者在无并发时完全一致; 并发时最多差 1, 只影响批注侧重点的轮换档位,
//       不影响任何数据正确性 (落库序号唯一且连续).
//
//   V2026-10-22 治本 (§8.5 B1 — turn 越界校验):
//     原因: DTO 只校验 `1..5`, 没校验 `≤ 场景.expectedTurns`.
//       单轮场景 (expectedTurns=1) 收到 turn=2 时, 语义不一致 ——
//       服务端会去找第 1 轮的历史, 但那一轮本来就不存在.
//     修法: service 层比对 `turn ≤ expectedTurns`, 越界抛 400.
//     为什么放 service 不放 DTO: DTO 不知道场景的 expectedTurns (那是数据, 不是入参).
//
//   反双胞胎:
//     - 不在 service 里重新实现可见性判定: 可见性谓词只有一处 (scenario service),
//       重复实现必然漂移出"能看到但取不到"或"取得到但看不到"的裂缝
//     - 不在 attempt 表存分数列: 零压红线的**结构性**保证 (见 entity 注释);
//       画像信号走 ability_scores, 不回灌本表
//     - 不用 quota 扣减拦评判: spec §4 要求"AI 评判调用走现有配额体系, 不新建",
//       但现有 QuotaType 只有 3 类 (voice_session / long_term_case / voice_analysis),
//       没有"AI 评判"这一类, 且 QuotaType 与客户端 1:1 wire 不能随意加值;
//       且 BillingService.consumeQuota 在当前 NONE 档下 limit=0 会直接抛错 ——
//       硬接会让练习端点 100% 不可用. 故本轮不扣配额, 改用
//       PRACTICE_LLM_EVALUATION 开关做流量/成本控制, 配额在会员档位体系落地后接.
//     - 不用"先落库再评判"的顺序: 评判失败时库里会留下无批注的脏记录
//
//   验证:
//     1. tsc 0 错
//     2. 同一场景连评 3 次 → attemptOrdinal 依次为 1 / 2 / 3, 批注侧重点轮换
//     3. 语音引擎提交 recordSeconds=60 + 60 字文本 → 落库 speech_rate_wpm = 60
//     4. LLM 不可用 → 依然 200, 落库 feedback.source = 'keyword'
//     5. 并发双击同场景 → 两条记录的 attempt_ordinal 不同 (1 / 2), 无唯一键冲突
//     6. 单轮场景提交 turn=2 → 400
//     7. 私有场景提交作答 → attempt.scenario_source = 'custom'
//
//   时间戳: 2026-10-22
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import { PracticeAbilitySyncService } from './practice-ability-sync.service';
import { PracticeCustomScenarioService } from './practice-custom-scenario.service';
import { PracticeEvaluatorService } from './practice-evaluator.service';
import { PracticeScenarioService } from './practice-scenario.service';
import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { engineOfMode } from '../config/practice-display-meta';
import type { PracticeFeedback, PracticeTurn } from '../domain/practice/practice.types';
import type {
  CreateCustomPracticeScenarioDto,
  CustomPracticeScenarioResultDto,
  PracticeEvaluationResultDto,
  PracticeFeedbackDto,
  SubmitPracticeAttemptDto,
} from '../dto/practice.dto';
import { PracticeAttempt } from '../entities/practice-attempt.entity';
import { PracticeEngine } from '../enums/practice-engine.enum';
import { PRACTICE_FEEDBACK_TONE_ICONS } from '../enums/practice-feedback-tone.enum';

/**
 * 微技能练习 —— 作答写入侧 service.
 */
@Injectable()
export class PracticeAttemptService {
  private readonly logger = new Logger(PracticeAttemptService.name);

  constructor(
    private readonly scenarioService: PracticeScenarioService,
    private readonly evaluator: PracticeEvaluatorService,
    private readonly customScenarioService: PracticeCustomScenarioService,
    private readonly abilitySync: PracticeAbilitySyncService,
    @InjectRepository(PracticeAttempt)
    private readonly attemptRepo: Repository<PracticeAttempt>,
  ) {}

  // ══════════════════════════════════════════════════════════════════════
  // §3.3 提交作答 + 评判
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 提交一次作答, 产出零压批注并落库.
   *
   * @param userId 当前用户 id
   * @param scenarioId 场景 id
   * @param dto 作答内容
   * @returns 练习记录 id + 批注
   */
  async submit(userId: string, scenarioId: string, dto: SubmitPracticeAttemptDto): Promise<PracticeEvaluationResultDto> {
    const scenario = await this.scenarioService.findVisibleScenario(userId, scenarioId);
    const engine = engineOfMode(scenario.exerciseMode);
    const turn = dto.turn ?? 1;

    // §8.5 B1: turn 不得越过场景期望的往返轮数.
    //   用专用 BizCode 而不是裸 BadRequestException: 前端要能分辨
    //   "这一轮不支持" (用户可退回上一轮) 与 "参数不合法" (要改请求).
    if (turn > scenario.expectedTurns) {
      throw new BizException(
        BizCode.PracticeTurnOutOfRange,
        `本场景只支持 ${scenario.expectedTurns} 轮往返, 收到第 ${turn} 轮 (超出场景设定)`,
      );
    }

    // 取号的**预估值** (仅用于决定批注侧重点; 真值在落库事务里取, 见类注释 §8.5 E1).
    const estimatedOrdinal = (await this.scenarioService.countAttempts(userId, scenarioId)) + 1;

    // 语音引擎: 折算语速 (字/分). 转写文本为空时不算 —— 没有文本就没有"字"可数.
    const speechRateWpm = this.computeSpeechRate(engine, dto.submittedText, dto.recordSeconds);

    // P2 多轮: 还原此前轮次的转写 (供评判读上下文)
    const transcript = await this.buildTranscript(userId, scenario, turn);

    const feedback = await this.evaluator.evaluate({
      scenario,
      engine,
      attemptOrdinal: estimatedOrdinal,
      submittedText: dto.submittedText,
      speechRateWpm,
      recordSeconds: dto.recordSeconds ?? null,
      transcript,
      userId,
      tenantId: userId, // A9 一人一租户
    });

    // P2 多轮: 本轮回应之后, 让 AI 来访者给一个情绪反应 (下一轮的气泡内容).
    // 生成失败不影响主链路 —— 反应缺失只意味着下一轮少一句, 不该让本次作答白做.
    let visitorReaction: string | null = null;
    if (engine === PracticeEngine.AI_RESPONSE && turn < scenario.expectedTurns) {
      visitorReaction = await this.evaluator.generateVisitorReaction({
        scenario,
        counselorText: dto.submittedText,
        transcript,
        userId,
        tenantId: userId,
      });
    }

    const feedbackWithReaction: PracticeFeedback = { ...feedback, visitorReaction };

    // §8.5 E1: 取号 + 落库在**同一个短事务**里完成 (锁区间, 序号唯一且连续).
    const saved = await this.persistAttemptWithOrdinal({
      userId,
      scenarioId: scenario.scenarioId,
      scenarioSource: scenario.source,
      submittedText: dto.submittedText,
      recordSeconds: dto.recordSeconds ?? null,
      speechRateWpm,
      feedback: feedbackWithReaction,
      durationSeconds: dto.durationSeconds,
      turn,
    });

    // §7.6 P3-c: 回写五维画像 (失败不影响本次作答的结果).
    await this.abilitySync.syncFromAttempt(userId, scenario.exerciseMode, feedbackWithReaction, saved.id);

    this.logger.log(
      `[practice_attempt_saved] user=${userId} scenario=${scenario.scenarioId} source=${scenario.source} ` +
        `turn=${turn} ordinal=${saved.attemptOrdinal} feedbackSource=${feedbackWithReaction.source}`,
    );

    return {
      attemptId: saved.id,
      feedback: this.toFeedbackDto({ ...feedbackWithReaction, attemptOrdinal: saved.attemptOrdinal }),
    };
  }

  /**
   * 领域反馈 → 出参 DTO.
   *
   * 图标 (✅/⚠️/ℹ️) 在**出参层**补, 不进落库 JSON: 图标是展示元数据,
   * 客户端不该自己维护一份映射 (双份映射必然漂移), 也不该让存储层关心长相.
   */
  private toFeedbackDto(feedback: PracticeFeedback): PracticeFeedbackDto {
    return {
      items: feedback.items.map((item) => ({
        ...item,
        icon: PRACTICE_FEEDBACK_TONE_ICONS[item.tone],
      })),
      referenceResponse: feedback.referenceResponse,
      commonPitfalls: feedback.commonPitfalls,
      attemptOrdinal: feedback.attemptOrdinal,
      source: feedback.source,
      visitorReaction: feedback.visitorReaction,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // §3.5 用户真实场景生成 (P3) —— 转交私有场景 service
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 把用户描述的真实情况生成成一条**私有**场景 (§3.5 旧契约入口).
   *
   * 实现已转交 `PracticeCustomScenarioService`: §3.5 与 §7.2 两个入口现在
   * 共用同一张表 (practice_custom_scenarios) 与同一条落库链路 ——
   * 否则 §3.5 生成的场景不会出现在 §7.2 的「我的真实场景」列表里.
   *
   * @param userId 当前用户 id
   * @param dto 基本功 + 真实情况描述
   * @returns 新场景 id
   */
  async createCustomScenario(userId: string, dto: CreateCustomPracticeScenarioDto): Promise<CustomPracticeScenarioResultDto> {
    return this.customScenarioService.createFromSituation(userId, dto);
  }

  // ══════════════════════════════════════════════════════════════════════
  // 内部工具
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 事务内取号 + 落库 (§8.5 E1).
   *
   * 事务内用悲观写锁锁住该 (user_id, scenario_id) 的全部行 (含软删行):
   *   - 行锁 + 间隙锁让同一区间的并发插入串行化
   *   - 序号按 `MAX(attempt_ordinal) + 1` 取, **不按 COUNT**:
   *     COUNT 会漏掉软删行, 于是"第 3 条被软删 → COUNT=2 → 取号 3 → 撞唯一键".
   *     MAX 不受软删影响, 取号永远大于历史上出现过的任何一个.
   *
   * @param input 落库参数
   * @returns 落库后的行 (attemptOrdinal 为事务内取到的真值)
   */
  private async persistAttemptWithOrdinal(input: {
    userId: string;
    scenarioId: string;
    scenarioSource: PracticeAttempt['scenarioSource'];
    submittedText: string;
    recordSeconds: number | null;
    speechRateWpm: number | null;
    feedback: PracticeFeedback;
    durationSeconds: number;
    turn: number;
  }): Promise<PracticeAttempt> {
    return this.attemptRepo.manager.transaction(async (manager) => {
      // 悲观写锁: 锁住该 (user, scenario) 的行区间, 并发提交在此串行.
      //
      // 用 `manager.getRepository(X).find(options)` 而不是 `manager.find(X, options)`:
      //   TypeORM 两种写法等价, 但后者的第二个参数是 options, 而 `unicorn/no-array-
      //   method-this-argument` 规则会把 `find(x, y)` 里的 y 当成 Array#find 的
      //   thisArg 而误报. 取 repository 再调 find(options) 既避开误报, 语义也更直白.
      const attemptRepo = manager.getRepository(PracticeAttempt);
      const locked = await attemptRepo.find({
        where: { userId: input.userId, scenarioId: input.scenarioId },
        lock: { mode: 'pessimistic_write' },
      });
      const maxOrdinal = locked.reduce((max, row) => Math.max(max, row.attemptOrdinal), 0);
      const attemptOrdinal = maxOrdinal + 1;

      // 落库时用真值覆盖预估序号 (feedback JSON 里的 attemptOrdinal 与列保持一致).
      const feedback: PracticeFeedback = { ...input.feedback, attemptOrdinal };

      return attemptRepo.save(
        // Repository.create() 只接一个参数 (与 EntityManager.create(EntityClass, x) 不同);
        // 实体类已经由 getRepository 绑定, 不需要再传.
        attemptRepo.create({
          tenantId: input.userId, // A9 一人一租户
          userId: input.userId,
          scenarioId: input.scenarioId,
          scenarioSource: input.scenarioSource,
          submittedText: input.submittedText,
          recordSeconds: input.recordSeconds,
          speechRateWpm: input.speechRateWpm,
          feedback,
          durationSeconds: input.durationSeconds,
          turn: input.turn,
          attemptOrdinal,
          // 画像回写的两列由 PracticeAbilitySyncService 在落库后回填
          // (回填是"读侧聚合"的一部分, 不该混进取号事务).
          abilityDimensionCode: null,
          abilitySignal: null,
        }),
      );
    });
  }

  /**
   * 折算语速 (字/分).
   *
   * 只在语音引擎 + 有录音时长 + 有转写文本时计算; 其余返回 null.
   * 字数按 Unicode 码点计 (Array.from), 避免 emoji / 代理对把长度算错.
   */
  private computeSpeechRate(engine: PracticeEngine, submittedText: string, recordSeconds: number | undefined): number | null {
    if (engine !== PracticeEngine.VOICE_METRIC) {
      return null;
    }
    if (!recordSeconds || recordSeconds <= 0) {
      return null;
    }
    const charCount = Array.from(submittedText.trim()).length;
    if (charCount === 0) {
      return null;
    }
    return Math.round((charCount / recordSeconds) * 60);
  }

  /**
   * 还原此前轮次的转写 (P2 多轮评判用).
   *
   * 每条历史 attempt = 一轮: 咨询师说了什么 (submittedText) + 来访者随后回了什么
   * (feedback.visitorReaction). 只取当前轮之前的记录.
   */
  private async buildTranscript(userId: string, scenario: { scenarioId: string }, currentTurn: number): Promise<PracticeTurn[]> {
    if (currentTurn <= 1) {
      return [];
    }
    const history = await this.attemptRepo.find({
      where: { userId, scenarioId: scenario.scenarioId, deletedAt: IsNull() },
      order: { turn: 'ASC', createdAt: 'ASC' },
    });

    return history
      .filter((attempt) => attempt.turn < currentTurn)
      .map((attempt) => ({
        turn: attempt.turn,
        counselorText: attempt.submittedText,
        visitorReaction: attempt.feedback?.visitorReaction ?? '',
      }));
  }
}

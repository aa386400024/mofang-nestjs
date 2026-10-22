// V2026-10-21 治本 (V1.2 VS-B2 — 咨询师端访客上下文贡献者):
//   原因: v1.2 §4.3 要求「长程: 注入 VisitorFullPersona 全量 + 当前信任度 + 已解锁
//     CaseProfileEntry 列表」到 AI 来访者. AI 来访者在 agent 模块, 不认识 counselor 业务,
//     所以这里实现 agent 侧的 VisitorContextContributor 插槽, 在启动时注册进全局注册表.
//   修法: CounselorVisitorContextContributor:
//     - supports(): 一律 true (能不能提供由 build() 判定 —— 不知道 sessionType 时靠加载结果)
//     - build(): 按 sessionId 装载 counselor 会话上下文 → 拿到全量人设 / 信任度 / 已解锁档案
//       → 渲染成行为规则文本 → 返回带 identity + difficulty 覆盖的 context block
//   **sessionId 绑定契约** (本片对 v1.2 排期 §4「② 长程来访者走哪条链」的答复):
//     AI 来访者拿到的是**语音链路的 sessionId** (voice WS path 里的 sid).
//     本贡献者按该 sessionId 去反查 counselor 的 training_sessions / long_term_case_sessions.
//     → **前端约定: 训练/长程会谈的 voice WS sessionId = counselor 的 sessionId**.
//     这样语音链路 (ASR/TTS/visitor) 保持通用, 不需要为 counselor 另造一条对话链路;
//     而"这个会话是谁、什么设定"由本贡献者按 sessionId 注入 —— 语音链路与业务解耦.
//   反双胞胎:
//     - 不用 "if (sessionId 以某个前缀开头) 就当 counselor 会话": 前缀约定会误判
//     - 不在 agent 侧查 counselor 的表: 那是反向依赖, 且取数口径会与督导/档案服务漂移
//     - 不把全量人设直接塞给 agent 的 prompt 渲染函数: 渲染保持纯函数, 内容由贡献者给
//   验证:
//     1. tsc 0 错
//     2. 启动日志能看到贡献者注册
//     3. 大炮用 counselor 的 sessionId 连 voice WS → 来访者 prompt 带上「本次会话的来访者设定」
//     4. 用一个普通 id 连 voice WS → 行为不变 (向后兼容)
//   时间戳: 2026-10-21

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { SessionContextBuilder } from './session-context.builder';
import type { PersonaDifficulty } from '../../agent/persona/domain/entities/persona.entity';
import {
  VisitorContextRegistry,
  type VisitorContextBlock,
  type VisitorContextContributor,
  type VisitorContextRequest,
} from '../../agent/visitor/visitor-context';

import { buildVisitorPersonaBehaviorBlock, toVisitorIdentity } from '../config/visitor-persona-behavior.config';
import { VisitorFullPersona } from '../entities/visitor-full-persona.entity';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';

/**
 * 难度档位映射 (counselor enum → agent type alias).
 *
 * 两边**值相同** (L1/L2/L3) 但类型不同 (enum vs type alias), 显式映射而不是 cast:
 * 万一将来 agent 侧改了取值, cast 会静默出错, 映射会编译报错.
 *
 * @param difficulty counselor 侧难度
 */
function toPersonaDifficulty(difficulty: TrainingDifficulty): PersonaDifficulty {
  switch (difficulty) {
    case TrainingDifficulty.L1:
      return 'L1';
    case TrainingDifficulty.L2:
      return 'L2';
    case TrainingDifficulty.L3:
      return 'L3';
  }
}

/**
 * 咨询师端访客上下文贡献者.
 */
@Injectable()
export class CounselorVisitorContextContributor implements VisitorContextContributor, OnModuleInit {
  readonly name = 'counselor';
  /** 身份类信息排前面 (agent 侧优先取第一个带 identity/difficulty 的块). */
  readonly priority = 10;

  private readonly logger = new Logger(CounselorVisitorContextContributor.name);

  constructor(
    private readonly registry: VisitorContextRegistry,
    private readonly contextBuilder: SessionContextBuilder,
    @InjectRepository(VisitorFullPersona)
    private readonly personaRepo: Repository<VisitorFullPersona>,
  ) {}

  /** 启动时注册进全局注册表 (@Global 模块先实例化, 这里 register 时注册表已可用). */
  onModuleInit(): void {
    this.registry.register(this);
    this.logger.log(`[registered] visitor context contributor: ${this.name}`);
  }

  /**
   * 是否管这个 session —— 一律交给 build() 判定 (不知道 sessionType 时只能靠加载结果).
   *
   * @param request 解析请求
   */
  supports(request: VisitorContextRequest): boolean {
    return request.sessionId.length > 0;
  }

  /**
   * 产出该会话的访客上下文块.
   *
   * @param request 解析请求
   * @returns 上下文块; 不是咨询师会话 → null (agent 侧行为不变)
   */
  async build(request: VisitorContextRequest): Promise<VisitorContextBlock | null> {
    const ctx = await this.contextBuilder.loadBySessionId(request.userId, request.sessionId);
    if (!ctx) {
      // 不是咨询师会话 (或会话不属于该用户) → 不产出上下文, agent 行为与改前完全一致
      return null;
    }

    // 全量人设: 长程才有 (单次训练只有浅层, spec §4.3 明确单次不强制接全量人设)
    const full = ctx.caseId
      ? await this.personaRepo.findOne({
          where: { caseId: ctx.caseId, userId: request.userId, deletedAt: IsNull() },
        })
      : null;

    const content = buildVisitorPersonaBehaviorBlock({
      shallow: ctx.persona,
      difficulty: ctx.difficulty,
      full: full
        ? {
            basics: full.basics,
            developmentalTimeline: full.developmentalTimeline,
            innerWorkingModel: full.innerWorkingModel,
            socialMap: full.socialMap,
            coping: full.coping,
            therapyExpectation: full.therapyExpectation,
            presentingIssue: full.presentingIssue,
          }
        : null,
      trustLevel: ctx.trustLevel ?? 0.2,
      unlockedEntries: ctx.unlockedEntries,
    });

    return {
      content,
      // 咨询师为本场会话配的难度/身份优先于 agent 内置 persona
      difficulty: toPersonaDifficulty(ctx.difficulty),
      identity: toVisitorIdentity(ctx.persona),
      // 替换掉 agent 的通用人格画像 —— 两套画像并存会让模型无所适从
      replacesPersona: true,
    };
  }
}

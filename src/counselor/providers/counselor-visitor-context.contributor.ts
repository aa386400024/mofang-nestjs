// V2026-10-21 治本 (V1.2 VS-B2 — 咨询师端访客上下文贡献者):
//   原因: v1.2 §4.3 要求「长程: 注入 VisitorFullPersona 全量 + 当前信任度 + 已解锁
//     CaseProfileEntry 列表」到 AI 来访者. AI 来访者在 agent 模块, 不认识 counselor 业务,
//     所以这里实现 agent 侧的 VisitorContextContributor 插槽, 在启动时注册进全局注册表.
//   **sessionId 绑定契约**: AI 来访者拿到的是**语音链路的 sessionId** (voice WS path 里的 sid).
//     本贡献者按该 sessionId 去反查 counselor 的 training_sessions / long_term_case_sessions.
//   反双胞胎:
//     - 不用 "if (sessionId 以某个前缀开头) 就当 counselor 会话": 前缀约定会误判
//     - 不在 agent 侧查 counselor 的表: 那是反向依赖, 且取数口径会与督导/档案服务漂移
//     - 不把全量人设直接塞给 agent 的 prompt 渲染函数: 渲染保持纯函数, 内容由贡献者给
//
//   V2026-10-23 治本 (v2.0 语音对语音 — 演练登记优先分支, spec §2.3):
//     原因: 全真会谈选的是**公共人物** (`visitor_pool_templates` 的 `vpt_*`), 单次演练
//       **不落库** (不写 training_sessions / 不克隆 visitor_full_personas), 于是既有的
//       "按 sessionId 反查长程会话表"必然查不到 → 回退内置 persona → **用户选的人物没生效**.
//       这类演练的设定其实已经记在 voice 侧的**演练登记**里 (WS 握手时登记: 模板 id + 临场参数).
//     修法: 贡献者的取数优先级改为 **演练登记 > 长程反查 > 无上下文**:
//       ① 演练登记命中 → 从 `visitor_pool_templates` 读该模板的 7 大块剧本, 按握手临场参数
//          渲染行为块 (`replacesPersona=true`), 信任度固定 0.2 (单次演练无信任演进)
//       ② 登记未命中 → 走原长程反查分支 (行为完全不变)
//       ③ 都没有 → 返回 null (agent 行为与改前完全一致)
//     剧本仍**只在服务端内部读取**, 不进任何公共响应 (沿用 VisitorPoolService.toCard 唯一出参口).
//
//   验证:
//     1. tsc 0 错
//     2. 启动日志能看到贡献者注册成功
//     3. 大炮用 counselor 的 sessionId 连 voice WS → 来访者 prompt 带上「本次会话的来访者设定」
//     4. 带 templateId 的演练连接 → prompt 带上公共人物的 7 大块 + 临场参数
//     5. 用一个普通 id 连 voice WS → 行为不变 (向后兼容)
//   时间戳: 2026-10-21 / 2026-10-23

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
import { VoiceSessionRegistry } from '../../voice/voice-session-registry';
import type { VoiceDifficulty, VoiceVisitorStyle } from '../../voice/voice-session.types';

import { buildVisitorPersonaBehaviorBlock, toVisitorIdentity } from '../config/visitor-persona-behavior.config';
import type { SessionPersonaContext } from '../domain/session-context/session-context';
import { VisitorFullPersona } from '../entities/visitor-full-persona.entity';
import { VisitorPoolTemplate } from '../entities/visitor-pool-template.entity';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

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
 * voice 侧难度 → counselor 难度 (显式映射, 不 cast).
 *
 * @param difficulty voice 侧难度
 */
function toTrainingDifficulty(difficulty: VoiceDifficulty): TrainingDifficulty {
  switch (difficulty) {
    case 'L1':
      return TrainingDifficulty.L1;
    case 'L2':
      return TrainingDifficulty.L2;
    case 'L3':
      return TrainingDifficulty.L3;
  }
}

/**
 * voice 侧风格 → counselor 风格 (显式映射, 不 cast).
 *
 * @param style voice 侧风格
 */
function toVisitorStyle(style: VoiceVisitorStyle): VisitorStyle {
  switch (style) {
    case 'defensive':
      return VisitorStyle.DEFENSIVE;
    case 'cooperative':
      return VisitorStyle.COOPERATIVE;
    case 'resistant':
      return VisitorStyle.RESISTANT;
    case 'avoidant':
      return VisitorStyle.AVOIDANT;
    case 'mixed':
      return VisitorStyle.MIXED;
  }
}

/**
 * 年龄区间 → 年龄下限.
 *
 * 公共人物只对外给区间 (例「28-35」), **不造精确年龄**; 需要数字时取下限,
 * 区间原文另外写进背景段, 让模型知道这是一个范围而不是精确值.
 *
 * @param ageRange 年龄区间字符串
 * @returns 下限; 解析不出返回 null
 */
function parseAgeRangeLowerBound(ageRange: string): number | null {
  const matched = /(\d+)/.exec(ageRange);
  if (!matched?.[1]) return null;
  const parsed = Number(matched[1]);
  return Number.isFinite(parsed) ? parsed : null;
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

  /**
   * @param registry agent 侧上下文注册表
   * @param contextBuilder 会话上下文装配器
   * @param personaRepo 全量人设仓储 (长程副本)
   * @param templateRepo 公共人物模板仓储 (演练登记分支)
   * @param sessions voice 侧演练登记
   */
  constructor(
    private readonly registry: VisitorContextRegistry,
    private readonly contextBuilder: SessionContextBuilder,
    @InjectRepository(VisitorFullPersona)
    private readonly personaRepo: Repository<VisitorFullPersona>,
    @InjectRepository(VisitorPoolTemplate)
    private readonly templateRepo: Repository<VisitorPoolTemplate>,
    private readonly sessions: VoiceSessionRegistry,
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
   * 优先级: 演练登记 (公共人物) > 长程反查 > 无上下文.
   *
   * @param request 解析请求
   * @returns 上下文块; 无任何上下文 → null (agent 行为与改前完全一致)
   */
  async build(request: VisitorContextRequest): Promise<VisitorContextBlock | null> {
    // ① 演练登记优先: 全真会谈选了公共人物, 单次演练不落库, 只能靠握手时登记的设定
    const registration = this.sessions.find(request.sessionId);
    if (registration?.templateId) {
      const block = await this.buildFromTemplate(registration.templateId, registration.preset);
      if (block) {
        return block;
      }
    }

    // ② 长程反查 (原行为, 完全不变)
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

  /**
   * 演练登记分支 — 从公共人物模板渲染行为块.
   *
   * @param templateId 公共模板 id
   * @param preset 握手临场参数 (难度 / 风格 / 情绪基线 / 防御水平)
   * @returns 上下文块; 模板查不到 → null (回落长程分支)
   */
  private async buildFromTemplate(
    templateId: string,
    preset: {
      readonly difficulty: VoiceDifficulty;
      readonly style: VoiceVisitorStyle;
      readonly emotionBaseline: number;
      readonly defenseLevel: number;
    },
  ): Promise<VisitorContextBlock | null> {
    const template = await this.templateRepo.findOne({
      where: { id: templateId, enabled: true, deletedAt: IsNull() },
    });
    if (!template) {
      this.logger.warn(`[template_not_found] ${templateId} — 回落长程反查`);
      return null;
    }

    const difficulty = toTrainingDifficulty(preset.difficulty);
    const script = template.script;
    const age = parseAgeRangeLowerBound(template.ageRange) ?? script.basics.age;

    // 浅层人设: 表层字段来自模板表层, 临场参数来自握手 (难度 / 风格 / 情绪 / 防御)
    const shallow: SessionPersonaContext = {
      name: template.codename,
      age,
      occupation: script.basics.occupation,
      complaint: template.presentingComplaint,
      // 背景只写"可对外呈现"的部分: 年龄区间 + 居住状态; 不编造家庭/病史细节
      background: `年龄区间 ${template.ageRange}（约 ${age} 岁起）${script.basics.livingStatus ? `，现居：${script.basics.livingStatus}` : ''}`,
      visitorStyle: toVisitorStyle(preset.style),
      difficulty,
      emotionBaseline: preset.emotionBaseline,
      defenseLevel: preset.defenseLevel,
    };

    const content = buildVisitorPersonaBehaviorBlock({
      shallow,
      difficulty,
      // 公共模板的 7 大块剧本**整体**作为 AI 的底层人设 (只在服务端内部读取)
      full: script,
      // 单次演练无信任演进 → 固定表层信任度 (与 VisitorPoolService.instantiate 的新副本一致)
      trustLevel: 0.2,
      unlockedEntries: [],
    });

    this.logger.log(`[template_context] template=${templateId} difficulty=${difficulty} style=${shallow.visitorStyle}`);

    return {
      content,
      difficulty: toPersonaDifficulty(difficulty),
      identity: toVisitorIdentity(shallow),
      // 替换掉 agent 的通用人格画像 —— 公共人物与内置 persona 完全是两个人
      replacesPersona: true,
    };
  }
}

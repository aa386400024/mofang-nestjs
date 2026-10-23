// V2026-10-23 治本 (AI 模拟来访池 — 公共人物模板解析器, spec §2.2):
//   原因: WS 握手要校验 `templateId` 指向的**已上架**公共人物 (查不到 →
//     `error(template_not_found)` + close(1008), 不回退默认人物). 这张表
//     (`visitor_pool_templates`) 属 counselor 业务域, 而 WS 网关在 voice (agent 侧) ——
//     直接 import 会形成 agent → business 反向依赖, 且将来改表结构会连带炸语音链路.
//   修法: 实现 voice 侧的 `VoiceTemplateResolver` 插槽 (依赖倒置), 在 onModuleInit
//     注册进全局注册表. voice 侧只拿到**表层摘要**, 7 大块剧本 (`script`) 永不跨模块,
//     "剧本不下发"这条红线由类型系统兜住.
//   映射纪律: counselor 的 enum → voice 的字面量联合用**显式映射函数**, 不 cast ——
//     万一哪天 voice 侧改了取值, 映射会编译报错, cast 会静默出错.
//
//   反双胞胎:
//     - 不在 voice 侧直接查这张表: 反向依赖, 详见文件头
//     - 不把 `script` 放进摘要: 摘要是跨模块契约, 剧本是**服务端内部**数据
//     - 不复用 VisitorPoolService.list/getCard: 那是**公共 HTTP 面**的 DTO 出参口
//       (零压红线守门人, 只挑表层字段), 复用它等于让 WS 握手依赖 HTTP 出参口径
//
//   验证 (由大炮在 Windows 环境手动执行):
//     1. tsc 0 错
//     2. 启动日志: "voice template resolver: counselor-visitor-pool" 注册成功
//     3. ?templateId=vpt_intimate_avoidance_l1 → 连接成功; 换成不存在的 → template_not_found
//   时间戳: 2026-10-23

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type Repository } from 'typeorm';

import type { VoiceDifficulty, VoiceTemplateSummary, VoiceVisitorStyle } from '../../voice/voice-session.types';
import { VoiceTemplateRegistry } from '../../voice/voice-template-slot';
import { VisitorPoolTemplate } from '../entities/visitor-pool-template.entity';
import { TrainingDifficulty } from '../enums/training-difficulty.enum';
import { VisitorStyle } from '../enums/visitor-style.enum';

/**
 * counselor 难度 → voice 难度 (显式映射, 不 cast).
 *
 * @param difficulty counselor 侧难度
 */
function toVoiceDifficulty(difficulty: TrainingDifficulty): VoiceDifficulty {
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
 * counselor 风格 → voice 风格 (显式映射, 不 cast).
 *
 * @param style counselor 侧风格
 */
function toVoiceStyle(style: VisitorStyle): VoiceVisitorStyle {
  switch (style) {
    case VisitorStyle.DEFENSIVE:
      return 'defensive';
    case VisitorStyle.COOPERATIVE:
      return 'cooperative';
    case VisitorStyle.RESISTANT:
      return 'resistant';
    case VisitorStyle.AVOIDANT:
      return 'avoidant';
    case VisitorStyle.MIXED:
      return 'mixed';
  }
}

/**
 * 公共来访模板解析器 (voice 侧插槽的 counselor 实现).
 */
@Injectable()
export class CounselorVisitorPoolTemplateResolver implements OnModuleInit {
  readonly name = 'counselor-visitor-pool';

  private readonly logger = new Logger(CounselorVisitorPoolTemplateResolver.name);

  /**
   * @param registry voice 侧模板解析注册表 (@Global)
   * @param templateRepo 公共模板仓储
   */
  constructor(
    private readonly registry: VoiceTemplateRegistry,
    @InjectRepository(VisitorPoolTemplate)
    private readonly templateRepo: Repository<VisitorPoolTemplate>,
  ) {}

  /** 启动时注册进全局注册表. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 解析已上架的公共模板.
   *
   * @param templateId 公共模板 id
   * @returns 表层摘要; 不存在 / 已下架 / 已软删 → null
   */
  async resolve(templateId: string): Promise<VoiceTemplateSummary | null> {
    const row = await this.templateRepo.findOne({
      where: { id: templateId, enabled: true, deletedAt: IsNull() },
    });
    if (!row) {
      this.logger.warn(`[template_not_found] ${templateId}`);
      return null;
    }
    return {
      templateId: row.id,
      codename: row.codename,
      ageRange: row.ageRange,
      presentingComplaint: row.presentingComplaint,
      difficulty: toVoiceDifficulty(row.difficulty),
      styleHint: toVoiceStyle(row.styleHint),
      emotionBaselineDefault: row.emotionBaselineDefault,
      defenseLevelDefault: row.defenseLevelDefault,
      defenseType: row.defenseType,
    };
  }
}

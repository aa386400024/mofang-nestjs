// V2026-10-27 治本 (危机识别专区 — 只读元数据服务, spec 任务 B2):
//   职责: 把 `config/crisis-practice.config.ts` 的静态教学内容映射成对外 DTO.
//
//   为什么要有这层 (而不是 controller 直接返回常量):
//     · 出参是**对外契约**, config 是**内部内容** —— 两层分开, 改文案不触发契约变更,
//       而 DTO 逐字段映射保证 config 将来加内部字段时不会顺手泄到前端
//     · controller 保持"只做出入参转交"的项目既定风格
//
//   边界 (与 config 同款, 此处再声明一次是因为**这是出参关口**):
//     · 不含人物剧本 / 危机人设 / 具体热线号码 / 干预步骤
//     · 不落库 / 不调上游 / 不计次 —— 纯静态读
//
//   验证:
//     1. tsc 0 错
//     2. GET /counselor/crisis-practice/meta → 只含 4 段结构
//   时间戳: 2026-10-27

import { Injectable } from '@nestjs/common';

import {
  buildCrisisPracticeMeta,
  type CrisisReferralScriptTemplate,
  type CrisisRiskLevelMeta,
  type CrisisSignalCategory,
} from '../config/crisis-practice.config';
import type {
  CrisisPracticeMetaDto,
  CrisisReferralScriptDto,
  CrisisRiskLevelMetaDto,
  CrisisSignalCategoryDto,
} from '../dto/crisis-practice.dto';

@Injectable()
export class CrisisPracticeService {
  /**
   * 取危机练习元数据 (只读).
   *
   * @returns 分级 / 信号类别 / 话术模板 / 边界声明
   */
  getMeta(): CrisisPracticeMetaDto {
    const meta = buildCrisisPracticeMeta();
    return {
      boundaryNotice: meta.boundaryNotice,
      riskLevels: meta.riskLevels.map((level) => this.toLevelDto(level)),
      signalCategories: meta.signalCategories.map((category) => this.toCategoryDto(category)),
      referralScripts: meta.referralScripts.map((script) => this.toScriptDto(script)),
    };
  }

  /**
   * 风险分档 → DTO.
   *
   * @param level 配置层分档
   * @returns DTO
   */
  private toLevelDto(level: CrisisRiskLevelMeta): CrisisRiskLevelMetaDto {
    return {
      level: level.level,
      label: level.label,
      teachingNote: level.teachingNote,
      signalCategoryIds: [...level.signalCategoryIds],
    };
  }

  /**
   * 识别信号类别 → DTO.
   *
   * @param category 配置层类别
   * @returns DTO
   */
  private toCategoryDto(category: CrisisSignalCategory): CrisisSignalCategoryDto {
    return {
      id: category.id,
      label: category.label,
      description: category.description,
      examples: [...category.examples],
    };
  }

  /**
   * 话术模板 → DTO.
   *
   * @param script 配置层模板
   * @returns DTO
   */
  private toScriptDto(script: CrisisReferralScriptTemplate): CrisisReferralScriptDto {
    return {
      id: script.id,
      title: script.title,
      levels: [...script.levels],
      openQuestions: [...script.openQuestions],
      resourceGuidance: script.resourceGuidance,
    };
  }
}

// V2026-10-27 治本 (危机识别专区 — 只读元数据出参, spec 任务 B2):
//   契约:
//     GET /counselor/crisis-practice/meta
//     Authorization: Bearer <jwt>   (复用 JwtAuthGuard; **不匿名**)
//     响应: { boundaryNotice, riskLevels[], signalCategories[], referralScripts[] }
//
//   出参纪律 (与 config/crisis-practice.config.ts 同一套边界):
//     · **不含**任何人物剧本 / 危机人设 / 具体热线号码 / 干预步骤
//     · **不含**任何计数 (不计次: 这是静态教学元数据, 不该有"已读/已练"之类的计数)
//     · 前端拿到的就是**可直接渲染"隔离壳"**的那几段文本
//
//   反双胞胎:
//     - 不复刻 config 的类型当 DTO: DTO 是**对外契约** (会改, 前端跟着改),
//       config 是**内部教学内容** (改文案不该算契约变更) —— 两者刻意分开,
//       换句话说: 文案随便改, 但字段名/结构不能随便改.
//     - 不下发原始常量对象: controller 出参走 DTO 逐字段映射, 将来 config 加内部字段
//       不会顺手泄到前端.
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/crisis-practice/meta 可见
//     3. 无 token 访问 → 401
//   时间戳: 2026-10-27

import { ApiProperty } from '@nestjs/swagger';

/** 风险分档 (教学用). */
export class CrisisRiskLevelMetaDto {
  @ApiProperty({ description: '风险档 (教学分档, 非判定标准)', enum: ['low', 'medium', 'high', 'imminent'] })
  level!: string;

  @ApiProperty({ description: '教学标签 (不是诊断名)' })
  label!: string;

  @ApiProperty({ description: '一句教学提示: 学员在这个档位该关注什么 (不含处理流程)' })
  teachingNote!: string;

  @ApiProperty({ description: '该档位对应的识别信号类别 id', type: [String] })
  signalCategoryIds!: string[];
}

/** 识别信号类别 (教学用). */
export class CrisisSignalCategoryDto {
  @ApiProperty({ description: '类别 id (稳定引用)' })
  id!: string;

  @ApiProperty({ description: '类别名 (教学标签)' })
  label!: string;

  @ApiProperty({ description: '一句说明: 这个方向上可以留意什么' })
  description!: string;

  @ApiProperty({ description: '现象举例 (描述性, 不含追问话术)', type: [String] })
  examples!: string[];
}

/** 转介练习话术模板 (教学用). */
export class CrisisReferralScriptDto {
  @ApiProperty({ description: '模板 id (稳定引用)' })
  id!: string;

  @ApiProperty({ description: '模板标题 (教学标签)' })
  title!: string;

  @ApiProperty({ description: '适用档位', type: [String] })
  levels!: string[];

  @ApiProperty({ description: '开放式评估问句 (练"问得开")', type: [String] })
  openQuestions!: string[];

  @ApiProperty({ description: '通用资源引导 (不含任何具体号码/机构)' })
  resourceGuidance!: string;
}

/** 危机练习元数据 (只读). */
export class CrisisPracticeMetaDto {
  @ApiProperty({ description: '边界声明文案 (前端隔离壳直接渲染)' })
  boundaryNotice!: string;

  @ApiProperty({ description: '风险分档的教学元数据', type: [CrisisRiskLevelMetaDto] })
  riskLevels!: CrisisRiskLevelMetaDto[];

  @ApiProperty({ description: '识别信号类别清单', type: [CrisisSignalCategoryDto] })
  signalCategories!: CrisisSignalCategoryDto[];

  @ApiProperty({ description: '转介练习话术模板', type: [CrisisReferralScriptDto] })
  referralScripts!: CrisisReferralScriptDto[];
}

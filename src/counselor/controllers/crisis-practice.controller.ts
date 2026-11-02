// V2026-10-27 治本 (危机识别专区 — 只读公开元数据端点, spec 任务 B2):
//   契约:
//     GET /counselor/crisis-practice/meta
//     Authorization: Bearer <jwt>   (复用 JwtAuthGuard; **不匿名**)
//     响应: { boundaryNotice, riskLevels[], signalCategories[], referralScripts[] }
//
//   ── 这个端点**只给前端"隔离壳"备料** ──
//   前端本期要做的是: 把危机识别练习放在一个**物理隔离**的壳里 (独立入口 + 明确边界提示),
//   壳里渲染的是"分级 / 信号类别 / 话术模板 / 边界声明"这几段静态教学文本.
//   本端点**不**提供: 危机人物、危机剧本、干预流程、转介工单、任何号码.
//
//   ── 为什么不做成"匿名可读" ──
//   危机内容属于受控教学素材: 即使是壳, 也要确保它只出现在"已登录的学员端"里,
//   不被搜索引擎/爬虫/随手分享的链接带出去. 复用 JwtAuthGuard 即可, 不额外造鉴权.
//
//   反双胞胎:
//     - 不把危机数据挂到公共图鉴列表上: 那是**另一条**链路 (普通池), 本期完全不动
//     - 不提供"随机一条危机练习"端点: 本期只给静态元数据, 练习内容编排是前端的事
//     - 不在这里计数 (练习次数/已读): 静态元数据没有"每次读都写库"的理由
//   验证:
//     1. tsc 0 错
//     2. swagger 页面 /counselor/crisis-practice/meta 可见
//     3. 无 token 访问 → 401
//   时间戳: 2026-10-27

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { CrisisPracticeMetaDto } from '../dto/crisis-practice.dto';
import { CrisisPracticeService } from '../providers/crisis-practice.service';

@ApiTags('counselor-crisis-practice')
@Controller('counselor/crisis-practice')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CrisisPracticeController {
  /**
   * @param crisisPractice 危机练习元数据服务
   */
  constructor(private readonly crisisPractice: CrisisPracticeService) {}

  /**
   * GET /counselor/crisis-practice/meta
   *
   * 返回危机识别练习的**静态教学元数据** (供前端"隔离壳"渲染).
   *
   * @returns 分级 / 信号类别 / 话术模板 / 边界声明
   */
  @Get('meta')
  @ApiOperation({
    summary: '危机识别练习的静态教学元数据 (隔离壳渲染用)',
    description:
      '只读静态内容: 风险分档 (教学标签) / 识别信号类别 / 转介练习话术模板 / 边界声明文案. ' +
      '**不含**危机人物、剧本、干预流程与任何具体热线号码 —— 本模块仅练习识别与转介沟通, ' +
      '非真实危机干预, 不替代专业帮助. 不落库 / 不调上游 / 不计次.',
  })
  getMeta(): CrisisPracticeMetaDto {
    return this.crisisPractice.getMeta();
  }
}

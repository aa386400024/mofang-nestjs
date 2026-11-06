// V2026-11-06 治本 (WP43 · 评估引擎基础版 · 评估列表接口):
//   职责: 暴露"我的快速评估列表" (规则引擎快评, 分页).
//   边界: 薄委托 —— 业务全在 SessionEvaluationService.
//
//   为什么路径是 `/counselor/evaluations` (任务单写的是 `/counselor/users/me/evaluations`):
//     仓库既有范式里没有 `users/me` 这类"当前用户"路径 —— 学员端所有"我的 XX"接口都是
//     `@CurrentUser()` 取当前用户 + 资源路径 (例: `/counselor/training-sessions` 就是"我的会话列表",
//     `/counselor/ability` 是"我的能力画像"). 本仓没有第二个 `me` 变体, 加一个会是孤例.
//
//   单场评估走另一个路径 (`/counselor/training-sessions/:id/evaluation`):
//     它的宿主资源是**训练会话**, 与 consent / hints / marks / bookmarks 五个兄弟端点同款 ——
//     挂在会话下面, 不另起一套路径 (同一份数据两个路径 = 迟早漂).
//
//   反双胞胎:
//     - 不复用 supervisor 的报告接口: 那是 LLM 深度版 (慢), 本接口是规则快评 (毫秒级);
//     - 不在本 controller 里算分: 规则只有一份 (evaluation-engine.ts).
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/counselor/wp43-evaluation-engine.spec.ts 覆盖路径与方法
//
//   时间戳: 2026-11-06

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard.js';
import { SessionEvaluationListQueryDto, type SessionEvaluationListResultDto } from '../evaluation/session-evaluation.dto.js';
import { SessionEvaluationService } from '../evaluation/session-evaluation.service.js';

/**
 * WP43 · 评估引擎快速评分的列表接口.
 */
@ApiTags('counselor-evaluations')
@Controller('counselor/evaluations')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SessionEvaluationController {
  constructor(private readonly service: SessionEvaluationService) {}

  /**
   * GET /counselor/evaluations — 我的快速评估列表 (分页).
   *
   * @param user 当前学员 (`CurrentUser()` 注入)
   * @param query 分页入参
   * @returns 列表 (条目 + 总数 + 分页信息)
   */
  @Get()
  @ApiOperation({
    summary: '我的快速评估列表 (规则引擎快评, 分页)',
    description:
      '每场对练的**规则快评** (技术手法计数 / BDI 首末变化 / 伦理安全评级). ' +
      '与督导报告 (LLM 深度版) 互补, 不是替代: 快评毫秒级, 督导报告 30-120s.',
  })
  async list(
    @CurrentUser() user: { userId: string },
    @Query() query: SessionEvaluationListQueryDto,
  ): Promise<SessionEvaluationListResultDto> {
    return this.service.listMine(user.userId, query);
  }
}

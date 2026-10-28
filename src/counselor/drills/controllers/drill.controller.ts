// V2026-10-27 治本 (情景演练 · REST 控制器 — 3 个端点):
//   原因: 任务单 §4 拍板 3 个端点 (列表 / 开练详情 / 提交判定), 并要求:
//     · 复用 JwtAuthGuard (不是匿名端点 —— 演练内容是受控教学素材)
//     · 一人一租户校验归属 (tenantId = userId, 与仓库其余 counselor 链路同款)
//     · 找不到 → 404; 无 token → 401; 空串提交 → 400
//   修法: 本控制器只做"入参转交 + 出参声明", 业务逻辑全在 service.
//
//   ── 反双胞胎 ──
//   - **不新建鉴权体系**: 复用 JwtAuthGuard (与 crisis-practice.controller 同款),
//     不写第二套 token 解析.
//   - **DTO 一律值导入**: @Body / @Query 的参数类型靠 design:paramtypes 元数据拿 DTO 类,
//     `import type` 会让元数据退化成 Object → 全局 ValidationPipe 静默跳过校验
//     (仓库既有约定: 见 visitor-pool.controller 的同款注释).
//   - **不在 controller 里做分支**: 404 / 400 / 过滤全在 service 与 DTO 校验层.
//   - **不做限流/配额**: 本期不落库不计次 (任务单 §6), 没有可被刷的资源面.
//
//   验证:
//     1. tsc 0 错
//     2. swagger 页 /counselor/drills* 可见 3 个端点
//     3. 无 token 访问 → 401
//   时间戳: 2026-10-27 21:45 GMT+8
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../user/guards/jwt-auth.guard';
import { DrillListQueryDto, DrillDetailDto, DrillListDto, DrillResponseDto, SubmitDrillResponseDto } from '../dto/drill.dto';
import { DrillService } from '../providers/drill.service';

@ApiTags('counselor-drills')
@Controller('counselor/drills')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DrillController {
  /**
   * @param drillService 情景演练读侧服务
   */
  constructor(private readonly drillService: DrillService) {}

  /**
   * GET /counselor/drills?track=boundary|crisis
   *
   * 返回剧本**元信息**清单 (不含全文、不含关键词表).
   */
  @Get()
  @ApiOperation({
    summary: '情景演练列表 (元信息)',
    description:
      '按赛道过滤 (boundary=设置压力测试 / crisis=危机识别会内突发), 不传 = 全部. ' +
      '只返回 drillId / 赛道 / 难度 / 标题 / 场景说明 / 边界声明, **不下发全文与关键词表**. ' +
      '危机赛道的剧本内容受控, 请放在独立入口里呈现.',
  })
  list(@Query() query: DrillListQueryDto): DrillListDto {
    return this.drillService.list(query.track);
  }

  /**
   * GET /counselor/drills/:drillId
   *
   * 返回开练所需内容 (人设 / 场景 / 来访者原话 / 锚点 key+label).
   */
  @Get(':drillId')
  @ApiOperation({
    summary: '取一个剧本开练',
    description:
      '返回人设 / 场景说明 / 来访者原话 / 需要覆盖的技术点 (只有 key+label). ' +
      '**不下发关键词表** (下发即等于发答案), 参考回应与常见偏差在判定结果里才出现. ' +
      '找不到该剧本 → 404.',
  })
  detail(@Param('drillId') drillId: string): DrillDetailDto {
    return this.drillService.detail(drillId);
  }

  /**
   * POST /counselor/drills/:drillId/respond
   *
   * 提交一次回应, 出判定 (档位 / 覆盖清单 / 零压批注 / 参考回应).
   */
  @Post(':drillId/respond')
  @ApiOperation({
    summary: '提交回应并出判定',
    description:
      'submittedText 必填非空 (空串 → 400, 不伪造判定); recordSeconds 可选 (语音转写场景透传, 不参与判定). ' +
      '返回技术形态标签 (三档, 非分数/非对错) + 覆盖清单 + 3-5 条零压技术批注 + 参考回应. ' +
      "模型不可用时自动回落到关键词确定性判定, source='keyword', 不报错.",
  })
  respond(
    @CurrentUser() user: { userId: string },
    @Param('drillId') drillId: string,
    @Body() dto: SubmitDrillResponseDto,
  ): Promise<DrillResponseDto> {
    return this.drillService.respond(user.userId, drillId, dto);
  }
}

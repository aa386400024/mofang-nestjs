import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import { CompanionPersonsDto, SwitchPersonRequestDto } from '../dto/companion.dto';
import { CompanionPersonsService } from '../providers/companion.service';

/**
 * 顶部陪伴对象切换 controller — V2.0 §Tab2.
 *
 *   GET  /companion/persons                — 所有陪伴对象 + 当前 active
 *   POST /companion/persons/switch         — 切换当前对象
 *
 * 设计:
 *   - 1 个端点聚合 list + activePersonId, 前端切人时直接 reload overview
 *   - V2.0 占位: 不写 user_session.active_person_id, 只返新 activePersonId
 *   - 跟 home-companion-overview 的 switch-accompanied-person 不重复:
 *     那个是首页"快速切换"入口, 这个是 Tab2 顶部完整列表 + 切换
 */
@ApiTags('companion-persons')
@Controller('companion/persons')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CompanionPersonsController {
  constructor(private readonly service: CompanionPersonsService) {}

  @Get()
  @ApiOperation({ summary: '陪伴对象列表 + 当前 active' })
  public async listPersons(@CurrentUser() user: { userId: string }): Promise<CompanionPersonsDto> {
    return this.service.listPersons(user.userId);
  }

  @Post('switch')
  @ApiOperation({ summary: '切换当前陪伴对象' })
  public async switchPerson(@CurrentUser() user: { userId: string }, @Body() dto: SwitchPersonRequestDto): Promise<CompanionPersonsDto> {
    return this.service.switchPerson(user.userId, dto.personId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';

import {
  EmbodiedDevicesDto,
  EmbodiedDeviceDto,
  EmbodiedPermissionsDto,
  PairDeviceDto,
  UpdateEmbodiedPermissionsDto,
  VitalSignDto,
} from '../dto/embodied.dto';
import { EmbodiedService } from '../providers/embodied.service';

/**
 * 具身数据 controller — V2.0 §Tab4 embodied.
 *
 * 端点 (V2.0 范围):
 *   GET    /profile/embodied-data/vitals        - 实时生理数据 (V2 sample)
 *   GET    /profile/embodied-data/devices       - 已连接设备
 *   POST   /profile/embodied-data/devices       - 配对新设备
 *   DELETE /profile/embodied-data/devices/:id   - 断开设备
 *   GET    /profile/embodied-data/permissions   - 数据权限
 *   PUT    /profile/embodied-data/permissions   - 更新权限
 *   DELETE /profile/embodied-data/data          - 清除所有具身数据 (含断设备)
 *
 * 设计: 7 个端点, 跟前端 ProfileEmbodiedDataPage 7 区块 1:1 对应.
 */
@ApiTags('profile-embodied')
@Controller('profile/embodied-data')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EmbodiedController {
  constructor(private readonly service: EmbodiedService) {}

  @Get('vitals')
  @ApiOperation({ summary: '实时生理数据 (心率/HRV/呼吸)' })
  public async getVitals(@CurrentUser() user: { userId: string }): Promise<VitalSignDto> {
    return this.service.getVitalSigns(user.userId);
  }

  @Get('devices')
  @ApiOperation({ summary: '已连接的具身设备列表' })
  public async listDevices(@CurrentUser() user: { userId: string }): Promise<EmbodiedDevicesDto> {
    return this.service.listDevices(user.userId);
  }

  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '配对一个新设备' })
  public async pairDevice(@CurrentUser() user: { userId: string }, @Body() dto: PairDeviceDto): Promise<EmbodiedDeviceDto> {
    return this.service.pairDevice(user.userId, dto);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '断开一个具身设备 (软删, 保留 audit)' })
  public async unpairDevice(@CurrentUser() user: { userId: string }, @Param('id') id: string): Promise<{ disconnected: true; id: string }> {
    return this.service.unpairDevice(user.userId, id);
  }

  @Get('permissions')
  @ApiOperation({ summary: '数据权限管理 (4 开关 + 总闸)' })
  public async getPermissions(@CurrentUser() user: { userId: string }): Promise<EmbodiedPermissionsDto> {
    return this.service.getPermissions(user.userId);
  }

  @Put('permissions')
  @ApiOperation({ summary: '更新数据权限 (部分更新)' })
  public async updatePermissions(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateEmbodiedPermissionsDto,
  ): Promise<EmbodiedPermissionsDto> {
    return this.service.updatePermissions(user.userId, dto);
  }

  @Delete('data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '清除所有具身数据 + 断开所有设备 (二次确认由前端负责)' })
  public async clearAllData(@CurrentUser() user: { userId: string }): Promise<{ cleared: true }> {
    return this.service.clearAllData(user.userId);
  }
}

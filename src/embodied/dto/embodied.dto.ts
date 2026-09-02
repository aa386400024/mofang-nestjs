import { ApiProperty } from '@nestjs/swagger';

import type { EmbodiedDeviceStatus, EmbodiedDeviceType } from '../../shared/types/practice.types';

/**
 * 具身数据 DTO — V2.0 §Tab4 embodied.
 *
 * V2.0 范围:
 *   - 实时生理数据 (心率/HRV/呼吸) — V2 占位 sample, V3 接传感器流
 *   - 设备绑定 (已连接设备 + 配对/断开)
 *   - 数据权限管理 (4 个开关 + 1 个总闸)
 *   - 历史数据 (导出 / 清除)
 *
 * 设计要点: 所有 DTO 字段跟前端 ProfileEmbodiedDataPage 1:1, 不暴露多余字段.
 */

/** 实时生理数据 — 单卡片. */
export class VitalSignDto {
  @ApiProperty({ description: '心率 (bpm)', example: 72 })
  heartRate!: number;

  @ApiProperty({ description: 'HRV (ms)', example: 48.3 })
  hrv!: number;

  @ApiProperty({ description: '呼吸频率 (次/分)', example: 14.5 })
  breathRate!: number;
}

/** 已连接设备. */
export class EmbodiedDeviceDto {
  @ApiProperty({ description: '设备 id', example: 'uuid-v4' })
  id!: string;

  @ApiProperty({ description: '设备类型', enum: ['heart_rate_band', 'hrv_monitor', 'smartwatch', 'breath_sensor'] })
  deviceType!: EmbodiedDeviceType;

  @ApiProperty({ description: '设备显示名', example: '心率手环 · HUAWEI Band 9' })
  deviceName!: string;

  @ApiProperty({ description: '状态', enum: ['connected', 'unstable', 'disconnected'] })
  status!: EmbodiedDeviceStatus;

  @ApiProperty({ description: '电量 0-100', example: 78 })
  batteryPct!: number;
}

/** 设备列表响应. */
export class EmbodiedDevicesDto {
  @ApiProperty({ type: [EmbodiedDeviceDto] })
  items!: EmbodiedDeviceDto[];
}

/** 配对设备请求 DTO. */
export class PairDeviceDto {
  @ApiProperty({ description: '设备类型', enum: ['heart_rate_band', 'hrv_monitor', 'smartwatch', 'breath_sensor'] })
  deviceType!: EmbodiedDeviceType;

  @ApiProperty({ description: '设备显示名', example: '心率手环 · HUAWEI Band 9' })
  deviceName!: string;

  @ApiProperty({ description: '电量 0-100', example: 78, required: false })
  batteryPct?: number;
}

/** 4 个权限开关 + 1 个总闸. */
export class EmbodiedPermissionsDto {
  @ApiProperty({ description: '练习实时引导 (心率/HRV)', example: true })
  practiceRealtimeGuide!: boolean;

  @ApiProperty({ description: '心理健身分析', example: true })
  fitnessAnalytics!: boolean;

  @ApiProperty({ description: '情绪被动识别', example: false })
  emotionPassiveRecognition!: boolean;

  @ApiProperty({ description: '匿名化趋势分享', example: false })
  anonymousTrendShare!: boolean;

  @ApiProperty({ description: '传感器总闸 (关掉降级手动模式)', example: true })
  masterSensorEnabled!: boolean;
}

/** 更新权限请求 DTO — 全字段可选, 只更新传了的字段. */
export class UpdateEmbodiedPermissionsDto {
  @ApiProperty({ required: false })
  practiceRealtimeGuide?: boolean;

  @ApiProperty({ required: false })
  fitnessAnalytics?: boolean;

  @ApiProperty({ required: false })
  emotionPassiveRecognition?: boolean;

  @ApiProperty({ required: false })
  anonymousTrendShare?: boolean;

  @ApiProperty({ required: false })
  masterSensorEnabled?: boolean;
}

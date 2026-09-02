import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';

import {
  EmbodiedDeviceDto,
  EmbodiedDevicesDto,
  EmbodiedPermissionsDto,
  PairDeviceDto,
  UpdateEmbodiedPermissionsDto,
  VitalSignDto,
} from '../dto/embodied.dto';
import { EmbodiedDevice } from '../entities/embodied-device.entity';
import { EmbodiedPermissions } from '../entities/embodied-permission.entity';

/**
 * 具身数据服务 — V2.0 §Tab4 embodied.
 *
 * 范围限定 (V2.0):
 *   - 实时生理数据 (sample, 不接传感器流)
 *   - 设备绑定 (CRUD: list/pair/disconnect)
 *   - 数据权限 (4 开关 + 总闸, 全字段可选 update)
 *   - 历史数据 (clear / export 占位)
 *
 * V2.0 设计取舍:
 *   - V2.0 仅做"元数据 + 权限"管理, 真正生理数据流走 BLE/SDK
 *   - 端侧本地存储生理数据, 后端只存"用户授权了哪些模块"
 *   - V3 接 EventBus + sensor provider 后, 实时流走 MQTT/Kafka
 */
@Injectable()
export class EmbodiedService {
  private readonly logger = new Logger(EmbodiedService.name);

  constructor(
    @InjectRepository(EmbodiedDevice)
    private readonly deviceRepo: Repository<EmbodiedDevice>,
    @InjectRepository(EmbodiedPermissions)
    private readonly permRepo: Repository<EmbodiedPermissions>,
  ) {}

  // ─── 实时数据 (V2 占位) ──────────────────────────────────────
  /**
   * 取当前生理数据 — V2 占位返回 sample, 前端直接渲染.
   * V3 接 sensor 后, 改走 stream + cached value (Redis 5s TTL).
   */
  async getVitalSigns(_uid: string): Promise<VitalSignDto> {
    return {
      heartRate: 72,
      hrv: 48.3,
      breathRate: 14.5,
    };
  }

  // ─── 设备绑定 ────────────────────────────────────────────
  async listDevices(uid: string): Promise<EmbodiedDevicesDto> {
    const rows = await this.deviceRepo.find({
      where: { uid },
      order: { pairedAt: 'DESC' },
    });
    // V2 占位: DB 空时返回 sample (跟前端一致)
    const items: EmbodiedDeviceDto[] = rows.length
      ? rows.map((row) => this.toDeviceDto(row))
      : [
          {
            id: 'sample-device-1',
            deviceType: 'heart_rate_band',
            deviceName: '心率手环 · HUAWEI Band 9',
            status: 'connected',
            batteryPct: 78,
          },
        ];
    return { items };
  }

  /**
   * 配对设备 — 真实插入 DB.
   *
   * 业务约束:
   *   - 同 uid 下同 deviceType 只允许 1 个 connected 状态
   *   - 重复时返回 EmbodiedDeviceAlreadyPaired 错误码
   */
  async pairDevice(uid: string, dto: PairDeviceDto): Promise<EmbodiedDeviceDto> {
    const existing = await this.deviceRepo.findOne({
      where: { uid, deviceType: dto.deviceType, status: 'connected' },
    });
    if (existing) {
      throw new BizException(BizCode.EmbodiedDeviceAlreadyPaired, '该类型设备已绑定');
    }
    const row = this.deviceRepo.create({
      uid,
      deviceType: dto.deviceType,
      deviceName: dto.deviceName,
      status: 'connected',
      batteryPct: dto.batteryPct ?? 100,
    });
    const saved = await this.deviceRepo.save(row);
    this.logger.log(`uid=${uid} paired device ${saved.id} (${dto.deviceType})`);
    return this.toDeviceDto(saved);
  }

  /**
   * 断开设备 — 软删 (status → disconnected), 保留 audit.
   * 真实业务可选硬删, V2.0 走软删 (符合心理健康产品"可逆操作"原则).
   */
  async unpairDevice(uid: string, id: string): Promise<{ disconnected: true; id: string }> {
    const row = await this.deviceRepo.findOne({ where: { id, uid } });
    if (!row) {
      throw new BizException(BizCode.EmbodiedDeviceNotFound, '设备不存在或不属于你');
    }
    row.status = 'disconnected';
    await this.deviceRepo.save(row);
    this.logger.log(`uid=${uid} unpaired device ${id}`);
    return { disconnected: true, id };
  }

  // ─── 数据权限 ────────────────────────────────────────────
  async getPermissions(uid: string): Promise<EmbodiedPermissionsDto> {
    const row = await this.ensurePermissions(uid);
    return this.toPermissionsDto(row);
  }

  /**
   * 部分更新 — dto 未传的字段不动.
   */
  async updatePermissions(uid: string, dto: UpdateEmbodiedPermissionsDto): Promise<EmbodiedPermissionsDto> {
    const row = await this.ensurePermissions(uid);
    if (dto.practiceRealtimeGuide !== undefined) row.practiceRealtimeGuide = dto.practiceRealtimeGuide;
    if (dto.fitnessAnalytics !== undefined) row.fitnessAnalytics = dto.fitnessAnalytics;
    if (dto.emotionPassiveRecognition !== undefined) row.emotionPassiveRecognition = dto.emotionPassiveRecognition;
    if (dto.anonymousTrendShare !== undefined) row.anonymousTrendShare = dto.anonymousTrendShare;
    if (dto.masterSensorEnabled !== undefined) row.masterSensorEnabled = dto.masterSensorEnabled;
    const saved = await this.permRepo.save(row);
    return this.toPermissionsDto(saved);
  }

  // ─── 历史数据 (V2 占位) ──────────────────────────────────────
  /**
   * 清除所有具身数据 — V2 占位仅记录意图 (audit), 真实数据本地存储.
   * V3 接 sensor 流后, 同时清 Redis / 本地缓存 / 云端归档.
   */
  async clearAllData(uid: string): Promise<{ cleared: true }> {
    this.logger.warn(`uid=${uid} requested clear all embodied data (audit)`);
    // 同时断开所有 connected 设备 (语义: "清空所有" 隐含"重置")
    await this.deviceRepo.update({ uid, status: 'connected' }, { status: 'disconnected' });
    return { cleared: true };
  }

  // ─── helpers ───────────────────────────────────────────────
  private async ensurePermissions(uid: string): Promise<EmbodiedPermissions> {
    let row = await this.permRepo.findOne({ where: { uid } });
    if (!row) {
      row = this.permRepo.create({ uid });
      await this.permRepo.save(row);
    }
    return row;
  }

  private toDeviceDto(row: EmbodiedDevice): EmbodiedDeviceDto {
    return {
      id: row.id,
      deviceType: row.deviceType,
      deviceName: row.deviceName,
      status: row.status,
      batteryPct: row.batteryPct,
    };
  }

  private toPermissionsDto(row: EmbodiedPermissions): EmbodiedPermissionsDto {
    return {
      practiceRealtimeGuide: row.practiceRealtimeGuide,
      fitnessAnalytics: row.fitnessAnalytics,
      emotionPassiveRecognition: row.emotionPassiveRecognition,
      anonymousTrendShare: row.anonymousTrendShare,
      masterSensorEnabled: row.masterSensorEnabled,
    };
  }
}

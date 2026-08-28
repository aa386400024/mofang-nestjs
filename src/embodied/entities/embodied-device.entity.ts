import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import type { EmbodiedDeviceStatus, EmbodiedDeviceType } from '../../shared/types/practice.types';
import { User } from '../../user/entities/user.entity';

/**
 * 具身设备绑定 entity — V2.0 §Tab4 embodied 已连接设备.
 *
 * V2.0 范围限定: 仅元数据 (设备名/型号/电量/信号), 不做实时流.
 *   - 实时传感器流走 BLE / 厂商 SDK → 前端处理 → 端侧本地存储
 *   - 后端只存"绑定了哪些设备" + 设备元信息
 */
@Entity('embodied_devices')
@Index('idx_embodied_devices_uid', ['uid'])
@Index('idx_embodied_devices_uid_status', ['uid', 'status'])
export class EmbodiedDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'char', length: 36, name: 'uid' })
  uid!: string;

  @Column({ type: 'varchar', length: 32, name: 'device_type' })
  deviceType!: EmbodiedDeviceType;

  @Column({ type: 'varchar', length: 80, name: 'device_name' })
  deviceName!: string;

  @Column({ type: 'varchar', length: 32, name: 'status', default: 'connected' })
  status!: EmbodiedDeviceStatus;

  @Column({ type: 'tinyint', name: 'battery_pct', default: 100 })
  batteryPct!: number;

  @CreateDateColumn({ name: 'paired_at' })
  pairedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uid', referencedColumnName: 'uid' })
  user?: User;
}

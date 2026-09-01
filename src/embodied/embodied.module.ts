import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';

import { EmbodiedController } from './controllers/embodied.controller';
import { EmbodiedDevice } from './entities/embodied-device.entity';
import { EmbodiedPermissions } from './entities/embodied-permission.entity';
import { EmbodiedService } from './providers/embodied.service';

/**
 * 具身数据模块 — V2.0 §Tab4 embodied.
 *
 * V2.0 范围: 元数据 + 权限管理, 不做传感器实时流.
 *
 * 设计要点:
 *   - 2 entity: EmbodiedDevice (设备绑定 1:N) + EmbodiedPermissions (1:1 权限)
 *   - 跟 membership / notification_settings / user_profile 一致的 1:1 + ensure 模式
 *   - 实时数据 V3 通过 EventBus + Redis stream 接入 (sensor-sdk → main process → REST)
 */
@Module({
  imports: [TypeOrmModule.forFeature([EmbodiedDevice, EmbodiedPermissions]), UserModule],
  controllers: [EmbodiedController],
  providers: [EmbodiedService],
  /**
   * V2026-09-01 治本 (反双胞胎):
   *   EmbodiedService 暴露给兄弟模块 (PracticeModule) 复用 — 避免
   *   PracticeModule 重复实现设备/权限 CRUD, 单源真相 (single source of truth).
   *   兄弟模块通过 `imports: [EmbodiedModule]` + `constructor(private s: EmbodiedService)`
   *   注入, 大厂 NestJS DI standard.
   */
  exports: [EmbodiedService, TypeOrmModule],
})
export class EmbodiedModule {}

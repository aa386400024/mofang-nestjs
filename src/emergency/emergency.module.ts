// V2026-09-04 治本 (V6.0 §4.2):
//   急救模块 — 仅做急救会话上报 + 跨设备同步 + 工具效果统计.
//   急救工具本身 (5 个) 在端侧 SQLCipher + 前端 UI, 不在服务端.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module.js';

import { EmergencyController } from './controllers/emergency.controller.js';
import { EmergencySessionRepositoryTypeorm } from './data/emergency-session.repository.typeorm.js';
import { EMERGENCY_SESSION_REPOSITORY } from './domain/repositories/emergency-session.repository.js';
import { EmergencySessionEntity } from './entities/emergency-session.entity.js';
import { EmergencyService } from './providers/emergency.service.js';

/**
 * V2026-11-15 治本 (TD-19 · C2 第三批仓储端口化 · emergency 域 · P-DEBT-11 / L-1):
 *   - 装配层接入**端口**: EMERGENCY_SESSION_REPOSITORY → EmergencySessionRepositoryTypeorm
 *   - **保留** TypeOrmModule.forFeature([EmergencySessionEntity]) —— 实现层的实体仓储
 *     注入靠它拿真库仓储; forFeature 是本域 typeorm 值符号的第二个 (也是最后一个)
 *     允许出现的位置
 *   - **保留** UserModule import (跨域依赖: JWT Guard / CurrentUser 装饰器来自 user 域)
 *   - 仓储 token **不 export** —— 本域无跨模块仓储消费 (对齐 TD-13 D-4 / TD-16 / TD-17 / TD-18)
 *   - exports 口径不变: 仍只导出 EmergencyService
 */
@Module({
  imports: [TypeOrmModule.forFeature([EmergencySessionEntity]), UserModule],
  controllers: [EmergencyController],
  providers: [EmergencyService, { provide: EMERGENCY_SESSION_REPOSITORY, useClass: EmergencySessionRepositoryTypeorm }],
  exports: [EmergencyService],
})
export class EmergencyModule {}

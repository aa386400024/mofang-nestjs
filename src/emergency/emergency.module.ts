// V2026-09-04 治本 (V6.0 §4.2):
//   急救模块 — 仅做急救会话上报 + 跨设备同步 + 工具效果统计.
//   急救工具本身 (5 个) 在端侧 SQLCipher + 前端 UI, 不在服务端.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';

import { EmergencyController } from './controllers/emergency.controller';
import { EmergencySessionEntity } from './entities/emergency-session.entity';
import { EmergencyService } from './providers/emergency.service';

@Module({
  imports: [TypeOrmModule.forFeature([EmergencySessionEntity]), UserModule],
  controllers: [EmergencyController],
  providers: [EmergencyService],
  exports: [EmergencyService],
})
export class EmergencyModule {}

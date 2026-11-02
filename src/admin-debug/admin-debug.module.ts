// V2026-10-29 (WP19 · AdminDebugModule):
//   职责: 调试器 SPA 的只读 API + 每轮 trace 记录服务.
//   边界: 不做写操作; 不做 JWT guard (本地调试, 仅 localhost); 不做鉴权.

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminDebugController } from './admin-debug.controller.js';
import { TraceRecorder } from './trace-recorder.service.js';
import { TrainingSession } from '../counselor/entities/training-session.entity.js';
import { VisitorPoolTemplate } from '../counselor/entities/visitor-pool-template.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([TrainingSession, VisitorPoolTemplate])],
  controllers: [AdminDebugController],
  providers: [TraceRecorder],
  exports: [TraceRecorder],
})
export class AdminDebugModule {}

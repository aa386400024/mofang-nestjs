import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';

import { LifeMapController } from './controllers/life-map.controller';
import { GenomeDimensionEntity, KeyEventEntity, LifeStageProgressEntity } from './entities';
import { LifeMapService } from './providers/life-map.service';

/**
 * 人生地图模块 — V3.0 §3 Tab3 完整业务化.
 *
 * 实体注册:
 *   - LifeStageProgressEntity: 4 阶段任务完成度 (一行一阶段)
 *   - KeyEventEntity: 关键事件 CRUD
 *   - GenomeDimensionEntity: 5 维度盘点 (一行一维度)
 *
 * V3.0 治本:
 *   - 用 TypeOrmModule.forFeature 注册实体
 *   - 路由 /profile/life-map/* 命名空间跟 V2.0 兼容, 前端不需改 path
 *   - 推演本地规则引擎: 不依赖外部 AI 服务, V3.0 §7.1 RAG 不涉及
 */
@Module({
  imports: [UserModule, TypeOrmModule.forFeature([LifeStageProgressEntity, KeyEventEntity, GenomeDimensionEntity])],
  controllers: [LifeMapController],
  providers: [LifeMapService],
  exports: [LifeMapService],
})
export class LifeMapModule {}

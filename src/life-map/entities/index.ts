/**
 * 人生地图实体 barrel — V3.0 §3 Tab3.
 *
 * 设计原则:
 *   - 单一聚合入口, module / service / controller 一律 `from '../entities'`
 *   - 实体类型 + 同源枚举 + 同源 const 一起导出, 避免重复定义
 *   - 后续 entity 文件改名 / 拆分 / 新增, 仅需在此处维护 import 路径
 *
 * 范围:
 *   - LifeStageProgressEntity: 4 阶段任务完成度
 *   - KeyEventEntity + KeyEventType: 关键事件 CRUD + 类型枚举
 *   - GenomeDimensionEntity + GenomeDimensionKey + GENOME_DIMENSION_KEYS:
 *     心理基因盘点 5 维度 + 枚举
 */
export { GENOME_DIMENSION_KEYS, GenomeDimensionEntity, type GenomeDimensionKey } from './genome-dimension.entity';
export { KEY_EVENT_TYPES, KeyEventEntity, type KeyEventType } from './key-event.entity';
export { LifeStageProgressEntity } from './life-stage-progress.entity';

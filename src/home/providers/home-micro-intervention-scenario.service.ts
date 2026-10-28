import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MicroInterventionScenarioDto } from '../dto/home-overview.dto';
import { MicroInterventionScenario } from '../entities/micro-intervention-scenario.entity';

/**
 * 微干预场景化元数据服务 — V2026-09-11 新增 (消除前端硬编双胞胎).
 *
 * 职责:
 *   - listActive(): 拉所有 is_enabled=true 的场景, 按 display_order ASC
 *
 * 大厂做法:
 *   - 7 行常量表, 单 query 拿全部, 内存 toDto (避免每行单独 map).
 *   - 走 ORDER BY display_order ASC, is_enabled DESC 复合索引.
 *   - V3 接 cache: 加 Redis 缓存 (key=`home:mi:scenarios:v1`, TTL=5min),
 *     运营改了表手动 invalidate.
 */
@Injectable()
export class HomeMicroInterventionScenarioService {
  constructor(
    @InjectRepository(MicroInterventionScenario)
    private readonly scenarioRepo: Repository<MicroInterventionScenario>,
  ) {}

  /**
   * 拉所有启用场景 (按 display_order ASC).
   *
   * V2026-09-11 治本:
   *   - 旧: 前端硬编 5 个场景 (meeting/sleep/social/argument/feed),
   *     跟后端 7 trigger 双胞胎.
   *   - 新: 后端查表, 一次下发, 前端 3 处 UI 全部消费.
   */
  async listActive(): Promise<MicroInterventionScenarioDto[]> {
    const rows = await this.scenarioRepo.find({
      where: { isEnabled: true },
      order: { displayOrder: 'ASC' },
    });
    // V2026-09-11 治本 (@typescript-eslint/unbound-method):
    //   `rows.map(this.toDto)` 里 this 不一定绑到 instance (map callback
    //   可能被 callback receiver 调, this 指向 callback). 用 arrow function
    //   包一层闭包, 显式捕获当前 instance, 杜绝 unbound-method 错误.
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Entity → DTO (V2026-09-11 新增 mapper).
   *
   * 集中一处, 字段顺序跟前端 MicroInterventionScenario entity 1:1 对齐.
   * 改字段必须同步两端 (跟 entity 顺序约定一致).
   */
  private toDto(row: MicroInterventionScenario): MicroInterventionScenarioDto {
    return {
      trigger: row.trigger,
      scenario: row.scenario,
      icon: row.icon,
      kind: row.kind,
      durationSeconds: row.durationSeconds,
      category: row.category,
      triggerDescription: row.triggerDescription,
      accentKey: row.accentKey,
      displayOrder: row.displayOrder,
      isEnabled: row.isEnabled,
    };
  }
}

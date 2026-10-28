// V2026-10-09 治本 (Phase 6.2 — Persona REST 端点 — SPEC §11.1 + V0.5 增量):
//   用途: 前端 voice 启动页 (Phase 6.3) 拉 persona 列表, 选 l1_zhang / l2_li / l3_wang
//   鉴权: JwtAuthGuard, tenantId 从 JWT 拿, repo.listActive 自动按 tenant 过滤
//   端点: GET /agent/personas
//
//   反双胞胎:
//     - 不暴露 isActive / knowledgeRefs — 内部字段, V1.x admin 后台再分权
//     - 不分页 — V0.x 内存, 3 个种子 persona, 列表全量返
//     - 不写 service facade — V0.5 controller 直连 repository (跟 SupervisorController 同)
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. curl GET /agent/personas (带 Bearer JWT) 返 3 个种子 (default tenant)
//     3. 跨租户隔离: 业务租户看不到 default tenant 的 persona (V1.x 验证, V0.x 单一 tenant)

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../auth/guards';
import { TenantId } from '../../common/decorators';
import type { Persona } from './domain/entities/persona.entity';
import { PERSONA_REPOSITORY, type PersonaRepository } from './domain/repositories/persona.repository';

@Controller('agent/personas')
@UseGuards(JwtAuthGuard)
export class PersonaController {
  constructor(@Inject(PERSONA_REPOSITORY) private readonly personas: PersonaRepository) {}

  /**
   * GET /agent/personas
   * @returns 活跃 persona 列表 (V0.x: 3 个种子 l1/l2/l3)
   */
  @Get()
  async listActive(@TenantId() tenantId: string): Promise<readonly PersonaDto[]> {
    const rows = await this.personas.listActive(tenantId);
    return rows.map(toDto);
  }
}

/** 公开 DTO — 跟后端 Persona entity 字段一致, V0.5 不脱敏 (V0.x 单租户, V1.x 拆公开/内部). */
export interface PersonaDto {
  readonly id: string;
  readonly name: string;
  readonly age: number;
  readonly personality: string;
  readonly complaint: string;
  readonly background: string;
  readonly emotionBaseline: string;
  readonly defenseLevel: number;
  readonly difficulty: string;
  readonly voiceId: string;
}

function toDto(p: Persona): PersonaDto {
  return {
    id: p.id,
    name: p.name,
    age: p.age,
    personality: p.personality,
    complaint: p.complaint,
    background: p.background,
    emotionBaseline: p.emotionBaseline,
    defenseLevel: p.defenseLevel,
    difficulty: p.difficulty,
    voiceId: p.voiceId,
  };
}

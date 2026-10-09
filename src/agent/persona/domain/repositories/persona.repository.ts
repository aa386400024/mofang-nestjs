// V2026-10-09 治本 (Persona 仓储接口 — SPEC §11.1):
//   抽象: 业务层 (VisitorService / VoiceService) 只依赖 PersonaRepository
//     接口 + PERSONA_REPOSITORY token, 不感知具体实现
//   关键方法:
//     - findById(tenantId, id): 加载具体 persona, 找不到返回 null
//     - listActive(tenantId): 列活跃 persona (V1.x 管理后台用, V0.x 预留)
//     - findDefault(tenantId): 兜底 default persona, 不存在返回 null
//   V0.x: 内存实现 (data/persona.repository.memory.ts)
//   V1.x: TypeORM 实现 (data/persona.repository.typeorm.ts) — 字段映射零成本
//
//   反双胞胎:
//     - 不用 generic Repository<T> — persona 是核心业务实体, 自定义方法更可读
//     - 不暴露 EntityManager — 业务层不写 SQL, 通过接口即可
//     - 不在接口里加 update/delete — V0.x 不写, V1.x 由 admin 模块补
//
//   如何验证:
//     1. 单元测试 mock PersonaRepository, VisitorService 不感知具体实现
//     2. 启动时 seed 3 个 demo persona, listActive 返回长度 3
//     3. findById 不存在 → 返回 null, 不 throw (业务层显式判空)

import type { Persona } from '../entities/persona.entity';

/** 仓储接口契约. */
export interface PersonaRepository {
  /**
   * 按 ID 加载 persona.
   * @param tenantId 租户隔离, V0.x 传 'default' 即可
   * @param id persona id
   * @returns 找不到返回 null (不 throw, 业务层显式判空)
   */
  findById(tenantId: string, id: string): Promise<Persona | null>;

  /**
   * 列活跃 persona.
   * V0.x: admin 调试用 / fallback 列表
   * V1.x: 管理后台 "选择来访者" 页面
   */
  listActive(tenantId: string): Promise<readonly Persona[]>;

  /**
   * 兜底 default persona.
   * 业务调用: findById(tenantId, requestedId) ?? await findDefault(tenantId)
   * 内存实现 seed 第一个 persona; TypeORM 实现按 is_default 字段查.
   */
  findDefault(tenantId: string): Promise<Persona | null>;
}

/** DI token — NestJS 注入用. */
export const PERSONA_REPOSITORY = Symbol('PERSONA_REPOSITORY');

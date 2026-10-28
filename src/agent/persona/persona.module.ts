// V2026-10-09 治本 (Persona 子模块 — SPEC §11.1):
//   导出: PERSONA_REPOSITORY (供 Visitor / Voice / 后续 Admin 模块注入)
//   复用: ConfigModule (全局已注入, 不要再 import)
//   V0.x 实现: PersonaRepositoryMemory (内存种子)
//   V1.x 切换: 改 useClass 为 PersonaRepositoryTypeorm (无接口变化)
//
//   反双胞胎:
//     - 不在 Module 里 import VoiceModule — 单向依赖
//     - 不引入 TypeOrmModule.forFeature — V0.x 没 DB 表, 注入会启动报错
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. 启动后 AgentModule 包含 PERSONA_REPOSITORY provider
//     3. 单元测试可 override provider 注入 mock

import { Module } from '@nestjs/common';

import { PersonaRepositoryMemory } from './data/persona.repository.memory';
import { PERSONA_REPOSITORY } from './domain/repositories/persona.repository';
import { PersonaController } from './persona.controller';

@Module({
  controllers: [PersonaController],
  providers: [
    {
      provide: PERSONA_REPOSITORY,
      useClass: PersonaRepositoryMemory,
    },
  ],
  exports: [PERSONA_REPOSITORY],
})
export class PersonaModule {}

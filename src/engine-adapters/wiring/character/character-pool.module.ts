// V2026-10-29 治本 (WP9-B · B 层 · 角色资产池 NestJS 模块):
//   职责: 把「角色资产池」这块能力**自成一个 Nest 模块** —— 表实体注册 + 角色解析
//         端口绑定 (builtin / db 可切) + 内部管理端点.
//   边界: 只装配, 不含决策; 不碰引擎注入点 (EngineStreamBackend / voice 窄接口 /
//         内核 三者零改动).
//
//   为什么单独成模块 (而不是把 provider 堆进 EngineWiringModule):
//     ① 架构纪律: 引擎装配层 (wiring/) 有一条硬约束 —— **不得直接依赖 ORM / 向量库 /
//        厂商 SDK** (WP8-A §8-9 单测按包名判定). 角色资产池**必须**连库, 若把它的
//        provider 直接写进 engine.module.ts, 引擎装配层就会 import '@nestjs/typeorm'
//        —— 护栏立刻红, 而"为了让护栏变绿去改护栏"是错的.
//        所以: DB 相关的东西全部关进本模块, 引擎装配层只 import 本模块 (相对路径).
//     ② 职责内聚: 角色池 = 一张表 + 一个端口绑定 + 一组管理端点, 自成一块.
//        将来要做"单一角色注册中心" (任务单 §11.1) 时, 本模块整体迁移即可,
//        引擎装配层与 voice 侧一行都不用动.
//     ③ 数据源可切: 端口绑定 (builtin / db) 落在本模块的 useFactory 里,
//        换数据源只改这一处 —— 任务单 §5 的"只改一行绑定"在此落地.
//
//   反双胞胎:
//     - 不把 CHARACTER_PROFILE_RESOLVER 的绑定拆到两个模块: 一个 token 只能有一个
//       provider, 否则 Nest 报 ambiguous dependency.
//     - 不在本模块里读 env 之外的配置: 数据源标识仍走 ConfigService (可回落
//       process.env), 与 WP9-A 同一口径.
//     - 不在本模块里做角色语义判断: 只装配, 语义全在 character/ 里.
//
//   验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp8-wiring.spec.ts §8-9 护栏仍绿 (引擎装配层零 SDK 依赖)
//     3. test/engine-adapters/wp9b-*.spec.ts 覆盖 resolver / 内容基线 / 管理端
//
//   时间戳: 2026-10-29

import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { BUILTIN_CHARACTER_SEEDS, BuiltinCharacterProfileResolver } from './builtin-character-registry';
import { CharacterProfileAdminController } from './character-profile.admin.controller';

import { CharacterProfileAdminService } from './character-profile.admin.service';
import { CharacterProfileEntity } from './character-profile.entity';
import { CHARACTER_PROFILE_RESOLVER, type CharacterProfileResolver } from './character-profile.resolver';
import { DbCharacterProfileResolver } from './db-character-profile.resolver';
import { AdminRoleGuard } from '../../../counselor/guards/admin-role.guard';
import { UserModule } from '../../../user';

/**
 * 角色资产池模块.
 */
@Module({
  imports: [
    // character_profiles 实体注册 (autoLoadEntities 已开; ADR-0003: 不开 synchronize,
    // schema 只走 migration).
    TypeOrmModule.forFeature([CharacterProfileEntity]),
    // 管理端鉴权依赖 (JwtAuthGuard → JwtService/JwtBlacklistService; AdminRoleGuard → UserService).
    UserModule,
  ],
  controllers: [CharacterProfileAdminController],
  providers: [
    // 角色解析端口 (可替换数据源). 本期两个实现: 内置种子 (回退/测试档) + MySQL (默认档).
    {
      provide: CHARACTER_PROFILE_RESOLVER,
      useFactory: (config: ConfigService, repo: Repository<CharacterProfileEntity>): CharacterProfileResolver => {
        const source = readCharacterSource(config);
        if (source === 'builtin') {
          return new BuiltinCharacterProfileResolver(BUILTIN_CHARACTER_SEEDS);
        }
        if (source !== 'db') {
          // 不静默假装生效: 配置了还没实现, 必须让人看见.
          new Logger(CharacterPoolModule.name).warn(`[WP9-B] ENGINE_CHARACTER_SOURCE=${source} 尚未实现, 本轮回退 db 数据源`);
        }
        return new DbCharacterProfileResolver(repo);
      },
      inject: [ConfigService, getRepositoryToken(CharacterProfileEntity)],
    },
    // 角色资产池管理面 (内部 admin 端点).
    CharacterProfileAdminService,
    // 内部角色判定 (直读 users.admin_role) —— 仓库既有的内部能力守卫, 不新造第 4 套.
    AdminRoleGuard,
  ],
  exports: [CHARACTER_PROFILE_RESOLVER],
})
export class CharacterPoolModule {}

/**
 * 读角色数据源配置 (WP9-A 起, WP9-B 改默认值).
 *
 * 缺省 **db** (MySQL 角色池); `builtin` 保留为回退/测试档.
 * 其它值本期只记告警不改行为 (未实现的分支留占位).
 *
 * @param config 配置服务
 * @returns 归一化后的数据源标识
 */
function readCharacterSource(config: ConfigService): string {
  const raw = config.get<string>('ENGINE_CHARACTER_SOURCE');
  const source = (raw ?? 'db').trim().toLowerCase();
  return source.length > 0 ? source : 'db';
}

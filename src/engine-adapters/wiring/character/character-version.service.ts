// V2026-11-06 治本 (WP38 · 角色版本查询实现 — engine-adapters 侧):
//   职责: 回答"这个角色当前是第几版" —— 数据在 character_profiles, 由本类读.
//   边界: 只读 + 注册到 voice 层全局插槽; 零决策、零写入.
//
//   为什么实现放在 engine-adapters (而不是 counselor):
//     character_profiles 表归引擎侧 (实体与 resolver 都在 engine-adapters/wiring/character),
//     表的**消费者**也是引擎. 让 counselor 去查这张表 = 业务域反向依赖引擎域,
//     且将来"角色注册中心"收敛时 (任务单 §11.1) 要搬一次路由.
//     所以: 本类实现 voice 层的 CharacterVersionResolver 插槽, 落库桥只认插槽.
//
//   反双胞胎:
//     - 不在落库桥里直接 import 本类: 那就绕过了插槽, 依赖方向又变成 counselor → engine.
//     - 不缓存版本号: 版本号必须在**建会话那一刻**读实时值 —— 缓存会让"改了版本但
//       新会话仍记旧版本"发生 (版本号记错 = 溯源失效). 单行主键查询, 成本可忽略.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp38-character-version-semver.spec.ts 覆盖解析/回退
//
//   时间戳: 2026-11-06

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { CharacterProfileEntity } from './character-profile.entity.js';
import { formatCharacterVersion } from './character-version.js';
import { CharacterVersionRegistry, type CharacterVersionResolver } from '../../../voice/character-version-slot.js';

/**
 * 角色版本查询实现 (数据持有方 = engine-adapters).
 */
@Injectable()
export class CharacterVersionService implements OnModuleInit, CharacterVersionResolver {
  /** 解析器标识 (日志用). */
  readonly name = 'engine-character-pool';

  /**
   * @param repo character_profiles 仓储
   * @param registry voice 层全局插槽
   */
  constructor(
    @InjectRepository(CharacterProfileEntity)
    private readonly repo: Repository<CharacterProfileEntity>,
    private readonly registry: CharacterVersionRegistry,
  ) {}

  /** 启动时注册进 voice 侧插槽 (数据持有方提供实现, 同 VoiceTemplateResolver 范式). */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * 取角色当前版本号.
   *
   * @param templateId 公共模板 id
   * @returns semver 版本号; null = 没有这一行角色 (**不是错误** —— 该会话走无角色通道)
   */
  async resolve(templateId: string): Promise<string | null> {
    const row = await this.repo.findOne({ where: { templateId } });
    if (!row) {
      return null;
    }
    return formatCharacterVersion({
      major: row.versionMajor,
      minor: row.versionMinor,
      patch: row.versionPatch,
    });
  }
}

// V2026-11-06 治本 (WP38 · 角色占用查询插槽 — 依赖倒置):
//   职责: 声明"这个角色现在还有几场会话在用"这个接口 + 一个全局注册表.
//   边界: 纯类型 + 一个 @Global 注册表; 零 IO / 零 ORM.
//
//   为什么要有这个插槽:
//     角色主版本 (major) 的"进行中锁定"要数**活跃会话**, 而活跃会话住在
//     training_sessions (counselor 业务域的表). 判定代码在角色管理服务里
//     (engine-adapters 侧). 让 engine-adapters 直接查 counselor 的表 = engine → business
//     反向依赖 (仓库纪律禁止; 同 student-risk-audit-slot.ts 的说明).
//     于是: voice 层当中间位置 —— counselor 实现接口并注册, engine-adapters 消费接口.
//
//   为什么返回值是 number | null 而不是 number:
//     "查到了 0 场" 与 "没人能回答" 是**两件事**: 前者是"可以改主版本",
//     后者是"判不了". 混成一个 0 就等于把"查不到"当成"没人用" —— 锁定会静默失效.
//     调用方据此决定降级策略 (本仓口径: 查不到 → 放行 + 告警, 不硬挡管理操作).
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp38-character-version-semver.spec.ts 覆盖注册/计数/未注册(null)
//
//   时间戳: 2026-11-06

import { Injectable, Logger } from '@nestjs/common';

/**
 * 角色占用解析器 (会话数据持有方实现).
 */
export interface CharacterUsageResolver {
  /** 解析器标识 (日志用). */
  readonly name: string;
  /**
   * 数该角色当前的活跃会话数.
   *
   * @param templateId 公共模板 id
   * @returns 活跃会话数; null = 本解析器查不到 (**不是 0**)
   */
  countActiveSessions(templateId: string): Promise<number | null>;
}

/**
 * 角色占用注册表 (@Global 注入, 会话数据持有方在 onModuleInit 注册自己的实现).
 */
@Injectable()
export class CharacterUsageRegistry {
  private readonly logger = new Logger(CharacterUsageRegistry.name);
  /** 已注册的实现 (缺省 = 会话侧没装). */
  private readonly resolvers = new Map<string, CharacterUsageResolver>();

  /**
   * 注册一个解析器 (同 name 覆盖, 便于测试时热替换).
   *
   * @param resolver 解析器
   */
  register(resolver: CharacterUsageResolver): void {
    this.resolvers.set(resolver.name, resolver);
    this.logger.log(`[registered] character usage resolver: ${resolver.name}`);
  }

  /**
   * 注销一个解析器.
   *
   * @param name 解析器名
   */
  unregister(name: string): void {
    this.resolvers.delete(name);
  }

  /**
   * 数该角色当前的活跃会话 (跨解析器求和 —— 多个数据源各管一段时, 活跃会话是它们的并集).
   *
   * @param templateId 公共模板 id
   * @returns 活跃会话数; null = 无人能回答 (**不等于 0**)
   */
  async countActiveSessions(templateId: string): Promise<number | null> {
    let total: number | null = null;
    for (const resolver of this.resolvers.values()) {
      const count = await resolver.countActiveSessions(templateId);
      if (count === null) {
        continue;
      }
      total = (total ?? 0) + count;
    }
    return total;
  }
}

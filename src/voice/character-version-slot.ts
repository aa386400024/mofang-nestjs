// V2026-11-06 治本 (WP38 · 角色版本查询插槽 — 依赖倒置):
//   职责: 声明"这个角色当前是第几版"这个接口 + 一个全局注册表.
//   边界: 纯类型 + 一个 @Global 注册表; 零 IO / 零 ORM.
//
//   为什么要有这个插槽 (而不是让落库方直接查表):
//     角色版本住在 character_profiles (engine-adapters 的表), 而要把版本写进
//     training_sessions 的是 counselor 侧的落库桥 (voice → business 方向).
//     让 counselor 直接 import engine-adapters 的 entity/repository =
//     business → engine 反向依赖 —— 仓库既有纪律明令禁止 (见 student-risk-audit-slot.ts
//     的同款说明: "voice 层是两侧都能依赖的位置").
//     修法与 VoiceTemplateRegistry / StudentRiskAuditRegistry 同款:
//       · voice 侧只声明接口 + 全局注册表;
//       · 数据持有方 (engine-adapters) 实现接口并在自己的 onModuleInit 里注册;
//       · 消费方 (counselor 落库桥) 只认接口, 不认识任何 engine-adapters 类型.
//
//   反双胞胎:
//     - 不用 NestJS provider token 直接注入实现: 同名 token 在各 module 里各有一份,
//       消费方拿到的是自己 module 的那份, 业务实现根本到不了消费者;
//     - 不返回"版本对象"而只返回字符串: 跨层契约越窄越不容易漂 —— 消费方只需要
//       一个能落库的版本号, 不需要知道版本号的内部结构.
//
//   如何验证:
//     1. npx tsc -p tsconfig.build.json --noEmit 0 错
//     2. test/engine-adapters/wp38-character-version-semver.spec.ts 覆盖注册/查询/未注册
//
//   时间戳: 2026-11-06

import { Injectable, Logger } from '@nestjs/common';

/**
 * 角色版本解析器 (数据持有方实现).
 *
 * 实现方只需回答一个问题: "这个 templateId 当前的 semver 版本号是多少".
 */
export interface CharacterVersionResolver {
  /** 解析器标识 (日志用). */
  readonly name: string;
  /**
   * 取角色当前版本.
   *
   * @param templateId 公共模板 id
   * @returns semver 版本号 (例 "1.2.3"); null = 本解析器不认识该角色 (**不是错误**)
   */
  resolve(templateId: string): Promise<string | null>;
}

/**
 * 角色版本注册表 (@Global 注入, 数据持有方在 onModuleInit 注册自己的实现).
 */
@Injectable()
export class CharacterVersionRegistry {
  private readonly logger = new Logger(CharacterVersionRegistry.name);
  /** 已注册的实现 (缺省 = 数据持有方没装). */
  private readonly resolvers = new Map<string, CharacterVersionResolver>();

  /**
   * 注册一个解析器 (同 name 覆盖, 便于测试时热替换).
   *
   * @param resolver 解析器
   */
  register(resolver: CharacterVersionResolver): void {
    this.resolvers.set(resolver.name, resolver);
    this.logger.log(`[registered] character version resolver: ${resolver.name}`);
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
   * 取角色当前版本 (跨解析器按注册顺序取第一个命中).
   *
   * @param templateId 公共模板 id
   * @returns semver 版本号; null = 无人认识该角色
   */
  async resolve(templateId: string): Promise<string | null> {
    for (const resolver of this.resolvers.values()) {
      const version = await resolver.resolve(templateId);
      if (version) {
        return version;
      }
    }
    return null;
  }
}

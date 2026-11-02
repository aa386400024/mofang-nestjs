// V2026-10-23 治本 (公共人物模板解析插槽 — 依赖倒置, spec §2.2):
//   原因: WS 握手要校验 `templateId` 是否指向**已上架的公共人物** (查不到 →
//     `template_not_found` + close(1008), 不回退默认人物). 但这张表
//     (`visitor_pool_templates`) 属于 **counselor 业务域**, 而 WS 网关在 voice (agent 侧).
//     若 voice 直接 import counselor 的 entity/repository → agent → business 反向依赖,
//     将来 counselor 改表结构会连带炸语音链路, 且极易形成循环依赖.
//   修法: 跟仓库既有的 `VisitorContextRegistry` 同一套范式 —— **插槽 + 全局注册表**:
//     - voice 侧只声明"我需要一个模板摘要"这个接口 (VoiceTemplateResolver)
//     - counselor 侧实现该接口并注册进全局注册表
//     - voice 侧调注册表解析, **不认识** counselor 的任何类型
//   插槽返回的是**表层摘要** (不含 7 大块剧本): 剧本只在 counselor 侧内部读取,
//     跨模块契约里根本不出现它, "剧本不下发"这条红线由类型系统兜住.
//   反双胞胎:
//     - 不在 voice 侧直接注入 Repository: 那就是 agent → business 反向依赖
//     - 不用 NestJS provider token 直接注入实现: 同名 token 在各 module 里各有一份,
//       消费方拿到的是自己 module 的那份, 业务实现根本到不了消费者 (与
//       VisitorContextRegistry 注释里记的同一个坑)
//   验证:
//     1. tsc 0 错
//     2. 启动日志能看到 counselor 模板解析器注册成功
//     3. 不带 templateId 的普通 voice session 行为不变
//   时间戳: 2026-10-23

import { Injectable, Logger } from '@nestjs/common';

import type { VoiceTemplateSummary } from './voice-session.types';

/**
 * 模板解析器 (业务侧实现).
 *
 * 实现方只需回答一个问题: "这个 templateId 是不是一个已上架的公共人物? 是的话给我表层摘要".
 */
export interface VoiceTemplateResolver {
  /** 解析器标识 (日志用). */
  readonly name: string;
  /**
   * 解析模板.
   *
   * @param templateId 公共模板 id
   * @returns 表层摘要; **null** = 本解析器不认识该模板 (不是错误)
   * @throws 存储层异常等真实故障 (上层按"查询失败"处理, 不按"模板不存在"处理)
   */
  resolve(templateId: string): Promise<VoiceTemplateSummary | null>;
}

/**
 * 模板解析注册表 (@Global 注入, 业务模块在 onModuleInit 注册自己的实现).
 */
@Injectable()
export class VoiceTemplateRegistry {
  private readonly logger = new Logger(VoiceTemplateRegistry.name);
  private readonly resolvers = new Map<string, VoiceTemplateResolver>();

  /**
   * 注册一个解析器 (同 name 覆盖, 便于测试时热替换).
   *
   * @param resolver 解析器
   */
  register(resolver: VoiceTemplateResolver): void {
    this.resolvers.set(resolver.name, resolver);
    this.logger.log(`[registered] voice template resolver: ${resolver.name}`);
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
   * 解析模板 (跨解析器按注册顺序取第一个命中).
   *
   * @param templateId 公共模板 id
   * @returns 表层摘要; null = 无人认识该模板
   * @throws 解析器内部异常 (真实故障, 交由上层区分"不存在"与"查失败")
   */
  async resolve(templateId: string): Promise<VoiceTemplateSummary | null> {
    for (const resolver of this.resolvers.values()) {
      const summary = await resolver.resolve(templateId);
      if (summary) {
        return summary;
      }
    }
    return null;
  }
}

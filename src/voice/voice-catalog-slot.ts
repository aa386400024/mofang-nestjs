// V2026-10-26 治本 (账号可用音色查询插槽 — 依赖倒置, spec §任务 1 / §任务 2):
//   原因: WS 握手带了 `voiceId` 时, 需求要求「传入但不在账号可用系统音色内 → 回退 env
//     默认 + warn 日志, **不致命断连**」. 但"账号可用系统音色"是 **MiniMax 上游数据**
//     (POST /v1/get_voice), 上游客户端在 counselor 侧 (音色代理端点 /counselor/voices 的
//     实现), 而 WS 网关在 voice (agent) 侧 —— 直接 import 会形成 agent → business
//     反向依赖, 将来改音色目录口径会连带炸语音链路.
//   治法: 跟仓库既有的 `VoiceTemplateRegistry` 同一套范式 —— **插槽 + 全局注册表**:
//     - voice 侧只声明"我需要知道这个 voice_id 能不能用"这个接口 (VoiceCatalogResolver)
//     - counselor 侧实现该接口 (带 TTL 内存缓存) 并注册进全局注册表
//     - voice 侧调注册表判定, **不认识** counselor 的任何类型
//   判定结果是**三态**而不是布尔:
//     - `available`   : 确认在账号可用系统音色内 → 用它
//     - `unavailable` : 确认**不在** → 回退 env 默认 (需求明确要求的行为)
//     - `unknown`     : 判不出来 (上游故障 / 目录未就绪 / 还没人注册) → **不拦截**,
//                       交给 TTS 建连阶段把上游 2013 / 1004 归一成 error
//   为什么不是布尔: 上游挂掉时若返回 false, 合法音色会被误回退成 env 默认 ——
//     用户选了 A 音色却听到 B 音色, 且**没有任何报错**, 这比直接失败更糟.
//   反双胞胎:
//     - 不在 voice 侧直接注入 Repository / 直接 fetch 上游: 反向依赖
//     - 不用 NestJS provider token 直接注入实现: 同名 token 在各 module 里各有一份,
//       消费方拿到的是自己 module 的那份, 业务实现根本到不了消费者
//     - 不把"音色是否合法"做成握手期的硬校验: 一次上游抖动就断掉整场会谈, 代价太大
//   验证:
//     1. tsc 0 错
//     2. 启动日志能看到 "voice catalog resolver: counselor-voices" 注册成功
//     3. 握手带合法 voiceId → TTS 用该音色; 带不存在的 → 回退 env 默认 + warn 日志
//   时间戳: 2026-10-26

import { Injectable, Logger } from '@nestjs/common';

/**
 * 音色可用性判定结果 (三态).
 *
 * `unknown` 不是"没有数据", 而是"**判不出来**" —— 上游故障 / 目录未就绪 / 无人注册.
 * 调用方必须把它当成"不拦截"处理 (宁可让 TTS 建连报错, 也不要静默换音色).
 */
export type VoiceCatalogAvailability =
  /** 确认在账号可用系统音色内. */
  | 'available'
  /** 确认**不在**账号可用系统音色内 (调用方应回退 env 默认). */
  | 'unavailable'
  /** 判不出来 (上游故障 / 无人注册) —— 调用方按"不拦截"处理. */
  | 'unknown';

/**
 * 音色目录解析器 (业务侧实现).
 */
export interface VoiceCatalogResolver {
  /** 解析器标识 (日志用). */
  readonly name: string;
  /**
   * 判断某个 voice_id 是否在账号可用系统音色内.
   *
   * @param voiceId 待判定的音色 id
   * @returns 三态判定结果
   * @throws 真实故障 (注册表会捕获并降级成 `unknown`, 不影响其他解析器)
   */
  check(voiceId: string): Promise<VoiceCatalogAvailability>;
}

/**
 * 音色目录注册表 (@Global 注入, 业务模块在 onModuleInit 注册自己的实现).
 */
@Injectable()
export class VoiceCatalogRegistry {
  private readonly logger = new Logger(VoiceCatalogRegistry.name);
  private readonly resolvers = new Map<string, VoiceCatalogResolver>();

  /**
   * 注册一个解析器 (同 name 覆盖, 便于测试时热替换).
   *
   * @param resolver 解析器
   */
  register(resolver: VoiceCatalogResolver): void {
    this.resolvers.set(resolver.name, resolver);
    this.logger.log(`[registered] voice catalog resolver: ${resolver.name}`);
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
   * 判定音色可用性 (跨解析器取第一个能给出结论的).
   *
   * 单个解析器抛错 → 跳过它继续下一个; 全部都判不出来 → `unknown` (调用方不拦截).
   *
   * @param voiceId 音色 id
   * @returns 三态判定结果
   */
  async check(voiceId: string): Promise<VoiceCatalogAvailability> {
    for (const resolver of this.resolvers.values()) {
      try {
        const availability = await resolver.check(voiceId);
        if (availability !== 'unknown') {
          return availability;
        }
      } catch (error) {
        this.logger.warn(
          `[check_failed] resolver=${resolver.name} voice=${voiceId.slice(0, 64)} ` +
            `err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return 'unknown';
  }
}

// V2026-10-23 治本 (语音微训练 STT 代理 — 按 userId 的转写限流, spec §2.5):
//   原因: spec §2.5 要求"复用项目 @nestjs/throttler, **按 userId** 限制单位时间转写
//     次数". 全局 ThrottlerGuard 的 tracker 是 IP, 直接用会有两个真实问题:
//     ① 同一 NAT 出口 (公司 / 学校 / 家庭宽带) 下的多个用户互相挤占 —— 一个人刷
//        转写, 其他人被限流;
//     ② 单个用户换 IP (开热点 / 代理) 就能绕过配额, 配额形同虚设.
//     而**按 userId** 限流要求 tracker 能拿到用户身份, 身份来自 JwtAuthGuard 注入的
//     `request.user` —— 全局 ThrottlerGuard 跑在 JwtAuthGuard **之前** (NestJS guard
//     顺序: 全局 → controller → route), 那时 request.user 还是空的.
//   修法: 写一个**路由级** ThrottlerGuard 子类, 挂在端点方法上并排在 JwtAuthGuard
//     之后:
//     - tracker 改成 userId (拿不到时退到 IP, 防 NPE)
//     - 独立命名限流器 'practice-asr', 限值走 env, 不跟全局 'default' 抢同一把 key
//     - 触发时抛 BizException(RateLimited) 而不是默认的 ThrottlerException, 让前端
//       拿到项目统一的 { code, message, data } 结构
//   反双胞胎:
//     - 不改全局 ThrottlerGuard 的 tracker: 那是全站行为, 一改就波及所有端点
//     - 不自建 Redis 计数器: @nestjs/throttler 已经是项目标准设施, 换存储 = 换实现,
//       不该再造一个
//     - 不用裸 ThrottlerService.increment: 那样拿不到 X-RateLimit-* 响应头, 前后端
//       都少了"还剩几次"的信息
//   验证:
//     1. tsc 0 错
//     2. 同一用户连续转写超过阈值 → 429 + code=1003
//     3. 换用户 → 立刻恢复 (key 里带 userId)
//   时间戳: 2026-10-23
import { Injectable, Logger, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { PRACTICE_ASR_THROTTLER_NAME } from '../config/practice-asr.config';

/**
 * STT 端点专用限流 guard.
 *
 * 与全局 ThrottlerGuard 的关系: **并存, 不替换**.
 *   - 全局 guard: 全站 IP 级 60 次/分钟 (防单机刷爆所有端点)
 *   - 本 guard:  STT 端点 userId 级 N 次/分钟 (防单个账号把上游转写配额刷爆)
 * 两者 key 不同、维度不同, 互不干扰.
 */
@Injectable()
export class PracticeAsrThrottlerGuard extends ThrottlerGuard {
  // 父类的 `logger` 是 protected, 这里另起一个名字避免与父类成员冲突 (TS2415).
  private readonly asrLogger = new Logger(PracticeAsrThrottlerGuard.name);
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
    this.limit = Math.max(1, this.config.get<number>('practice.asrRateLimitPerMinute') ?? 10);
    this.windowMs = Math.max(1000, this.config.get<number>('practice.asrRateLimitWindowMs') ?? 60_000);
  }

  /**
   * 只保留本端点自己的命名限流器.
   *
   * 父类的 `onModuleInit` 会把**全局**配置的 throttlers 全部装进来; 本 guard 是
   * 路由级的, 只需要自己那一个 —— 留着全局的 'default' 会让同一个端点被计两次
   * (一次按 IP, 一次按 userId), 配额语义就乱了.
   */
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = [
      {
        name: PRACTICE_ASR_THROTTLER_NAME,
        ttl: this.windowMs,
        limit: this.limit,
      },
    ];
    this.asrLogger.log(`[init] throttler=${PRACTICE_ASR_THROTTLER_NAME} limit=${this.limit} window_ms=${this.windowMs}`);
  }

  /**
   * tracker = userId.
   *
   * 拿不到用户 (理论上不会: 本 guard 排在 JwtAuthGuard 之后) 时退到 IP, 保证不会
   * 因为 tracker 返回 undefined 而把所有人算成同一桶.
   */
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { userId?: unknown } | undefined;
    const userId = user?.userId;
    if (typeof userId === 'string' && userId.length > 0) {
      return `user:${userId}`;
    }
    const ip = typeof req['ip'] === 'string' && req['ip'].length > 0 ? req['ip'] : 'unknown';
    return `ip:${ip}`;
  }

  /** 抛项目统一的业务异常 (而不是 throttler 默认的 ThrottlerException). */
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    _throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new BizException(BizCode.RateLimited, `语音转写太频繁了，每分钟最多 ${this.limit} 次，请稍等几秒再试`);
  }
}

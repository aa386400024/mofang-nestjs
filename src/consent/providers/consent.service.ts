import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BizCode } from '../../common/exceptions/biz-code.enum.js';
import { BizException } from '../../common/exceptions/biz.exception.js';
import { RedisService } from '../../shared/infra/redis/redis.service.js';
import { CONSENT_REPOSITORY, type ConsentRepository } from '../domain/repositories/consent.repository.js';
import { ConsentStatusResponseDto } from '../dto/consent-status.dto.js';
import { RecordConsentDto } from '../dto/record-consent.dto.js';

/** AF-594: 同意正缓存 TTL. 只做每轮前置校验的短窗削峰, 不是权威状态. */
const CONSENT_ACCEPTED_CACHE_TTL_SECONDS = 300;

/**
 * Consent context — 审计所需的请求元数据.
 */
export interface ConsentContext {
  ipAddress: string;
  userAgent: string;
}

/**
 * ConsentService — 用户同意记录核心业务逻辑 (大厂合规级 V3).
 *
 * 设计要点:
 *   - 幂等写入: UNIQUE(deviceId, version, type) 约束保护, 重复 POST 仅刷新审计字段
 *   - 版本权威: 服务端通过 config.consent.currentVersion 决定需要重新弹 dialog 的客户端
 *   - 游客 → 用户迁移: bindToUser 把 device 上的所有 NULL user_id consent 关联到 user
 *   - 失败容忍: 不抛异常 (record 是 fire-and-forget 语义), 调用方无需 try/catch
 *
 * 不抛异常的原则:
 *   - 写入失败 → 返回 lastError 给调用方, 不 throw (前端 fire-and-forget 不受影响)
 *   - 状态查询失败 → 抛异常 (前端启动关键路径, 必须 fail-fast)
 *
 * V2026-11-14 治本 (TD-17 · C2 第一批仓储端口化 · consent 域 · P-DEBT-11 / L-1):
 *   - 仓储访问改走**端口** ($domain/repositories/consent.repository.js$ 的 interface
 *     + $CONSENT_REPOSITORY$ DI token), typeorm 值符号全部收进 $data/$ 的
 *     TypeORM 实现; service 不再出现 entity 类名, 不再值位置 import entity
 *   - **行的构造移到 service 侧** (纯对象), 仓储侧的工厂方法依赖移除 ——
 *     幂等更新时 service 带原 $acceptedAt$ / $updatedAt$, 「首写时间保留」语义不变
 *   - 公共签名 ($record$ / $checkStatus$ / $bindToUser$) 与失败语义**逐字不变**
 *   - ⚠️ 上方「不抛异常的原则」是**设计意图**, 当前实现**未加** try/catch ——
 *     写入失败实际会抛异常. 本单是结构重构, **不改失败语义**; 该注释与实现的
 *     不一致登记为另案 P (交付记录 §八), 不在本单顺手修.
 */
@Injectable()
export class ConsentService {
  private readonly log = new Logger(ConsentService.name);
  private readonly currentVersion: string;

  constructor(
    @Inject(CONSENT_REPOSITORY)
    private readonly repo: ConsentRepository,
    private readonly config: ConfigService,
    /**
     * AF-594: 同意前置校验的短 TTL 正缓存.
     *
     * 可选注入: 既有单测与未接 Redis 的宿主仍可直接 new ConsentService(repo, config).
     * Redis 不可用时静默回落 DB, 不改变 fail-fast 语义.
     */
    @Optional()
    private readonly redis?: RedisService,
  ) {
    // V2026-11-06 治本 (WP69 · 路径错误型 env 盲区):
    //   旧写法读的是**平铺键** 'consentCurrentVersion' —— 但 default.ts 里没有这个平铺字段
    //   (它在 config.consent 命名空间下), 所以读出来恒为 undefined → 永远回落 'v1.0',
    //   配 CONSENT_CURRENT_VERSION **不生效** (服务端不强制重弹同意 dialog).
    //   现在读**正确的路径** —— 配了 v2.0 就真的会要求客户端重新同意.
    this.currentVersion = this.config.get<{ currentVersion?: string }>('consent')?.currentVersion ?? 'v1.0';
  }

  /**
   * 记录用户同意 (幂等).
   *
   * @returns 新创建记录的 id + acceptedAt, 或已有记录的 id + 原始 acceptedAt
   */
  public async record(dto: RecordConsentDto, ctx: ConsentContext): Promise<{ id: string; acceptedAt: Date }> {
    // AF-594: 记录写入后使该用户该类型的正缓存失效, 保证撤回/重签立刻可见.
    const invalidate = async (userId: string | null): Promise<void> => {
      if (!userId || !this.redis) return;
      try {
        await this.redis.del(this.acceptedCacheKey(userId, dto.consentType));
      } catch {
        // 缓存失效失败最多让旧正缓存在 TTL 内继续命中, 不回滚已提交的写入.
      }
    };

    // 幂等查询: 已有则更新 IP/UA/metadata (审计), 保留原始 acceptedAt
    const existing = await this.repo.findByIdempotentKey({
      deviceId: dto.deviceId,
      consentVersion: dto.consentVersion,
      consentType: dto.consentType,
      appId: dto.appId,
    });

    if (existing) {
      this.log.debug(`[record] idempotent update: deviceId=${dto.deviceId.slice(0, 8)}... version=${dto.consentVersion}`);
      // 行纯对象 (service 内构造): 幂等更新带原 id / acceptedAt / updatedAt,
      // 只刷新审计三件套 (IP / UA / metadata) —— 与改前逐字一致.
      // metadata 缺省 (undefined) = 保留原值 —— 与改前 `if (dto.metadata !== undefined)`
      // 逐字一致; **不能用 ??** —— dto.metadata 显式为 null 时改前会写 null,
      // ?? 会保留原值 (语义漂移).
      let metadata = existing.metadata;
      if (dto.metadata !== undefined) {
        metadata = dto.metadata;
      }
      const saved = await this.repo.save({
        id: existing.id,
        userId: existing.userId,
        deviceId: existing.deviceId,
        consentVersion: existing.consentVersion,
        consentType: existing.consentType,
        platform: existing.platform,
        appId: existing.appId,
        acceptedAt: existing.acceptedAt,
        updatedAt: existing.updatedAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata,
      });
      await invalidate(saved.userId);
      return { id: saved.id, acceptedAt: saved.acceptedAt };
    }

    // 首次写入: userId 留 NULL, 登录后由 bindToUser 关联
    const saved = await this.repo.save({
      userId: null,
      deviceId: dto.deviceId,
      consentVersion: dto.consentVersion,
      consentType: dto.consentType,
      platform: dto.platform,
      appId: dto.appId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: dto.metadata ?? null,
    });
    this.log.log(`[record] new consent: id=${saved.id} device=${dto.deviceId.slice(0, 8)}... version=${dto.consentVersion}`);
    await invalidate(saved.userId);
    return { id: saved.id, acceptedAt: saved.acceptedAt };
  }

  /**
   * 查询设备同意状态 (含服务端版本强制升级语义).
   *
   * @returns hasAccepted + needReaccept + currentVersion (+ acceptedAt / consentVersion if has)
   */
  public async checkStatus(deviceId: string, consentType: string, appId: string): Promise<ConsentStatusResponseDto> {
    // 取最新一次同意记录 (任意版本)
    const accepted = await this.repo.findLatestByDevice(deviceId, consentType, appId);

    if (!accepted) {
      return {
        hasAccepted: false,
        needReaccept: true,
        currentVersion: this.currentVersion,
      };
    }

    const matched = accepted.consentVersion === this.currentVersion;
    return {
      hasAccepted: true,
      acceptedAt: accepted.acceptedAt.toISOString(),
      consentVersion: accepted.consentVersion,
      needReaccept: !matched,
      currentVersion: this.currentVersion,
    };
  }

  /**
   * 业务前置断言：用户必须已接受当前版本的目标协议，否则拒绝进入。
   *
   * AF-537 P0-10: consent 不能只“记录”，必须能在敏感业务入口真正拦住。
   *
   * @param userId 用户 uid
   * @param consentType 协议类型（如 `agreement+privacy` / `ai_chat`）
   * @throws BizException ConsentRequired（未同意或版本过期）
   */
  public async assertAccepted(userId: string, consentType: string): Promise<void> {
    const cacheKey = this.acceptedCacheKey(userId, consentType);
    if (this.redis) {
      try {
        if ((await this.redis.get(cacheKey)) === '1') return;
      } catch {
        // 缓存不可用不阻断业务, 回落 DB 校验.
      }
    }

    const accepted = await this.repo.findLatestByUser(userId, consentType);
    if (!accepted || accepted.consentVersion !== this.currentVersion) {
      throw new BizException(BizCode.ConsentRequired, `请先同意当前版本协议（${consentType} ${this.currentVersion}）`);
    }

    // 只缓存"当前版本已同意"的正结果; 未同意不缓存, 避免绑定/补记录后仍被旧否定命中.
    if (this.redis) {
      try {
        await this.redis.set(cacheKey, '1', CONSENT_ACCEPTED_CACHE_TTL_SECONDS);
      } catch {
        // 同上, 缓存写失败不影响本次校验.
      }
    }
  }

  /**
   * 撤回同意（用户行使撤回权）。
   *
   * @param userId 用户 uid
   * @param consentType 协议类型
   * @returns 删除的同意记录数
   */
  public async withdraw(userId: string, consentType: string): Promise<number> {
    const affected = await this.repo.deleteByUser(userId, consentType);
    if (this.redis) {
      try {
        await this.redis.del(this.acceptedCacheKey(userId, consentType));
      } catch {
        // 同 record: 失效失败不阻断撤回本身.
      }
    }
    this.log.log(`[withdraw] user=${userId.slice(0, 8)}... type=${consentType} rows=${affected}`);
    return affected;
  }

  /**
   * 登录后把 device 上的 consent 关联到 user (guest → user 迁移).
   *
   * @returns 实际更新的记录数
   */
  public async bindToUser(deviceId: string, userId: string): Promise<number> {
    const affected = await this.repo.bindDeviceToUser(deviceId, userId);

    if (affected > 0) {
      this.log.log(`[bindToUser] migrated ${affected} consents to user=${userId.slice(0, 8)}...`);
    }
    return affected;
  }

  /** AF-594: 缓存键带版本 —— 配置升版后旧正缓存自然失效. */
  private acceptedCacheKey(userId: string, consentType: string): string {
    return `consent:accepted:${this.currentVersion}:${consentType}:${userId}`;
  }
}

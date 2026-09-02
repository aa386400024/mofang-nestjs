import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../shared/infra/redis';
import { REDIS_KEYS } from '../../shared/infra/redis/redis.constants';

/**
 * JWT blacklist service (大厂 token 撤销标准).
 *
 * V2 升级 Redis:
 *   - key: jwt:blacklist:{jti}
 *   - TTL = 原 token expiresIn (到期自动清理)
 *   - 多实例共享 (cluster / sentinel 都行)
 *
 * 容错 (大厂标准 fail-open):
 *   - Redis 不可用时, blacklist 检查返回 false (即"未撤销")
 *   - 业务层风险: 已撤销的 token 还能用一次 (短暂的窗口)
 *   - 大厂做法: 优先 availability, 失败 fail-open (不让 Redis 故障拖垮登录)
 *   - V3 可加 Redis Sentinel 自动切换, 进一步降低不可用窗口
 */
@Injectable()
export class JwtBlacklistService {
  private readonly logger = new Logger(JwtBlacklistService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * 撤销单个 jti (TTL 到期自动清理).
   * 失败 fail-open: Redis 写入失败不阻塞主流程, 仅 log 告警.
   */
  async revoke(jti: string, expiresAtMs: number): Promise<void> {
    const ttlSec = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
    try {
      await this.redis.set(REDIS_KEYS.jwtBlacklist(jti), '1', ttlSec);
    } catch (err) {
      this.logger.warn(`jwt blacklist write failed: jti=${jti} (fail-open): ${(<Error>err).message}`);
    }
  }

  /**
   * 检查 jti 是否已撤销.
   * 失败 fail-open: Redis 不可用时返回 false (允许请求通过).
   */
  async isRevoked(jti: string): Promise<boolean> {
    try {
      return await this.redis.exists(REDIS_KEYS.jwtBlacklist(jti));
    } catch (err) {
      this.logger.warn(`jwt blacklist read failed: jti=${jti} (fail-open): ${(<Error>err).message}`);
      return false;
    }
  }

  /**
   * 批量撤销 (改密码场景).
   * 用 pipeline 一次写多个 key, 比循环 revoke() 快 10x.
   */
  async revokeMany(entries: { jti: string; expiresAtMs: number }[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    try {
      const client = this.redis.getClient();
      const pipeline = client.pipeline();
      for (const { jti, expiresAtMs } of entries) {
        const ttlSec = Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
        pipeline.set(REDIS_KEYS.jwtBlacklist(jti), '1', 'EX', ttlSec);
      }
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(`jwt blacklist batch write failed (fail-open): ${(<Error>err).message}`);
    }
  }

  /**
   * 调试用: 当前黑名单 size (用 SCAN, 不要 KEYS 阻塞).
   * 注意: SCAN MATCH 不自动加 keyPrefix, 需要手动拼.
   */
  async size(): Promise<number> {
    try {
      const prefix = this.redis.getKeyPrefix();
      const match = `${prefix}:${REDIS_KEYS.jwtBlacklist('*')}`;
      let count = 0;
      const stream = this.redis.getClient().scanStream({ match });
      for await (const keys of stream) {
        count += (keys as string[]).length;
      }
      return count;
    } catch {
      return -1;
    }
  }
}

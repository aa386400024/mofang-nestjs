import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 验证码哈希（AF-537 P1 6.4）。
 *
 * 验证码是短期凭证，Redis 明文存储会被 MONITOR / 备份 / 低权限组件直接读取。
 * 统一存 HMAC-SHA256(pepper, code)，校验时重算 index 并常量时间比较。
 */
export function hashVerificationCode(pepper: string, code: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

/**
 * 把手机号等 PII 标识转成不可逆 Redis key 片段（AF-547）。
 *
 * Redis key 会被 MONITOR / 慢查询日志 / 备份 / 低权限运维组件看到，明文手机号
 * 属于隐私红线。这里用同一 HMAC pepper 生成稳定、不可逆的 32 字节十六进制摘要，
 * 保证同一手机号仍映射到同一 key，同时不暴露原值。
 */
export function hashOpaqueIdentifier(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value.trim()).digest('hex');
}

/**
 * 常量时间比较验证码哈希。
 */
export function verifyHashedCode(pepper: string, code: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashVerificationCode(pepper, code), 'utf8');
  const expected = Buffer.from(storedHash, 'utf8');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

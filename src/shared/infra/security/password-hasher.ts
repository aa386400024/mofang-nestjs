// V2026-11-02 密码哈希: argon2id (@node-rs/argon2).
//   OWASP 推荐参数: m=19MiB, t=2, p=1.
//   老 bcryptjs 已彻底移除 (生产环境仅 1 条老数据, 走忘记密码重置).

import { hash as argon2Hash, verify as argon2Verify, Algorithm } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, ARGON2_OPTIONS);
}

/**
 * 是否存在可用于本地密码登录的密码哈希。
 *
 * `password_hash` 是非 nullable 字段，历史上用两种方式表示“没有本地密码”：
 *   - 验证码注册用户：空字符串 `''`
 *   - OAuth 用户：`!OAUTH_NO_PASSWORD!` 这类 `!` 前缀占位值
 *
 * 两者都不能参与 argon2 校验，也不能被 `!!passwordHash` 当成“已设密码”。
 * 统一从这里判定，避免 verify-code / set-password / login 各自解释。
 */
export function hasUsablePasswordHash(stored: string | null | undefined): boolean {
  // 只认 argon2 PHC 结构（本仓已移除 bcrypt；OAuth 占位与空值都不匹配）。
  return typeof stored === 'string' && /^\$argon2(?:id|i|d)\$/.test(stored);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  // 空值 / 占位值 / 损坏哈希一律 fail-closed：不能登录，也不能把 400/500 暴露成账号状态信号。
  if (!hasUsablePasswordHash(stored)) return false;
  try {
    return await argon2Verify(stored, plain);
  } catch {
    return false;
  }
}

/** OAuth 用户占位哈希 (不能用于登录). */
export async function placeholderHash(): Promise<string> {
  return hashPassword(randomUUID());
}

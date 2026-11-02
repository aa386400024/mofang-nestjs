// V2026-11-02 密码哈希: argon2id (@node-rs/argon2).
//   OWASP 推荐参数: m=19MiB, t=2, p=1.
//   老 bcryptjs 已彻底移除 (生产环境仅 1 条老数据, 走忘记密码重置).

import { hash as argon2Hash, verify as argon2Verify, Algorithm } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2Hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  return argon2Verify(stored, plain);
}

/** OAuth 用户占位哈希 (不能用于登录). */
export async function placeholderHash(): Promise<string> {
  const { randomUUID } = await import('node:crypto');
  return hashPassword(randomUUID());
}

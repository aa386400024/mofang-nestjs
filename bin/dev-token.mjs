#!/usr/bin/env node
/**
 * AF-547 · 本地 access token 铸造器（仅非生产）。
 *
 * 用途：本地调试 / 自动化探针需要走需要 JWT 的 HTTP 端点时，不必先跑
 * 登录 + 邮件验证码流程。脚本只读本机 .env 的 JWT_SECRET，用与
 * UserService.buildAuthResponse() 相同的 payload 结构签发 access token。
 *
 * 安全边界：
 *   - NODE_ENV=production（环境变量或 .env）直接拒绝。
 *   - 不接受公网调用，不新增任何 HTTP 端点。
 *   - 不打印 secret，只打印 token / payload。
 *
 * 用法：
 *   pnpm dev:token -- --uid <uid> [--admin-role admin] [--ttl 900]
 *   pnpm dev:token -- --uid <uid> --json
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JwtService } from '@nestjs/jwt';

function parseEnvFile(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eq = normalized.indexOf('=');
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    let value = normalized.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function argValue(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function usage() {
  console.error(`用法:
  pnpm dev:token -- --uid <uid> [--admin-role editor|reviewer|admin] [--ttl 900] [--json]

可选:
  --username <name>      token.username，默认取 uid
  --tenant-id <id>       token.tenantId，默认取 uid
  --env-file <path>      默认仓库根 .env
  --secret <value>       显式覆盖 JWT_SECRET（仍拒绝生产）
`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

const envFileArg = argValue(args, '--env-file', '.env');
const envFile = parseEnvFile(resolve(process.cwd(), envFileArg));
const nodeEnv = process.env.NODE_ENV ?? envFile.NODE_ENV ?? 'development';

if (nodeEnv === 'production') {
  console.error('[dev:token] 拒绝在 NODE_ENV=production 下签发调试 token。');
  process.exit(1);
}

const uid = argValue(args, '--uid', '');
if (!uid) {
  usage();
  console.error('[dev:token] 缺少 --uid。');
  process.exit(1);
}

const secret = argValue(args, '--secret', '') || process.env.JWT_SECRET || envFile.JWT_SECRET || '';
if (!secret) {
  console.error(`[dev:token] 未找到 JWT_SECRET（${envFileArg} 或环境变量）。`);
  process.exit(1);
}

const adminRole = argValue(args, '--admin-role', '');
if (adminRole && !['editor', 'reviewer', 'admin'].includes(adminRole)) {
  console.error('[dev:token] --admin-role 只支持 editor / reviewer / admin。');
  process.exit(1);
}

const ttl = Number(argValue(args, '--ttl', '900'));
if (!Number.isInteger(ttl) || ttl <= 0 || ttl > 86400) {
  console.error('[dev:token] --ttl 必须是 1..86400 的整数秒。');
  process.exit(1);
}

const tenantId = argValue(args, '--tenant-id', uid);
const username = argValue(args, '--username', uid);
const roles = adminRole ? ['user', adminRole] : ['user'];

const payload = {
  sub: uid,
  username,
  roles,
  jti: randomUUID(),
  type: 'access',
  iss: 'mofang-nestjs',
  aud: 'mofang-client',
  tenantId,
  ...(adminRole ? { adminRole } : {}),
};

const token = new JwtService({}).sign(payload, {
  secret,
  expiresIn: ttl,
  algorithm: 'HS256',
});

if (args.includes('--json')) {
  console.log(JSON.stringify({ token, payload, expiresIn: ttl }, null, 2));
} else {
  console.log(token);
  console.error(`[dev:token] uid=${uid} roles=${roles.join(',')} ttl=${ttl}s（仅本地调试，勿用于生产）`);
}

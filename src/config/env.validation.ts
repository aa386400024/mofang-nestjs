/**
 * 启动期环境变量强校验（AF-537 P0-2 / P1-6.13）。
 *
 * 原则：
 *   - 生产环境必需密钥缺失 / 使用仓库公开占位 / 长度不足 → 进程拒绝启动。
 *   - 开发环境同样拒绝仓库公开默认值，避免“本地能跑、上线照抄”。
 *   - 只校验安全强相关变量，不复制业务默认值（业务口径在 config/envs/*）。
 */
const INSECURE_SECRETS = new Set([
  'xin-su-dev-secret-change-in-production-please-use-32-bytes-random',
  'xin-su-dev-refresh-secret-change-in-production-32-bytes-random',
  'change-me-with-openssl-rand-hex-32',
  'change-me-refresh-with-openssl-rand-hex-32',
  'secret',
  'password',
  'changeme',
]);

function isInsecure(value: string | undefined): boolean {
  return !value || INSECURE_SECRETS.has(value) || value.includes('change-in-production') || value.startsWith('change-me');
}

/**
 * 校验当前进程环境。抛错即中止启动。
 *
 * @param env 进程环境（测试可注入）
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  const production = env.NODE_ENV === 'production';

  if (isInsecure(env.JWT_SECRET)) {
    errors.push('JWT_SECRET 缺失或仍是仓库公开默认值，请用 `openssl rand -hex 32` 生成');
  } else if (production && env.JWT_SECRET.length < 32) {
    errors.push('生产环境 JWT_SECRET 长度必须 >= 32 字符');
  }

  if (isInsecure(env.JWT_REFRESH_SECRET)) {
    errors.push('JWT_REFRESH_SECRET 缺失或仍是仓库公开默认值，请用 `openssl rand -hex 32` 生成');
  } else if (production && env.JWT_REFRESH_SECRET.length < 32) {
    errors.push('生产环境 JWT_REFRESH_SECRET 长度必须 >= 32 字符');
  }

  if (env.JWT_SECRET && env.JWT_REFRESH_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    errors.push('JWT_SECRET 与 JWT_REFRESH_SECRET 必须不同');
  }

  if (production) {
    if (!env.REDIS_PASSWORD) {
      errors.push('生产环境 REDIS_PASSWORD 必填（禁止无密码 Redis）');
    }
    if (!env.DB_PASSWORD) {
      errors.push('生产环境 DB_PASSWORD 必填');
    }
    if (env.EMAIL_ENABLED === 'true' && !env.EMAIL_PASS) {
      errors.push('生产环境启用邮件时 EMAIL_PASS 必填');
    }
    if (env.SMS_PROVIDER && env.SMS_PROVIDER !== 'log' && !env.SMS_ACCESS_KEY) {
      errors.push('生产环境启用真实短信 provider 时 SMS_ACCESS_KEY 必填');
    }
  }

  if (errors.length > 0) {
    throw new Error(`环境配置校验失败:\n- ${errors.join('\n- ')}`);
  }
}

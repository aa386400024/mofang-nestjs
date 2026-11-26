/**
 * 邮箱归一化（AF-547）。
 *
 * 注册、登录、找回密码必须使用同一口径，否则 `Foo@x.com` 注册、`foo@x.com`
 * 登录会静默查不到用户。只做 trim + 小写，不做 gmail 点号等供应商规则。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

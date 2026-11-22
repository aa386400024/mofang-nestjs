# ADR-0001: 心塑 + 魔方共账号选 JWT 鉴权，不用 Cookie Session

> **Status**: ✅ Accepted (2026-08-19)
> **Deciders**: 大炮 + AI
> **Related**: [`../architecture/v2-user-module-architecture.md`](../architecture/v2-user-module-architecture.md)

## Context

心塑 (Flutter app, 移动端) 和 魔方 (Electron + Vue3, 桌面端) 共享账号系统。需要选鉴权方案。

候选：
1. **Cookie Session** — 经典方案，passport.js + express-session
2. **JWT** — 主流 API 标准，access + refresh token
3. **Hybrid** — JWT + 黑名单 (Redis)

## Decision

**选 JWT (Hybrid 模式)**：
- access token 短期 (15 分钟) + JWT 签名
- refresh token 长期 (7 天) + rotation
- Redis blacklist 用于撤销
- 防泄漏、可跨域、移动友好

## Reasons

### 业务场景

| 端 | 适合 Cookie | 适合 JWT |
|---|---|---|
| 心塑 (Flutter) | ❌ WebView 才能用 cookie，体验差 | ✅ 原生 SDK 友好 |
| 魔方 (Electron) | ⚠️ 浏览器内核，但本质 API 调用 | ✅ 跨域零摩擦 |
| 第三方 OAuth (微信/Google/Apple) | ⚠️ cookie 回调复杂 | ✅ id_token 验签标准 |

### 技术优势

1. **跨域天然支持** — Authorization header 不受 cookie CORS 限制
2. **无状态** — 服务器无需 session store (省 Redis 一笔开销做 session)
3. **标准化** — RFC 7519，工具链成熟（[jwt.io](https://jwt.io)）
4. **审计追溯** — JWT 可携带 jti / iat / exp 字段，审计日志直接用
5. **多端管理** — DB sessions 表天然带 sid，UI 可列设备/主动下线

### 妥协

1. **access token 不能实时撤销** → 用短 TTL (15min) + blacklist (Redis) 缓解
2. **refresh token 泄露** → rotation 机制（每次刷新发新，旧入 blacklist）
3. **客户端 token 存储** → mobile 用 secure storage，web 用 httpOnly cookie 套 token（V3）

## 行业参考

| 公司 | 鉴权方案 |
|---|---|
| Auth0 | JWT + refresh rotation |
| Firebase Auth | JWT (Firebase ID Token) |
| AWS Cognito | JWT (Access + ID Token) |
| Stripe API | Bearer Token (类似 JWT) |
| GitHub API | Personal Access Token (类 JWT) |
| 微信小程序 | 自定义 session_key + JWT |

## Consequences

### 正面
- 移动 / 桌面端用户体验好
- 跨域 OAuth 集成顺畅
- 服务端 stateless，水平扩展零摩擦
- 多端 session 管理天然支持

### 负面
- access token 撤销需要额外机制 (Redis blacklist)
- refresh token 泄露需要 rotation 防御
- 客户端需要安全存储 token (V3 加 secure storage 工具)
- 比 cookie session 略复杂

## Alternatives Considered

### Cookie Session

**优点**：
- 实时撤销（删 session 即可）
- 浏览器自动管理，CSR 用户友好

**缺点**：
- 移动端体验差
- 跨域配置复杂
- 服务端 stateful，session store 是必需
- 与 OAuth 集成需要额外 cookie 桥接

**为什么没选**：场景不匹配（Flutter app + 跨域 OAuth）。

### Passport.js + Local + JWT Strategy

**优点**：
- 跟 catsmiaow 项目示例一致
- 多种 strategy 可插拔

**缺点**：
- 增加了一层抽象（passport-jwt），调试复杂
- 我们的需求不需要那么复杂的 strategy 链
- 跟 NestJS DI 整合有学习成本

**为什么没选**：增加复杂度但收益不大，V2 直接用 JwtService 更清晰。

## Implementation Notes

- access token: 15 分钟 (生产可调)
- refresh token: 7 天 (生产可调)
- rotation: 每次 refresh 发新，旧入 blacklist
- blacklist 存 Redis (key: `jwt:blacklist:{jti}`, TTL = token expiresAt)
- fail-open 容错：Redis 不可用时 isRevoked() 返回 false (允许通过，业务损失 = 1 个窗口期)
- 多端 session 管理：DB `user_sessions` 表存 refresh token 的 jti + device info

## References

- [RFC 7519 — JSON Web Token](https://tools.ietf.org/html/rfc7519)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [Auth0 JWT Best Practices](https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-token-best-practices)
- [NIST 800-63B — Digital Identity Guidelines](https://pages.nist.gov/800-63-3/spsp.html/)
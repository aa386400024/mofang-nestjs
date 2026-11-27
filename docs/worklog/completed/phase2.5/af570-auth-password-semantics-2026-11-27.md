# AF-570 · 认证链路密码状态语义与验证码限流加固 — 交付记录

- **任务单**：`docs/worklog/records/phase2.5-audit-remediation/AF-570/task-sheet.md`
- **分支**：`task/AF-570-auth-password-semantics`
- **基线**：`4f421229482c8cfbe09840aaaf2a011dc1e5284c`
- **日期**：2026-11-27
- **性质**：认证链路修复，R2，full gate

## 一、问题与结论

AF-537 已把 `/auth/check-email` 的 `hasPassword` 固定为 false，但相邻链路还有四个不一致：

1. `/auth/send-code` 没有端点级严格限流，只有全局 60 req/min/IP 与同邮箱 60 秒冷却；同组的 `check-email`、`login-password`、`verify-code` 等都是 5 req/min/IP。
2. `/auth/verify-code` 用 `!!user.passwordHash` 判断“已设密码”。OAuth 用户占位值 `!OAUTH_NO_PASSWORD!` 非空，会被误判为 true。
3. `/auth/set-password` 与 `UserService.setInitialPassword` 同样用真值判断，OAuth 占位账号会被拒绝首次设密码。
4. `/auth/login-password` 对无密码账号走真实密码校验失败分支，会累计 `failedLoginCount`，5 次锁 30 分钟；OAuth 占位值还可能让 argon2 校验抛异常。

本任务按企业级口径处理：**对外不新增可枚举业务码，对内统一“可用密码”语义并避免无密码账号被锁死。**

## 二、改动文件

| 文件 | 改动 |
| --- | --- |
| `src/shared/infra/security/password-hasher.ts` | 新增 `hasUsablePasswordHash()`；只认 argon2 PHC 结构，空值、`!` 占位、损坏哈希均为 false；`verifyPassword()` 对不可用哈希 fail-closed 返回 false，不再抛异常 |
| `src/base/controllers/auth.controller.ts` | `send-code` 增加 `@AuthStrictRateLimit()`（5 req/min/IP）；`verify-code.hasPassword` 改用统一判定；`set-password` 改用统一判定 |
| `src/user/providers/user.service.ts` | `login()` 在密码校验前识别无可用密码账号，仍返回统一 `InvalidCredentials`，但不计数、不锁定、不写库；`setInitialPassword()` 改用统一判定 |
| `test/user/af570-auth-password-semantics.spec.ts` | 新增 22 例回归：哈希语义、限流元数据、verify-code 响应、首次设密码、无密码登录不锁定、真实错密码行为不变 |

## 三、关键设计决策

### 1. `send-code` 双层限流，而不是只靠邮箱冷却

- 端点级 `@AuthStrictRateLimit()` = 5 req/min/IP，挡批量邮件轰炸和脚本化枚举。
- `LoginCodeService` 内部同邮箱 60 秒冷却保留，挡单地址高频重发。
- 两层职责不同：IP 级挡来源批量，邮箱级挡单目标轰炸；不能互相替代。
- 验证码 Redis TTL 仍为 300 秒（`.env` `SMS_CODE_TTL_MIN=5`），未改。

### 2. “可用密码”只认 argon2 PHC 结构

`password_hash` 是非 nullable 字段，历史上有两类“没有本地密码”的表示：

- 验证码注册用户：`''`
- OAuth 用户：`!OAUTH_NO_PASSWORD!`

统一判定为：

```ts
/^\$argon2(?:id|i|d)\$/.test(stored)
```

这样空值、`!` 前缀占位、`not-a-hash` 等损坏值都不会被 `!!` 误判。`verifyPassword()` 同时 fail-closed，避免损坏哈希导致 500。

### 3. 不在未认证 `login-password` 暴露“该邮箱未设密码”

这是本任务最重要的产品/安全取舍：

- 若对“邮箱存在但无密码”单独返回业务码或文案，攻击者无需证明邮箱所有权即可枚举账号状态，等于把 AF-537 刚关闭的 oracle 重新打开。
- 因此对外仍统一 `BizCode.InvalidCredentials`（11_002 / HTTP 401），不新增业务码。
- 前端密码页对所有 401 使用同一句中性引导：密码错误，或账号尚未设置密码，可改用验证码登录；验证码通过后 `/auth/verify-code` 的 `hasPassword=false` 才是已证明邮箱归属后的精确信号。

### 4. 无密码账号不计失败、不锁定

`login()` 在真实密码校验前先判断 `hasUsablePasswordHash()`：

- 无可用密码：统一 401，审计 `reason=password_not_set`，不增加 `failedLoginCount`，不写 `lockedUntil`。
- 真实密码错：保持原失败计数、渐进延迟与 5 次/30 分钟锁定策略不变。
- 延迟按“一次失败”口径补齐，减少与真实错密码的时序差。

## 四、闸门结果

| 闸门 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0，0 error |
| `pnpm lint` | exit 0，0 error |
| `pnpm exec vitest run test/user/af570-auth-password-semantics.spec.ts test/user/set-password-first-set.spec.ts` | 2 files / **42 tests passed** |
| `pnpm test` | **362 passed / 1 skipped** files；**5143 passed / 4 skipped** tests |
| `git diff --stat HEAD -- src/engine-core` | 空 |

## 五、偏差与边界

1. **未新增 BizCode**：这是刻意的产品/安全决策，不是实现遗漏。若未来产品坚持要精细引导，只能在邮箱验证码验证成功之后或已认证会话内暴露，不能在 `login-password` 直接暴露。
2. **未改数据库 schema、未补数据迁移**：OAuth 历史占位值仍在库里，但统一判定已兼容；新建 OAuth 用户仍写 `!OAUTH_NO_PASSWORD!`，语义由 helper 统一解释。
3. **未改 `check-email`**：`userExists` 与 `hasPassword:false` 保持原契约。严格说 `userExists` 仍是弱存在性信号，但不在本任务范围。
4. **未改前端**：前端需要把密码页 401 文案统一为中性引导，并保留“验证码登录”入口；后端不提供可枚举的“未设密码”码。
5. **`send-code` 5 req/min/IP 的共享 NAT 风险**：这是与 `check-email` 同档的企业标准；若线上出现校园网/企业 NAT 误伤，应调 IP 档而不是取消端点限流，并保留邮箱 60 秒冷却。

## 六、commit message

```text
fix(auth): 统一可用密码语义并加固验证码发送限流
```

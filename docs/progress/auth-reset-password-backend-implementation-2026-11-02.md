# 后端交付记录：POST /auth/reset-password（忘记密码重置）

> 日期：2026-11-02 ｜ 任务单：`docs/progress/auth-reset-password-backend-2026-11-02.md`
> 模块：`src/base/`（auth controller + dto）+ `src/user/providers/user.service.ts`
> 状态：**代码已交付并复跑绿（未 commit）**
> 红线：`src/engine-core/**` 一行不动 —— 实测 `git diff --stat HEAD -- src/engine-core` 为空

---

## 1. 一句话

新增 `POST /auth/reset-password`：**不需要 JWT**，凭邮箱收到的 6 位验证码直接改密码，
改完把该用户**所有**旧登录态作废，返回 204（不发新 token，用户自己重新登录）。
前端不用再"验证码登录拿 JWT → 跳 SetPasswordPage → 再输一遍新密码"。

---

## 2. 改动面（3 个源文件 + 1 个测试文件）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/base/dto/reset-password.dto.ts`（新） | `ResetPasswordDto`：`email` / `code`（6 位）/ `newPassword`（强密码） |
| 2 | `src/base/controllers/auth.controller.ts` | 新增 `POST /auth/reset-password`（`EncryptedFieldsInterceptor` + `AuthStrictRateLimit` + `@HttpCode(204)`） |
| 3 | `src/user/providers/user.service.ts` | 新增 `resetPasswordByEmail(email, newPassword, ctx)` —— 改密 + 撤销所有 session + 审计 + 指标 |
| 4 | `test/base/auth-reset-password.spec.ts`（新） | 16 例：HTTP 层 + DTO 层 + Service 层 |

**没动**：`/auth/verify-code`、`/auth/set-password`、`/user/change-password`、
`/user/forgot-password` + `/user/reset-password`（邮件 token 流程）、`src/engine-core/**`。

---

## 3. 流程（与仓库既有的邮件 token 重置流程同款，只是凭证形态不同）

```
POST /auth/reset-password { email, code, newPasswordEnc }
  → EncryptedFieldsInterceptor: newPasswordEnc → newPassword (RSA 解密, 删掉 Enc 字段)
  → ValidationPipe: DTO 校验 (邮箱格式 / 6 位码 / 强密码)
  → ① LoginCodeService.verify(email, code)      ← Redis, TTL 5min, 一次性使用
       └─ false → 抛统一错误 (400)
  → ② UserService.resetPasswordByEmail(email, newPassword, ctx)
       ├─ 查用户 (按邮箱); 查不到 → 返 null
       ├─ 密码复用检查 + 旧密码入历史
       ├─ 更新 passwordHash + passwordChangedAt + mustChangePassword=false
       ├─ 撤销所有 session + blacklist
       └─ 审计 (user_password_reset_completed) + 指标
       └─ null → 抛**同一个**统一错误 (400)
  → 204
```

**跟仓库既有密码链路的分工**（四条，各管各的）：

| 链路 | 凭证 | 要 JWT | 能给"已设过密码"的用户用 |
|---|---|---|---|
| `POST /user/change-password` | 旧密码 | ✅ | ✅ |
| `POST /auth/set-password` | 邮箱 + (登录中引导) | ✅ | ❌（已有密码会报错） |
| `POST /user/reset-password` | 邮件 token | ❌ | ✅ |
| **`POST /auth/reset-password`（本单）** | **邮箱 6 位码** | **❌** | **✅** |

---

## 4. 与任务单的偏差（4 条，都有理由）

### 4.1 DTO 字段是 `newPassword`（不是 `newPasswordEnc`）—— 必须如此

任务单 §3.1 的 DTO 样例声明的是 `newPasswordEnc`。**照抄会 100% 失败**：
`EncryptedFieldsInterceptor` 解密后会把 `newPasswordEnc` **删掉**、把明文写进 `newPassword`
（解密发生在 DTO 校验**之前**），所以校验时 `newPasswordEnc` 已经是 `undefined` → `@IsString()` 必挂 → 永远 400。

所以 DTO 声明**明文字段** `newPassword`，客户端照旧发 `newPasswordEnc`（拦截器的
`FIELD_MAP` 里本来就有 `newPasswordEnc → newPassword`）—— 与 `/auth/login-password`、
`/auth/set-password` 完全同款。**客户端请求体不用改。**

### 4.2 编排放在 controller，领域逻辑在 V2 `UserService`（不是 `src/auth/auth.service.ts`）

任务单 §3.3 说在 `src/auth/auth.service.ts` 加 `resetPassword`。但那个 `AuthService` 是 **V1.0 遗留**的，
它注入的是 `shared/user` 的 **mock** `UserService`（`user.password` 是明文比对），没有审计、没有 session 管理。
把 V2 的改密逻辑塞进去 = 在同一个文件里同时出现两个同名 `UserService`，且 mock 那套根本不满足需求。

所以改成：
- **编排**（验码 → 改密 → 统一错误）在 **controller**：它本来就同时注入了 `LoginCodeService` 与
  V2 `UserService`，而且已有的 `/auth/verify-code`、`/auth/set-password` 也是这么编排的（本地风格一致）；
- **领域逻辑**（改密 / 撤销 session / 审计 / 复用检查）在 **V2 `UserService`**，那里才有 repo / session / blacklist / audit。

### 4.3 UserService 加**一个**方法（不是任务单 §3.4 的两个）

任务单 §3.4 要 `updatePasswordByEmail` + `revokeAllSessionsByEmail` 两个方法。合成一个
`resetPasswordByEmail`，理由是**安全原子性**：拆开的话，"密码已改但撤销 session 失败"会留下
**旧 token 还能继续用**的窗口 —— 那恰恰是忘记密码重置最要防的状态（拿到旧 token 的人还在）。
另外合成一个也少查一次邮箱。

### 4.4 错误码：两种失败**同一个码同一句文案**（防枚举）

任务单 §2 的表列了两个码（验证码错 `InvalidCode` / 邮箱不存在 `InvalidCredentials`），
但 §4 又要求"不区分邮箱不存在和验证码错误"—— **两者自相矛盾**（码不同就能区分）。
而且本仓没有 `InvalidCode` / `InvalidPassword` 这两个码（`BizCode` 里是 `VerificationCodeInvalid` /
`WeakPassword`），且 `InvalidCredentials` 在本仓映射的是 **401**，不是任务单写的 400。

所以按**防枚举优先**落地：两种情况抛**完全相同**的
`BizException(BizCode.VerificationCodeInvalid, '邮箱或验证码不正确')` → **400**（与任务单要的状态码一致），
业务码与文案也一致 → 攻击者无法据此判断"这个邮箱是否注册过"。
（单测里直接断言了两个响应的 body **逐字相同**。）

---

## 5. 验收 7 条 —— 逐条对照

| # | 验收条 | 结果 | 用例 |
|---|---|---|---|
| ① | 正确验证码 + 新密码 → 204，密码已更新，passwordChangedAt 刷新 | ✅ | HTTP 层「204, service 收到 email 与明文密码」+ Service 层「新密码能验过, passwordChangedAt 刷新, mustChangePassword=false」 |
| ② | 验证码错误 → 400，密码不变 | ✅ | HTTP 层「验证码错误 → 400, 且**不碰**改密」（service 调用数 = 0） |
| ③ | 邮箱不存在 → 400，不泄露"邮箱不存在" | ✅ | HTTP 层「与"验证码错误"的响应**逐字相同**」+ Service 层「返 null, **不抛错**」 |
| ④ | 新密码太弱 → 400，isStrongPassword 拦截 | ✅ | HTTP 层「新密码太弱 → 400, 不碰 service」+ DTO 层「弱密码 → 校验失败」 |
| ⑤ | 重置成功后旧 session → 401（所有 session 已撤销） | ✅ | Service 层「撤销该用户**所有** session + blacklist」：`revokeAllByUserId` 调 1 次 + `blacklist.revokeMany` 调 1 次 |
| ⑥ | 重置后用新密码登录 → 成功 | ✅ | Service 层断言 `verifyPassword(NEW_PASSWORD, 新 hash) === true` —— 这正是 `UserService.login` 校验密码的那一步（登录因此可用） |
| ⑦ | `git diff --stat HEAD -- src/engine-core/` 为空 | ✅ | 闸门实测（§6） |

**另加 4 条边界**：
- **不需要 JWT**：路由上**没有**挂任何鉴权守卫（单测断言 `GUARDS_METADATA` 为 undefined），不带 token 也能调通；
- **不发新 token**：响应体为空、无 `Set-Cookie`（单测断言）；
- **密码走 RSA**：发 `newPasswordEnc` → 解密成 `newPassword`（单测断言 service 收到明文）；
- **密码复用检查 + 旧密码入历史**（跟邮件 token 流程同款，最近 5 次不许复用）。

---

## 6. 闸门实测（2026-11-02）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| 规范 | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **exit 0 · 0 error / 0 warning** |
| 新增套件 | `npx vitest run test/base/auth-reset-password.spec.ts` | **16 例全通过** |
| 全量 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **66 文件 / 1033 例全通过**（本单之前：65 文件 / 1017 例） |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

> 首轮 eslint 报了 10 个 prettier error + 5 个 import/order warning —— 全部落在本单新增/改动文件里
> （`auth.controller.ts` / `user.service.ts` / `auth-reset-password.spec.ts`），`--fix` 修完复跑为 exit 0。
> `--fix` 只重排了 import 顺序与换行，**没有改任何逻辑**。

---

## 7. 已知边界（诚实记录）

1. **加了限流**（`@AuthStrictRateLimit()` = 5 req/min/IP）。
   任务单没要求，但这个装饰器自己的文档就写着"登录 / 注册 / **重置密码** / 短信发送"用它，
   而同族的 `/user/forgot-password`、`/user/reset-password` 也都挂着 —— 跟着仓库既有约定走，不是自行发明。
2. **验证码本身没有失败次数限制**（`LoginCodeService.verify` 不计数）。
   这是**既有**状况（`/auth/verify-code` 也一样），本单没动。新接口的限流把**单 IP** 的尝试压到 5 次/分钟，
   但对"分散 IP 暴力猜 6 位码"没有根治 —— 彻底解法是给验证码加失败计数 / 锁定，属独立单。
3. **密码复用检查会让"用旧密码重置"失败**（报"密码与最近使用过的密码重复"）。
   跟邮件 token 流程同款行为：用户"忘了密码"却恰好填了旧密码，本来就等于没忘。
   注意此时验证码已被消费，需要重新发一次码。
4. **`/auth/reset-password` 与 `/user/reset-password` 是两条流程**（6 位码 vs 邮件 token），
   前端按页面入口选：忘记密码页用前者，"点邮件链接"用后者。两者不互相影响。
5. **重置后不发新 token**（按任务单要求）：前端拿到 204 后要引导用户回登录页重新登录。

---

## 8. 联调口径（前端）

请求体与任务单一致：`{ email, code, newPasswordEnc }`（密码 RSA 加密，字段名 `newPasswordEnc`）。
响应 **204 空体**。

**回写**：任务单 `docs/progress/auth-reset-password-backend-2026-11-02.md`
（头部状态 + 末尾「交付回写」）。**不自动 commit。**

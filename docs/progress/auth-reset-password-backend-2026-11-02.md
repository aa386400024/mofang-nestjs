# 后端任务单：新增 POST /auth/reset-password（忘记密码重置）

- **日期**：2026-11-02
- **状态**：✅ 代码已交付并复跑绿（**未 commit**）→ 交付记录：[`docs/progress/auth-reset-password-backend-implementation-2026-11-02.md`](./auth-reset-password-backend-implementation-2026-11-02.md)
- **模块**：`src/base/controllers/auth.controller.ts` + `src/auth/login-code.service.ts` + `src/user/providers/user.service.ts`
- **改动范围红线**：❌ 不许动 `src/engine-core/`；❌ 不许改现有 `/auth/verify-code`、`/auth/set-password`、`/user/change-password` 任何行为
- **前置依赖**：无

---

## 1. 背景

忘记密码场景需要一个**不需要 JWT、凭邮箱验证码直接重置密码**的接口。现有接口都不适用：

| 现有接口 | 问题 |
|---|---|
| `POST /auth/verify-code` | 只登录，不改密码 |
| `POST /auth/set-password` | 要 JWT，且是首次设置（已有密码会报错） |
| `POST /user/change-password` | 要 JWT + 旧密码 |

## 2. 接口规格

### `POST /auth/reset-password`

**不需要 JWT**（用户忘记密码了，登不进来）。

**Request body**:
```json
{
  "email": "41391477@qq.com",
  "code": "123456",
  "newPasswordEnc": "RSA加密后的新密码"
}
```

**Response**: `204 No Content`

**业务流程**:
1. 调 `LoginCodeService.verify(email, code)` 校验验证码
2. 验证码错 → 400 / `InvalidCode`
3. 验证码对 → 调 `UserService` 更新该用户的 passwordHash + passwordChangedAt
4. 改完后**撤销该用户所有现有 session**（安全起见，忘记密码重置后旧登录态全部失效）
5. 记审计日志 `password.reset`

**错误码**:
| 场景 | HTTP | 错误码 |
|---|---|---|
| 验证码错误 | 400 | `InvalidCode` |
| 邮箱不存在 | 400 | `InvalidCredentials`（不区分"邮箱不存在"和"验证码错"，防枚举） |
| 新密码太弱 | 400 | `InvalidPassword` |

## 3. 具体改动

### 3.1 新增 DTO：`src/base/dto/reset-password.dto.ts`

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';
import { isStrongPassword } from '../../common/validators/is-strong-password.validator.js';

export class ResetPasswordDto {
  @ApiProperty({ description: '注册邮箱' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: '邮箱收到的 6 位验证码' })
  @IsString()
  @Length(6, 6)
  code!: string;

  @ApiProperty({ description: '新密码 (RSA 加密传输)' })
  @IsString()
  @isStrongPassword()
  newPasswordEnc!: string;
}
```

### 3.2 Controller 加路由：`src/base/controllers/auth.controller.ts`

在 `set-password` 路由旁边加：

```ts
@Post('reset-password')
@HttpCode(204)
@ApiOperation({ summary: '忘记密码重置 (不需要 JWT, 凭邮箱验证码直接改密码)' })
async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
  await this.authService.resetPassword(dto.email, dto.code, dto.newPasswordEnc);
}
```

### 3.3 Service 层：`src/auth/auth.service.ts`

新增 `resetPassword` 方法：
1. 调 `loginCodeService.verify(email, code)` 校验
2. 通过后调 `userService.updatePasswordByEmail(email, newPasswordEnc)`
3. 调 `userService.revokeAllSessionsByEmail(email)` 撤销所有 session
4. 记审计 `password.reset`

### 3.4 UserService 加两个方法

- `updatePasswordByEmail(email, encryptedPassword)`：按邮箱找用户，更新 passwordHash + passwordChangedAt
- `revokeAllSessionsByEmail(email)`：清除该用户所有 refresh token / session

## 4. 不许做的事

- ❌ 不许改 `/auth/verify-code` 的行为
- ❌ 不许改 `/auth/set-password` 的行为
- ❌ 不许改 `/user/change-password` 的行为
- ❌ 不许动 `src/engine-core/`
- ❌ 不要在 reset-password 里发新的 session/token（重置后让用户自己重新登录）
- ❌ 不要区分"邮箱不存在"和"验证码错误"的错误提示（防枚举攻击）

## 5. 验收表（7 条）

| # | 场景 | 请求 | 预期 |
|---|---|---|---|
| 1 | 正确验证码 + 新密码 | `{email, code, newPasswordEnc}` | 204，密码已更新，passwordChangedAt 刷新 |
| 2 | 验证码错误 | `{email, code: "000000", newPasswordEnc}` | 400，密码不变 |
| 3 | 邮箱不存在 | `{email: "nobody@qq.com", code, newPasswordEnc}` | 400，不泄露"邮箱不存在" |
| 4 | 新密码太弱 | `{email, code, newPasswordEnc: "123"}` | 400，isStrongPassword 拦截 |
| 5 | 重置成功后旧 session | 用旧 JWT 调 /user/me | 401（所有 session 已撤销） |
| 6 | 重置后用新密码登录 | POST /auth/login-password | 成功，正常登录 |
| 7 | `git diff --stat HEAD -- src/engine-core/` | — | **必须为空** |

## 6. commit 文案

```
feat(auth): 新增 POST /auth/reset-password 忘记密码重置接口（凭验证码改密，不需要 JWT）
```

---

## 7. 交付回写（2026-11-02）

> 状态：**代码已交付并复跑绿，未 commit**。
> 交付记录：[`docs/progress/auth-reset-password-backend-implementation-2026-11-02.md`](./auth-reset-password-backend-implementation-2026-11-02.md)

### 7.1 改动面（3 个源文件 + 1 个测试文件）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/base/dto/reset-password.dto.ts`（新） | `ResetPasswordDto`：`email` / `code`（6 位）/ `newPassword`（强密码） |
| 2 | `src/base/controllers/auth.controller.ts` | 新增 `POST /auth/reset-password`（`EncryptedFieldsInterceptor` + `AuthStrictRateLimit` + `@HttpCode(204)`） |
| 3 | `src/user/providers/user.service.ts` | 新增 `resetPasswordByEmail(email, newPassword, ctx)` —— 改密 + 撤销所有 session + 审计 + 指标 |
| 4 | `test/base/auth-reset-password.spec.ts`（新） | 16 例：HTTP 层 + DTO 层 + Service 层 |

**没动**：`/auth/verify-code`、`/auth/set-password`、`/user/change-password`、
`/user/forgot-password` + `/user/reset-password`（邮件 token 流程）、`src/engine-core/**`。

### 7.2 与任务单的偏差（4 条，都有理由）

1. **DTO 字段是 `newPassword`（不是 `newPasswordEnc`）—— 必须如此**。
   `EncryptedFieldsInterceptor` 解密后会把 `newPasswordEnc` **删掉**、把明文写进 `newPassword`
   （解密发生在 DTO 校验**之前**），照抄任务单 §3.1 的样例 → 校验时 `newPasswordEnc` 已是 `undefined`
   → `@IsString()` 必挂 → **永远 400**。
   所以 DTO 声明明文字段 `newPassword`，**客户端请求体不变**（照旧发 `newPasswordEnc`），
   拦截器 `FIELD_MAP` 里本来就有 `newPasswordEnc → newPassword` —— 与 `/auth/login-password`、`/auth/set-password` 完全同款。

2. **编排放 controller，领域逻辑放 V2 `UserService`**（不是 §3.3 指定的 `src/auth/auth.service.ts`）。
   那个 `AuthService` 是 **V1.0 遗留**，注入的是 `shared/user` 的 **mock** `UserService`（明文比对、无审计、无 session），
   塞 V2 改密逻辑 = 同文件两个同名 `UserService`，且 mock 那套根本不满足需求。
   现方案：编排（验码 → 改密 → 统一错误）在 controller（它本就连 `LoginCodeService` + V2 `UserService`，
   同文件的 `/auth/verify-code`、`/auth/set-password` 也是这么编排的）；领域逻辑在 V2 `UserService`（那里才有 repo / session / blacklist / audit）。

3. **UserService 加一个方法**（不是 §3.4 的两个 `updatePasswordByEmail` + `revokeAllSessionsByEmail`）。
   合成 `resetPasswordByEmail` 是为了**安全原子性**：拆开的话，"密码已改但撤销 session 失败"会留下
   **旧 token 还能继续用**的窗口 —— 那恰恰是忘记密码重置最要防的状态；顺带少查一次邮箱。

4. **错误码：两种失败同一个码同一句文案**（防枚举优先）。
   任务单 §2 的表列了两个码（验证码错 `InvalidCode` / 邮箱不存在 `InvalidCredentials`），但 §4 又要求
   "不区分邮箱不存在和验证码错误"—— **两者自相矛盾**（码不同就能区分）。
   且本仓没有 `InvalidCode` / `InvalidPassword` 这两个码（`BizCode` 里是 `VerificationCodeInvalid` / `WeakPassword`），
   `InvalidCredentials` 在本仓映射的是 **401** 而非任务单写的 400。
   所以按**防枚举优先**落地：两种情况抛**完全相同**的
   `BizException(BizCode.VerificationCodeInvalid, '邮箱或验证码不正确')` → **400**（与任务单要的状态码一致）。
   单测里直接断言了两个响应的 body **逐字相同**。

**另加一条（非偏差，是补仓库约定）**：挂了 `@AuthStrictRateLimit()`（5 req/min/IP）。
任务单没要求，但该装饰器自身文档就写着"登录 / 注册 / **重置密码** / 短信发送"用它，同族
`/user/forgot-password`、`/user/reset-password` 也都挂着 —— 跟仓库既有约定走，不是自行发明。

### 7.3 验收 7 条 —— 逐条对照

| # | 验收条 | 结果 | 用例 |
|---|---|---|---|
| ① | 正确验证码 + 新密码 → 204，密码已更新，passwordChangedAt 刷新 | ✅ | HTTP 层「204, service 收到 email 与明文密码」+ Service 层「新密码能验过, passwordChangedAt 刷新, mustChangePassword=false」 |
| ② | 验证码错误 → 400，密码不变 | ✅ | HTTP 层「验证码错误 → 400, 且**不碰**改密」（service 调用数 = 0） |
| ③ | 邮箱不存在 → 400，不泄露"邮箱不存在" | ✅ | HTTP 层「与"验证码错误"的响应**逐字相同**」+ Service 层「返 null, **不抛错**」 |
| ④ | 新密码太弱 → 400，isStrongPassword 拦截 | ✅ | HTTP 层「新密码太弱 → 400, 不碰 service」+ DTO 层「弱密码 → 校验失败」 |
| ⑤ | 重置成功后旧 session → 401（所有 session 已撤销） | ✅ | Service 层「撤销该用户**所有** session + blacklist」：`revokeAllByUserId` 调 1 次 + `blacklist.revokeMany` 调 1 次 |
| ⑥ | 重置后用新密码登录 → 成功 | ✅ | Service 层断言 `verifyPassword(NEW_PASSWORD, 新 hash) === true` —— 这正是 `UserService.login` 校验密码的那一步（登录因此可用） |
| ⑦ | `git diff --stat HEAD -- src/engine-core/` 为空 | ✅ | 闸门实测（§7.4） |

**另加 4 条边界**：不需要 JWT（路由上无任何鉴权守卫，单测断言 `GUARDS_METADATA` 为 undefined）；
不发新 token（响应体空、无 `Set-Cookie`）；密码走 RSA（发 `newPasswordEnc` → 解密成 `newPassword`）；
密码复用检查 + 旧密码入历史（跟邮件 token 流程同款，最近 5 次不许复用）。

### 7.4 闸门实测（2026-11-02）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| 规范 | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **exit 0 · 0 error / 0 warning** |
| 新增套件 | `npx vitest run test/base/auth-reset-password.spec.ts` | **16 例全通过** |
| 全量 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **66 文件 / 1033 例全通过**（本单之前：65 文件 / 1017 例） |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

> 首轮 eslint 报了 10 个 prettier error + 5 个 import/order warning（全部在本单新增/改动文件里），
> `--fix` 修完复跑为 exit 0。

### 7.5 已知边界（诚实记录）

1. **验证码本身没有失败次数限制**（`LoginCodeService.verify` 不计数）—— 这是**既有**状况（`/auth/verify-code` 也一样），本单没动。
   新接口的限流把**单 IP** 的尝试压到 5 次/分钟，但对"分散 IP 暴力猜 6 位码"没有根治 ——
   彻底解法是给验证码加失败计数 / 锁定，属**独立单**。
2. **密码复用检查会让"用旧密码重置"失败**（报"密码与最近使用过的密码重复"）—— 跟邮件 token 流程同款行为。
   注意此时验证码已被消费，需要重新发一次码。
3. **`/auth/reset-password` 与 `/user/reset-password` 是两条流程**（6 位码 vs 邮件 token）——
   前端按页面入口选：忘记密码页用前者，"点邮件链接"用后者。两者不互相影响。
4. **重置后不发新 token**（按任务单要求）：前端拿到 204 后要引导用户回登录页重新登录。

### 7.6 联调口径（前端）

请求体与任务单一致：`{ email, code, newPasswordEnc }`（密码 RSA 加密，字段名 `newPasswordEnc`），响应 **204 空体**。


# 后端任务单：新增 POST /user/set-password（已登录态首次设置密码）

- **日期**：2026-11-02
- **模块**：`src/user/`（user controller / service / dto）
- **改动范围红线**：❌ 不许动 `src/engine-core/`；❌ 不许动现有 `POST /user/change-password` 任何行为；✅ 只新增路由 + DTO + service 调用
- **前置依赖**：无
>
> **状态：✅ 代码已交付并复跑绿（未 commit）**
> 交付记录：[`change-password-first-set-backend-implementation-2026-11-02.md`](./change-password-first-set-backend-implementation-2026-11-02.md)

---

## 1. 背景

前端"我的 → 账号与安全 → 修改密码"入口对所有已登录用户显示（大厂标准：入口始终在，文案根据状态动态切换）：

| `GET /user/me.passwordChangedAt` | 前端模式 | 调用接口 |
|---|---|---|
| `null`（从没设过密码） | "设置密码" | **`POST /user/set-password`**（新接口） |
| 非 null（设过密码） | "修改密码" | `POST /user/change-password`（现有，不动） |

**为什么要两个独立接口，不做 if/else 分流**：
- 语义干净：set = 首次设置，change = 修改，互不污染
- 审计事件独立：`password.first_set` vs `password.change` 分开记
- 错误码独立：set-password 明确报"已设过密码请走修改流程"，不跟"旧密码错误"混在一起
- 未来扩展：set 要加 re-auth 验证、change 要加密码过期策略，各自演进不耦合
- 这是微信/飞书/Google Account 的标准做法

---

## 2. 具体改动

### 2.1 新增 DTO：`src/user/dto/set-password.dto.ts`

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import { isStrongPassword } from '../../common/validators/is-strong-password.validator.js';

/**
 * 已登录态首次设置密码 DTO — POST /user/set-password.
 *
 * 跟 POST /auth/set-password 的区别:
 *   - /auth/set-password: 登录中引导流程 (验证码登录后强制设密码), 鉴权方式不同
 *   - /user/set-password: 已登录态, 用户主动在"我的-账号与安全"设置密码
 *
 * 两个接口复用同一个 UserService.setInitialPassword().
 */
export class SetLoggedInPasswordDto {
  @ApiProperty({ description: '新密码 (强密码, 8+ 位 + 大小写 + 数字)' })
  @IsString()
  @isStrongPassword()
  newPassword!: string;
}
```

### 2.2 新增 Controller 路由：`src/user/controllers/user.controller.ts`

在 `change-password` 路由旁边加：

```ts
@Post('set-password')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@HttpCode(204)
@ApiOperation({ summary: '已登录态首次设置密码 (JWT 鉴权, 不要旧密码)' })
public async setLoggedInPassword(
  @CurrentUser('sub') uid: string,
  @Body() dto: SetLoggedInPasswordDto,
): Promise<void> {
  await this.user.setInitialPassword(uid, dto.newPassword);
}
```

### 2.3 Service 层：`src/user/providers/user.service.ts`

现有 `setInitialPassword(uid, password)` **已经有反查逻辑**：

```ts
if (user.passwordHash) {
  throw new BizException(BizCode.InvalidParameter, '用户已有密码, 请用改密流程');
}
```

**这个方法本身不需要改**，直接被新 controller 路由复用即可。

唯一要确认的：`setInitialPassword` 成功后**不要撤销 session**（跟现在行为一致——用户是刚登录进来主动设密码的，撤销会把自己踢下线）。

### 2.4 审计日志（如果项目有 AuditLogService）

在 `setInitialPassword` 成功后加一条 `password.first_set` 审计事件（对照 `changePassword` 里现有的审计写法加，不要新发明格式）。

---

## 3. 不许做的事

- ❌ **不许改** `POST /user/change-password` 的任何行为（DTO、service、错误码全部保持现状）
- ❌ **不许改** `POST /auth/set-password` 登录中引导流程
- ❌ **不许动** `src/engine-core/`
- ❌ **不要**让 set-password 撤销 session
- ❌ **不要**在 change-password 里加 `if (!passwordHash)` 分支（那是凑活方案，已否决）
- ❌ **不要**复用 ChangePasswordDto（语义不同，错误码不同）

---

## 4. 验收表（8 条）

| # | 场景 | 请求 | 预期 |
|---|---|---|---|
| 1 | 从没设过密码 + 调 set-password | JWT + `{newPassword: 'NewPass123'}` | 204，密码写入，`passwordChangedAt` 非 null，`mustChangePassword=false` |
| 2 | 从没设过密码 + 调 change-password | JWT + `{oldPassword: '随便', newPassword: 'NewPass123'}` | 现有行为不变（报旧密码错） |
| 3 | 已设过密码 + 调 set-password | JWT + `{newPassword: 'Another456'}` | 400 / `InvalidParameter`，"用户已有密码, 请用改密流程" |
| 4 | 已设过密码 + 调 change-password | JWT + `{oldPassword: '正确', newPassword: 'Another456'}` | 现有行为不变，204，其他 session 被撤销 |
| 5 | set-password 新密码弱 | JWT + `{newPassword: '123'}` | 400，`isStrongPassword` 校验失败 |
| 6 | set-password 成功后当前 JWT | 调 `/user/me` | 200，**不被撤销**（当前设备仍在线） |
| 7 | 未登录调 set-password | 无 JWT | 401 |
| 8 | `git diff --stat HEAD -- src/engine-core/` | — | **必须为空** |

---

## 5. 联调口径（前端）

后端上线后，前端联调路径：
1. 注册新号（验证码登录，`passwordChangedAt=null`）
2. 进"我的 → 账号与安全 → 设置密码"，只有新密码+确认两个框
3. 提交 → 调 `POST /user/set-password` → 204 → SnackBar 成功
4. 退出登录，重新用邮箱+密码登录，能登进去
5. 登录后再进"修改密码"，标题变成"修改密码"，有旧密码框
6. 旧密码错 → 调 `POST /user/change-password` → 401 → 字段下红字"旧密码不正确"

---

## 6. 交付回写（2026-11-02）

> 完整记录见 [`change-password-first-set-backend-implementation-2026-11-02.md`](./change-password-first-set-backend-implementation-2026-11-02.md)。

### 6.1 §4 验收 8 条 —— 逐条对照

| # | 验收条 | 结果 | 用例 |
|---|---|---|---|
| ① | 从没设过密码 + set-password → 204，密码写入，passwordChangedAt 非空，mustChangePassword=false | ✅ | HTTP 层「204 + service 收到正确 uid 与明文密码」+ Service 层「写入 hash / passwordChangedAt / mustChangePassword=false」 |
| ② | 从没设过密码 + change-password → 现有行为不变（报旧密码错） | ✅ | Service 层「旧密码错 → InvalidCredentials"旧密码错误"」（`changePassword` 本体 0 行改动） |
| ③ | 已设过密码 + set-password → 400 / InvalidParameter，"用户已有密码, 请用改密流程" | ✅ | HTTP 层「已设过密码 → 400」+ Service 层「BizException(InvalidParameter, …)」 |
| ④ | 已设过密码 + change-password → 现有行为不变，204，其他 session 被撤销 | ✅ | Service 层「旧密码对 → 改密成功 + 撤销所有 session + 审计 user_password_changed」 |
| ⑤ | set-password 新密码弱 → 400，isStrongPassword 校验失败 | ✅ | HTTP 层「新密码弱 → 400」+ DTO 层「弱密码"123" → 校验失败」 |
| ⑥ | set-password 成功后当前 JWT 不被撤销 | ✅ | Service 层「不撤销 session」：`revokeAllByUserId` / `revokeMany` 一次都没被调 |
| ⑦ | 未登录调 set-password → 401 | ✅ | HTTP 层「未登录 (无 token) → 401」 |
| ⑧ | `git diff --stat HEAD -- src/engine-core/` 为空 | ✅ | 闸门实测 |

> ⑥ 的"调 `/user/me` → 200"那一半**验不了**：`/user/me` 自己撞在下面 §6.3 的既有缺陷上
> （uid 取到 undefined），跟本接口无关。实质（不撤销 session）在 Service 层钉死。

### 6.2 改动面

- **新增** `src/user/dto/set-password.dto.ts`（`SetLoggedInPasswordDto`）
- **新增** `POST /user/set-password`（`src/user/controllers/user.controller.ts`）
- **新增** `UserService.setLoggedInPassword()`（`src/user/providers/user.service.ts`）
- **新增** `AuditEvent.UserPasswordFirstSet = 'user_password_first_set'`
- **新增** `test/user/set-password-first-set.spec.ts`（20 例）
- **没动** `change-password` / `/auth/set-password` / `setInitialPassword` 本体 / `src/engine-core/**`

### 6.3 与本单的偏差（3 条，都有理由）

1. **service 层多了一个薄封装 `setLoggedInPassword`**（而不是 §2.2 样例那样 controller 直接调
   `setInitialPassword`）：§2.4 要求记审计，而审计按仓库惯例在 service 层（全仓没有 controller
   直接写审计）；`setInitialPassword` 是 `/auth/set-password` 共用的底层方法，在它里面加审计 =
   顺手改了那条链路（§3 明令不许动）。所以薄封装 = 委托 `setInitialPassword` + 记自己的审计，
   `setInitialPassword` 本体 **0 行改动**。
2. **取 uid 用 `@CurrentUser('userId')`，不是样例里的 `('sub')`** —— **必须如此**：
   `JwtAuthGuard` 注入 `request.user` 的形状是 `{ userId, username, roles }`
   （`userId` = JWT payload 的 `sub`，见 `src/user/guards/jwt-auth.guard.ts:93`），
   `@CurrentUser('sub')` 在这个 guard 下**取不到值**。
   ⚠️ 顺带发现**既有缺陷**（非本单引入，本单也没动）：`user.controller.ts` 里另有 4 个路由用
   `@CurrentUser('sub')` / `('jti')`（`GET /user/me`、`POST /user/change-password`、
   `POST /user/logout-all`、`DELETE /user/sessions/:sid`），uid/jti 取到 **undefined**；
   起因是 `1253f82`（V2026-08-27）把 guard 注入形状改成 `{userId,…}` 而 controller 没跟着改
   （`oauth.controller.ts` / `knowledge-base` / `consent` 同理）。
   修它要动共享 guard → 会**改变 `change-password` 的现有行为**（本单红线），**建议独立单处理**。
3. **审计事件字符串用 `user_password_first_set`**（不是 §2.4 字面的 `password.first_set`）——
   同一句要求"不要新发明格式"，仓库既有格式是 `user_password_changed`（`user_*` 前缀）。
   `event` 列是 `varchar(64)`，新增枚举值**不需要迁移**。

### 6.4 闸门实测

| 闸门 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error / 0 warning** |
| `npx vitest run test/user/set-password-first-set.spec.ts` | **20 例全通过** |
| 全量 `npx vitest run --exclude '**/e2e/**/*.ts'` | **65 文件 / 1017 例全通过**（之前 64 文件 / 997 例） |
| `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

### 6.5 其他已知边界

- **没加限流**（§2 样例里也没有，任务单没要求 —— 不自行发挥）；设密码是敏感操作，建议后续单补。
- **没做 re-auth**（§1 明说是未来扩展）。
- **前端要对齐的只有请求体字段名**：密码走 RSA，客户端发 `newPasswordEnc`（不是明文 `newPassword`），
  服务端 `EncryptedFieldsInterceptor` 自动解密 —— 与 `/auth/set-password`、`/auth/login-password` 同款。

### 6.6 commit

**未自动 commit。** 建议文案：

```
feat(user): 已登录态首次设置密码接口 POST /user/set-password——与改密分成两条链路
```

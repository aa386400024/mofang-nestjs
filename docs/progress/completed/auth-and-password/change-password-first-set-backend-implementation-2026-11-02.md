# 后端交付记录：POST /user/set-password（已登录态首次设置密码）

> 日期：2026-11-02 ｜ 任务单：`docs/progress/change-password-first-set-backend-2026-11-02.md`
> 模块：`src/user/`（controller / service / dto）
> 状态：**代码已交付并复跑绿（未 commit）**
> 红线：`src/engine-core/**` 一行不动 —— 实测 `git diff --stat HEAD -- src/engine-core` 为空

---

## 1. 一句话

新增 `POST /user/set-password`（JWT 鉴权，body 只收 `newPassword`，204 返回）：
**从没设过密码**的已登录用户走它，**设过密码**的走原来的 `POST /user/change-password`。
两条链路语义分开、审计分开、错误码分开，互不污染。

---

## 2. 改动面（4 个源文件 + 1 个测试文件）

| # | 文件 | 改了什么 |
|---|---|---|
| 1 | `src/user/dto/set-password.dto.ts`（新） | `SetLoggedInPasswordDto` —— 只有 `newPassword` 一个字段，`@IsString()` + `@isStrongPassword()` |
| 2 | `src/user/controllers/user.controller.ts` | 新增 `POST /user/set-password` 路由（`JwtAuthGuard` + `EncryptedFieldsInterceptor` + `@HttpCode(204)`） |
| 3 | `src/user/providers/user.service.ts` | 新增 `setLoggedInPassword(uid, password, ctx?)` —— **委托**现有 `setInitialPassword` + 记审计 |
| 4 | `src/user/entities/audit-log.entity.ts` | `AuditEvent` 加 `UserPasswordFirstSet = 'user_password_first_set'` |
| 5 | `test/user/set-password-first-set.spec.ts`（新） | 20 例：HTTP 层 + Service 层 + DTO/元数据层 |

**没动**：`POST /user/change-password`（DTO / service / 错误码 / 撤销 session 全部原样）、
`POST /auth/set-password`（登录中引导流程原样）、`src/engine-core/**`、
`setInitialPassword` 本体（**0 行改动**）。

---

## 3. 任务单 §2 逐条对照

| 任务单 | 落地 |
|---|---|
| §2.1 新增 DTO `SetLoggedInPasswordDto` | `src/user/dto/set-password.dto.ts`，字段与装饰器与任务单样例逐字一致 |
| §2.2 新增路由 `POST /user/set-password` | `user.controller.ts`，`@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` + `@HttpCode(204)` |
| §2.3 复用 `setInitialPassword`（不改它） | `setLoggedInPassword` 内部 `await this.setInitialPassword(uid, password)`；反查逻辑（`if (user.passwordHash) throw '用户已有密码, 请用改密流程'`）**一行未动** |
| §2.4 审计 `password.first_set` | service 层记 `AuditEvent.UserPasswordFirstSet`（格式照 `changePassword` 里的写法） |

---

## 4. 与任务单的偏差（2 条，都有理由）

### 4.1 服务层多了一个薄封装 `setLoggedInPassword`（而不是 controller 直接调 `setInitialPassword`）

任务单 §2.2 的样例是 controller 直接 `await this.user.setInitialPassword(uid, dto.newPassword)`，
§2.4 又要求记一条 `password.first_set` 审计。两者对不上：**审计按仓库惯例写在 service 层**
（全仓没有一个 controller 直接写审计日志），而 `setInitialPassword` 是 `/auth/set-password`
（登录中引导流程）**共用**的底层方法 —— 在它里面加审计 = 顺手改了那条链路（任务单 §3 明令不许动），
用户也明确说了"service 一行都不用改"。

所以做法是加一个**薄封装**：`setLoggedInPassword` = 委托 `setInitialPassword` + 记自己的审计事件。
`setInitialPassword` 本体 0 行改动，`/auth/set-password` 行为 0 变化。

### 4.2 取 uid 用 `@CurrentUser('userId')`，不是任务单样例里的 `('sub')`

**这是必须的，不是风格问题。** `JwtAuthGuard` 注入 `request.user` 的形状是
`{ userId, username, roles }`（`userId` = JWT payload 的 `sub`，见
`src/user/guards/jwt-auth.guard.ts:93`），所以取 uid 的字段名是 **`userId`**。
`@CurrentUser('sub')` 在这个 guard 下**取不到值**（`sub` 是 JWT payload 的字段名，不是 `request.user` 的）。

> ⚠️ **顺带发现的既有缺陷（不是本单引入，本单也没动）**：
> `src/user/controllers/user.controller.ts` 里另有 4 个路由用 `@CurrentUser('sub')` / `('jti')`：
> `GET /user/me`、`POST /user/change-password`、`POST /user/logout-all`、`DELETE /user/sessions/:sid`
> —— 它们取到的 uid / jti 是 **undefined**。
> 起因是 2026-08-27 的 `1253f82` 把 guard 的注入形状从"原始 payload"改成 `{userId, username, roles}`，
> controller 侧没跟着改（`src/user/oauth/oauth.controller.ts`、`src/knowledge-base/**`、`src/consent/**`
> 也用 `'sub'`，同理）。
> 修它要动共享 guard → 会**改变 `change-password` 的现有行为**（本单红线），所以**留到独立单**。
> 本单只用正确的字段名（`'userId'`），不碰任何既有路由。
> 详见本记录 §7 的"实测证据"。

### 4.3 审计事件字符串用 `user_password_first_set`（不是 `password.first_set`）

任务单 §2.4 写的是 `password.first_set`，但同一句要求"对照 `changePassword` 里现有的审计写法，
不要新发明格式"。仓库既有格式是 `AuditEvent.UserPasswordChanged = 'user_password_changed'`（`user_*` 前缀），
所以新事件取 `UserPasswordFirstSet = 'user_password_first_set'`。语义对得上，格式跟仓库一致。
（`event` 列是 `varchar(64)`，新增枚举值**不需要迁移**。）

---

## 5. 验收 8 条 —— 逐条对照

| # | 验收条 | 结果 | 用例 |
|---|---|---|---|
| ① | 从没设过密码 + set-password → 204，密码写入，passwordChangedAt 非空，mustChangePassword=false | ✅ | HTTP 层「合法密码 → 204, 且 service 收到正确的 uid 与明文密码」+ Service 层「写入 hash, passwordChangedAt 非空, mustChangePassword=false」 |
| ② | 从没设过密码 + change-password → 现有行为不变（报旧密码错） | ✅ | Service 层「旧密码错 → InvalidCredentials "旧密码错误"」（`changePassword` 本体 0 行改动） |
| ③ | 已设过密码 + set-password → 400 / InvalidParameter，"用户已有密码, 请用改密流程" | ✅ | HTTP 层「已设过密码 → 400」+ Service 层「BizException(InvalidParameter, ...)」 |
| ④ | 已设过密码 + change-password → 现有行为不变，204，其他 session 被撤销 | ✅ | Service 层「旧密码对 → 改密成功 + 撤销所有 session + 审计 user_password_changed」 |
| ⑤ | set-password 新密码弱 → 400，isStrongPassword 校验失败 | ✅ | HTTP 层「新密码弱 → 400」+ DTO 层「弱密码 "123" → 校验失败」 |
| ⑥ | set-password 成功后当前 JWT 不被撤销（当前设备仍在线） | ✅ | Service 层「不撤销 session」：`sessionService.revokeAllByUserId` 与 `blacklist.revokeMany` **一次都没被调** |
| ⑦ | 未登录调 set-password → 401 | ✅ | HTTP 层「未登录 (无 token) → 401」 |
| ⑧ | `git diff --stat HEAD -- src/engine-core/` 为空 | ✅ | 闸门实测（§6） |

**关于 ⑥ 的说明**：`setInitialPassword` 本来就不碰 session（只 save user），本单也没加任何撤销逻辑，
所以"当前设备不被踢下线"是结构性保证，不是靠 if 分支。任务单里"调 `/user/me` → 200"那一半
**验不了**——因为 `/user/me` 自己就撞在 §4.2 说的既有缺陷上（uid 取到 undefined），
跟本接口无关。实质（不撤销 session）在 Service 层钉死了。

**另加 3 条边界**：
- 两条链路语义分开：DTO 只有 `newPassword`（**没有** `oldPassword`），两个路由路径各自独立；
- 审计独立：首次设置记 `user_password_first_set`，改密仍记 `user_password_changed`（互不污染）；
- 密码走 RSA：发 `newPasswordEnc` → `EncryptedFieldsInterceptor` 解密成 `newPassword`（HTTP 层有用例）。

---

## 6. 闸门实测（2026-11-02）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 错** |
| 规范 | `npx eslint "src/**/*.ts" "test/**/*.ts"` | **0 error / 0 warning** |
| 新增套件 | `npx vitest run test/user/set-password-first-set.spec.ts` | **20 例全通过** |
| 全量 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **65 文件 / 1017 例全通过**（本单之前：64 文件 / 997 例） |
| 红线 | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

---

## 7. 实测证据：`@CurrentUser('sub')` 取不到值（既有缺陷，非本单引入）

测试里用**真** `JwtAuthGuard` + **真** `CurrentUser` 装饰器跑了一遍：

```
守卫注入 request.user = { userId: 'uid-1', username: '', roles: [] }
CurrentUser('userId') → 'uid-1'   ✅
CurrentUser('sub')     → undefined ❌   ← 'sub' 是 JWT payload 的字段名, 不是 request.user 的
```

守卫注入形状见 `src/user/guards/jwt-auth.guard.ts:93`；
变化发生在 `1253f82`（V2026-08-27 "JwtAuthGuard userId 字段统一"），controller 侧没跟着改。

**影响面**（本单**未修**，建议独立单处理）：
`src/user/controllers/user.controller.ts` 的 `GET /user/me`、`POST /user/change-password`、
`POST /user/logout-all`、`DELETE /user/sessions/:sid`；
`src/user/oauth/oauth.controller.ts` 的 2 个路由；`src/knowledge-base/**`、`src/consent/**`。

**为什么不在本单顺手修**：修 guard（多注入 `sub` / `jti`）会**改变 `change-password` 的现有行为**
（从"uid undefined 报错"变成"能用"）—— 那是任务单 §3 的红线，且影响面横跨 30+ 路由、
标准闸门（e2e 被排除）覆盖不到。本单只保证**自己这个新接口**是对的。

---

## 8. 其他已知边界

1. **没有限流**。`/user/login`、`/user/register` 有 `AuthStrictRateLimit`，本接口没有 ——
   任务单没要求，也没在样例里写，所以没加（自行发挥 = 越界）。
   设密码是敏感操作，建议后续单补一个限流（改动 1 行装饰器）。
2. **没有 re-auth**。任务单 §1 提到"未来 set 要加 re-auth 验证"—— 本期不做（明确说了是未来扩展）。
3. **`passwordChangedAt` 由 service 写**（`setInitialPassword` 里已有），前端拿
   `GET /user/me.passwordChangedAt` 判模式的口径不变 ✅。
4. **审计是 fire-and-forget 语义**（`AuditLogService.log` 内部入队，失败只打日志）—— 跟既有审计一致。

---

## 9. 联调口径（前端）

任务单 §5 的路径直接可用，唯一要跟前端对齐的是**请求体字段名**：
密码字段走 RSA 加密，客户端发 `newPasswordEnc`（不是明文 `newPassword`），
服务端 `EncryptedFieldsInterceptor` 自动解密成 `newPassword` —— 与
`/auth/set-password`、`/auth/login-password` 同款。

**回写**：任务单 `docs/progress/change-password-first-set-backend-2026-11-02.md`
（头部状态 + 末尾「交付回写」）。**不自动 commit。**

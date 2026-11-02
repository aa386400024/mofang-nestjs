# 后端任务单：新增 POST /user/set-password（已登录态首次设置密码）

- **日期**：2026-11-02
- **模块**：`src/user/`（user controller / service / dto）
- **改动范围红线**：❌ 不许动 `src/engine-core/`；❌ 不许动现有 `POST /user/change-password` 任何行为；✅ 只新增路由 + DTO + service 调用
- **前置依赖**：无

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

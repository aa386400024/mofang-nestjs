# AF-588 WP29 删除账户纵切测试与 API 契约收口 — 交付记录

- 日期：2026-11-28
- 基线：`d11a37b2cdd88404d0eaec38ac209183e0ac3973`
- 分支：`task/AF-588-delete-account-contract`
- 任务单：`docs/worklog/records/phase2.5-quality-gates/AF-588/task-sheet.md`

## 1. 问题

删除账户是 WP29 的 P0 合规路径，原有 `test/profile/export.spec.ts` 只覆盖导出，`deleteAccount` 完全没有单测。同时 DTO / Controller / Service 的契约文案仍停留在早期占位实现：

- `ExportController` 的导出 summary 写“异步任务，V2 占位返回 task id”，实际 AF-586 已同步生成真实文件。
- 删除 summary 写“V2 占位仅审计”，实际会软删账号、撤销会话 / JWT、解绑 OAuth、写审计。
- `ExportService` 文件头仍写“导出真实实现前直接 501”。
- `DeleteAccountDto.confirmation` 无任何 class-validator 约束，畸形请求只能落到 service 的业务码分支。

## 2. 改动

- `test/profile/export.spec.ts`
  - 新增删除账户 describe，5 条用例：
    1. 成功路径：状态 `deletion_requested`、`purgeAt = deletedAt + retentionDays`、用户软删字段（state / passwordHash / phone / email / 验证时间）、会话撤销、JWT 拉黑、OAuth 解绑与审计事件。
    2. 二次确认不匹配返回 `InvalidParameter`，且用户查询 / 保存、会话、JWT、OAuth 均未被调用。
    3. 用户不存在或已软删返回 404，不写任何数据。
    4. 自定义 `retentionDays=7` 时 `purgeAt` 精确为 7 天。
    5. `DeleteAccountDto` 拒绝缺失或非字符串 `confirmation`，合法请求零错误。
- `src/profile/dto/export.dto.ts`
  - `confirmation` 加 `@IsString()` / `@IsNotEmpty()`；`reason` 加 `@IsOptional()` / `@IsString()`；删除过期的“V2 占位直接 hard delete”注释。
- `src/profile/controllers/export.controller.ts`
  - 导出与删除 summary 改为真实语义（同步生成、24h 有效期；软删 + 会话/JWT/OAuth 撤销 + 冷静期后硬擦除）。
- `src/profile/providers/export.service.ts`
  - 文件头移除“导出真实实现前直接 501”，改为指向 AF-586 的真实导出；V3 计划改为“对话/记忆/练习/语音纳入后切异步与加密 ZIP”。

## 3. 设计决策

- **只补测试与契约文案，不改删除语义**：冷静期、retentionDays、软删字段与撤销顺序全部保持原实现。测试用于锁定现状，防止后续改动静默破坏 P0 路径。
- **DTO 校验只做类型与空值**：`confirmation` 的字面值仍由 service 精确比较 `确认删除`，DTO 不复制业务常量，避免两处真相。
- **不新增取消删除接口**：冷静期内恢复属于产品/法务口径，不在本单顺手扩范围。

## 4. 闸门

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/profile/export.spec.ts` | 13 passed / 0 failed |
| `pnpm typecheck` | 0 error |
| `pnpm lint` | 0 error |
| `pnpm test` | 见下方全量结果 |
| `git diff --stat HEAD -- src/engine-core` | 空 |

全量：`365 passed + 1 skipped`，`5184 passed / 0 failed / 4 skipped`，耗时 `736.05s`。

## 5. 偏差与遗留

- 无任务单偏差。
- 遗留 AF-588-B1：删除账户仍直接写 `user.state`，与 `UserState` 注释“业务代码必须走 UserService.transition”不一致；是否统一走状态机需单独任务评估，避免本单扩范围。
- 遗留 AF-588-B2：冷静期内取消删除 / 恢复账号尚无接口，需产品与法务确认是否提供。

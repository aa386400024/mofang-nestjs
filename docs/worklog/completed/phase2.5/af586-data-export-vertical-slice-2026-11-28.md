# AF-586 WP29 用户数据导出纵切 · 交付记录

- 任务：AF-586（`phase2.5-quality-gates`）
- 基线：`1f42ce825dff2669d9738291a22bfa6080cec847`
- 交付日期：2026-11-28

## 1. 目标与结论

WP29 的用户导出权此前只有 501 占位：`ExportService.exportData` / `getExportTask` 直接抛 `NotImplementedException`。本单把 profile 域的十个数据域接成一条真实可用的导出链路——POST 申请、GET 查状态、GET 下载文件，任务与文件进 Redis 24h TTL；JSON 与 ZIP 两种格式都可下载。

结论：用户导出现在能真实拿到自己的账号、资料、通知、会员、认证、陪伴、自护、burnout、同意与隐私授权数据；对话原文、记忆、练习记录、语音转写仍明确列在 `scope.pendingDomains`，没有伪装成“全量导出”。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/profile/providers/user-data-export.collector.ts` | 新增采集器：用 `DataSource` 统一取 11 张表，账号侧只保留白名单字段；导出载荷带 `schemaVersion` / `scope` |
| `src/profile/providers/export-archive.ts` | 新增归档器：JSON 直接序列化；ZIP 用 store 方法自建单成员归档，含 CRC-32 与 DOS 时间头，零第三方依赖 |
| `src/profile/providers/export.service.ts` | 501 → 真实导出：60s 限流、任务/数据双 key 写 Redis（24h）、所有者校验、审计事件、下载字节流 |
| `src/profile/controllers/export.controller.ts` | 新增 `GET /profile/me/export/:taskId/download`，按任务 contentType 下发并加 `Content-Disposition` / `no-store` |
| `src/profile/dto/export.dto.ts` | `format` 改为可选并加 `IsIn(['json','zip'])`，缺省 json；下载地址标注相对路径 |
| `src/profile/profile.module.ts` | 注册 `UserDataExportCollector` |
| `src/user/enums/audit-event.enum.ts` | 新增 `UserDataExportRequested = 'user_data_export_requested'` |
| `test/profile/export.spec.ts` | 8 条：完成态、限流、越权、JSON/ZIP 下载、CRC 向量、ZIP 中央目录、文件名 |
| `test/profile/user-data-export.collector.spec.ts` | 4 条：账号字段白名单、按 uid / 双方关系查询、缺用户空结构、十域全覆盖 |

## 3. 关键设计决策

1. **先同步、不假装 BullMQ**：当前纵切只覆盖 profile 域，数据量可控；同步生成能立刻返回 completed + 可下载文件，比“入队后永远 pending”的假异步更诚实。对话/记忆纳入后再切异步。
2. **采集与编排分离**：`UserDataExportCollector` 只读、无 Redis、无审计；`ExportService` 只管限流、存储、所有者校验与审计。两者可独立测试。
3. **账号字段白名单**：导出文件只给 uid / 手机 / 邮箱 / 状态 / 关键时间；`password_hash`、`failed_login_count`、`tenant_id`、`admin_role` 不进包，防“导出即泄密”。
4. **ZIP 自建而非加依赖**：单成员归档用 store 方法已足够，避免为一次导出引入压缩库与供应链审计面；CRC-32 与中央目录有单测。
5. **过期与越权统一 404**：不区分“不存在 / 已过期 / 别人的任务”，避免任务 id 成为探测面。
6. **审计只记元数据**：`taskId` / `format` / `sizeBytes`，不写任何心理内容或导出正文。

## 4. 验证

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/profile test/app/af555-module-wiring.spec.ts` | 17 passed / 0 failed，57.02s |
| 类型检查 | `pnpm typecheck` | exit 0，0 error |
| Lint | `pnpm lint` | exit 0，0 error / 0 warning |
| 全量单测 | `pnpm test` | 见 §4.1 |
| 内核边界 | `git diff --stat HEAD -- src/engine-core` | 输出为空 |

### 4.1 全量结果

`pnpm test`：364 files passed + 1 skipped；5175 passed / 0 failed / 4 skipped，745.56s。

## 5. 偏差与遗留

- **WP29 未整体完成**：本单只交付 profile 域纵切。对话原文、记忆、练习记录、语音转写需要单独脱敏与留存策略，仍留在 `pendingDomains`。
- **未做加密 ZIP / presigned URL**：当前用 Redis 24h TTL + 鉴权下载；加密与对象存储签名链接留给后续批次。
- **未改 Flutter 前端**：导出入口与下载交互需前端任务接入。
- **留存年限仍未拍板**：删除账户仍沿用 `softDelete.retentionDays`，法务口径未变。

## 6. 提交

`feat(af586): WP29 用户数据导出纵切`

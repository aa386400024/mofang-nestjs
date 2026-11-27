# AF-585 角色管理暴露不流利配置字段 · 交付记录

- 任务：AF-585（`phase2.5-quality-gates`）
- 基线：`c9888d8b7423a23f7d8f8aeb7a8b9cdd332f33fc`
- 依赖：AF-584（角色级不流利配置管道）
- 交付日期：2026-11-28

## 1. 目标与结论

AF-584 已把 `disfluency_level` / `disfluency_density` 从 DB 实体经 resolver、装配层透传到渲染侧，但管理端仍无法读写这两列，只能靠 seed / 手工 SQL 维护。本单把两列接进角色管理的正式 DTO 与 CRUD 映射，让运营可在管理接口内完成标定、调整与清空，不新增 migration，不动 admin-dashboard 前端。

结论：管理端入参、出参与落库三处已闭环，`undefined`（未传）保留原值、`null`（显式）清空、合法值覆盖三种语义均有单测覆盖；`src/engine-core` 零 diff。

## 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/shared/realism/visitor-realism-profile.ts` | 抽出 `DISFLUENCY_LEVELS` 常量，`DisfluencyLevel` 由常量派生；`parseDisfluencyLevel` 改为基于常量判断 |
| `src/shared/realism/index.ts` | 导出 `DISFLUENCY_LEVELS`，供 DTO 的 `IsIn` 与 Swagger enum 复用 |
| `src/engine-adapters/wiring/character/character-profile.dto.ts` | 新建 DTO 增加 `disfluencyLevel?: DisfluencyLevel \| null`、`disfluencyDensity?: number \| null`（`IsIn` / `Min(0)` / `Max(1)`）；`CharacterProfileAdminDto` 增加两必填可空出参字段 |
| `src/engine-adapters/wiring/character/character-profile.admin.service.ts` | `create` 缺省写 `null`；`toAdminDto` 回传两列；`applyContentUpdates` 调用新增的 `applyDisfluencyUpdates`，按“未传保留 / null 清空 / 值覆盖”处理 |
| `test/engine-adapters/wp9b-character-admin.spec.ts` | 新增 3 条用例：创建携带、编辑/保留/清空、approved 后 resolver 侧通道携带 |

## 3. 关键设计决策

1. **档位取值单一真相源**：DTO 的 `IsIn` 直接用 `DISFLUENCY_LEVELS`，不再复制一份字符串数组。以后加档位只改常量一处，校验、Swagger、解析器同步生效。
2. **可空语义沿用 AF-462 语域指纹口径**：`null` = 未标定 = 不渲染，避免“空字符串 / undefined / 0”混用导致“角色明明没配却被当成 none”。
3. **update 的 undefined 与 null 严格区分**：`PartialType` 下未传字段是 `undefined`，必须保留原值；只有显式 `null` 才清空。`if (input.x !== undefined)` 是这条语义的唯一实现点。
4. **复杂度治理**：`applyContentUpdates` 加两个分支后触发 lint complexity 21，抽出 `applyDisfluencyUpdates` 而不是调高阈值或加 eslint-disable，保持主函数在 20 以内。
5. **不造第二套枚举**：admin 层只复用 `shared/realism` 的类型与常量，避免管理端与运行时各认一套值。

## 4. 验证

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/engine-adapters/wp9b-character-admin.spec.ts` | 16 passed / 0 failed，17.59s |
| 类型检查 | `pnpm typecheck` | exit 0，0 error |
| Lint | `pnpm lint` | exit 0，0 error / 0 warning |
| 全量单测 | `pnpm test` | 362 files passed + 1 skipped；5163 passed / 0 failed / 4 skipped，739.24s |
| 内核边界 | `git diff --stat HEAD -- src/engine-core` | 输出为空 |

全量测试相较 AF-584 的 5160 例增加 3 例，正好对应本单新增用例；无既有用例回归。

## 5. 偏差与遗留

- 未改 `admin-dashboard` 前端：任务单明确把前端列为非目标。管理接口已可读写，前端表单展示需另立前端任务。
- 未新增 migration：两列由 AF-584 的 `1714900000058` 创建，本单只消费。
- 角色具体档位/密度数值仍未标定，继续由 IM-065 跟踪；本单只提供录入能力，不写入任何业务数值。

## 6. 提交

`feat(af585): 角色管理暴露不流利配置字段`

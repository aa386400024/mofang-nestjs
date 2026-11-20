# AF-158 · 标注台告警码与空态语义修正交付记录

- **taskId**：AF-158
- **日期**：2026-11-20
- **分支**：`task/AF-152-quality-admin`
- **基线**：`77ec305`

## 1. 问题

运行态打开 `#/quality/annotation`：

1. 批次选择器下方直接渲染 `INVALID_BATCHES_HIDDEN:13`，暴露内部协议码。API 契约明确要求提示“另有 n 个批次未通过有效性门禁”，而不是回显码值。
2. 左栏队列已有 189 条待标，但中间区因未选中场次显示“没有待标注场次”，与队列事实矛盾。

## 2. 修复

`admin-dashboard/src/views/AnnotationTool.vue`：

- 新增 `batchWarningText()`：识别 `INVALID_BATCHES_HIDDEN:<n>` 动态码，输出“另有 n 个批次未通过有效性门禁，已隐藏”；其余告警仍走 `WARNING_CN` 映射，未知码原样兜底。
- 中间空态改为按 `list.length` 区分：队列为空才说“没有待标注场次”，否则提示“从左侧选择一场开始标注”。

## 3. 运行态验证

| 场景 | 结果 |
| --- | --- |
| 打开标注台 | 批次下方显示“另有 13 个批次未通过有效性门禁，已隐藏” |
| 队列非空、未选中 | 中间区提示“从左侧选择一场开始标注” |
| 自动选中首条 | 正常进入标注表单，逐字稿缺失告警仍显示 |

## 4. 闸门

| 命令 | exitCode | 结果 |
| --- | --- | --- |
| `pnpm lint` | 0 | 0 error / 0 warning |
| `pnpm typecheck` | 0 | 0 error |
| `pnpm --dir admin-dashboard build` | 0 | 含 `vue-tsc`；vite build 2.43s |

## 5. 边界

- 只改展示文案，不改批次有效性判定、标注接口与数据。
- 逐字稿缺失的场次仍可写标签与档位，轮级定位不可用；这是后端既有契约，不在本单改。

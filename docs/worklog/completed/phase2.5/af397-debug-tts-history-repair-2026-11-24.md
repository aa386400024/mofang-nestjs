# AF-397 · AF-396 交付提交链返修与 CI 快照补齐

- 日期：2026-11-24
- 任务：AF-397（承接 AF-396 / AF-395 / AF-394，返修提交链）
- 分支：`task/AF-397-ci-history-repair`
- 基线：`b58d64cf958ad83dcc775b9633d25382ba4e95ec`

## 一、返修原因

AF-396 的实现、回执冻结与归档均已落地，但 PR #193 的 `Orchestration Gate` 在逐提交校验时失败：

- `2ab6d958`（AF-395 cherry-pick）与 `eb4b52ca`（AF-396 env + lint）所在的提交树里没有 AF-396 的记录包任务单，也没有任务状态快照，CI 判 `no-active-task`。
- 框架允许的两阶段入场要求：实现提交 diff 内新增当前任务的 `records/<context>/<taskId>/task-sheet.md`，且提交索引与父索引都没有该任务，才可用任务单重建 scope 并以 submitted 入场。

原提交链把任务单放到了后续 docs 提交，导致实现提交无法满足入场条件。

## 二、返修方式

- 将 AF-396 已验收的全部非状态面内容（后端 TTS 模块、迁移、前端按钮、env 模板、测试、AF-394/395/396 记录包、回执与 durable 副本）压缩为一个实现提交。
- 该提交同时包含 AF-397 记录包任务单，提交标题显式点 `af397`，满足 CI 受限入场。
- 状态面归档作为独立提交，不混入实现。
- 业务代码内容零改动；本次只重排提交与补齐任务单。

## 三、保留的 AF-396 内容

- 三模型 TTS：MiniMax `speech-2.8-hd` / `speech-2.8-turbo`、豆包 `doubao-seed-tts-2.0` Agent Plan 通道。
- 调试接口 `POST /admin/api/debug/tts/render`，服务端解析文本，不接受前端自由文本。
- 缓存表 `admin_debug_tts_renders` 与迁移 `1714900000051-CreateAdminDebugTtsRenders.ts`。
- 前端 hover 才显示 `HD` / `Turbo` / `豆包` 三按钮，点击才生成，同键命中缓存。
- MiniMax `include_usage` 开关、env 模板五个新键。
- AF-394/395/396 交付记录与冻结回执。

## 四、闸门

- 定向测试：3 文件 / 20 用例全绿。
- 全量 `pnpm test`：312 passed / 1 skipped（313 文件），4757 passed / 4 skipped（4761 用例）。
- `pnpm lint`：exit 0，0 error。
- `pnpm typecheck`：exit 0。
- `admin-dashboard pnpm type-check`：exit 0。
- `git diff --stat HEAD -- src/engine-core`：空。
- 迁移已执行成功（89 → 90）。

## 五、偏差与遗留

- 豆包真实合成仍被账户侧 `AgentPlanDeductNotEnabled` 403 阻塞，待开启 Agent Plan 抵扣后复跑。
- 编排回执误报修复另开 orchestrator 任务。
- `zero_motion` 逐场定位缺口、角色音色映射沿用 AF-396 回执 backlog。

## 六、提交信息

`feat(af397): 重排 AF-396 交付提交链并补齐 CI 逐提交快照`

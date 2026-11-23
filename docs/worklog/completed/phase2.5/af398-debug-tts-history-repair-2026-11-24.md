# AF-398 · 调试 TTS 交付提交链返修

- 日期：2026-11-24
- 任务：AF-398（承接 AF-397 / AF-396 / AF-395 / AF-394）
- 分支：`task/AF-398-ci-history-repair`
- 基线：`b58d64cf958ad83dcc775b9633d25382ba4e95ec`

## 一、返修原因

AF-396 的实现与回执已落地，但原 PR #193 的逐提交 `Orchestration Gate` 判 `no-active-task`：实现提交自身没有记录包任务单，无法触发框架的受限入场；后续补任务单时任务已归档。

## 二、返修动作

- 把 AF-396 已验收的全部非状态面内容压缩为一个实现提交：后端 TTS 模块、迁移、前端按钮、env 模板、测试、AF-394/395/396 记录包、冻结回执与 durable 副本。
- 同一提交包含 AF-398 记录包任务单与回执，提交标题与 `Task` trailer 均为 AF-398，满足 CI 受限入场。
- 状态面归档单独提交，不混入实现。
- 业务代码零改动，仅重排提交与补齐任务快照。

## 三、保留的交付内容

- MiniMax `speech-2.8-hd` / `speech-2.8-turbo` 与豆包 `doubao-seed-tts-2.0` Agent Plan 通道。
- `POST /admin/api/debug/tts/render` 调试接口。
- `admin_debug_tts_renders` 缓存表与迁移。
- 前端 hover 才显示的 `HD` / `Turbo` / `豆包` 按钮与缓存播放。
- MiniMax `include_usage` 开关与 env 模板五个键。

## 四、闸门

- 定向测试 3 文件 / 20 用例全绿。
- 全量 `pnpm test`：312 passed / 1 skipped（313 文件），4757 passed / 4 skipped（4761 用例）。
- `pnpm lint` / `pnpm typecheck` / `admin-dashboard pnpm type-check` 均 exit 0。
- `git diff --stat HEAD -- src/engine-core` 空。
- 迁移已执行成功。

## 五、偏差

- 豆包真实合成仍被 `AgentPlanDeductNotEnabled` 403 阻塞，待开启 Agent Plan 抵扣。
- 编排回执误报另开任务。

# AF-419 取消说明（scope 缺件，重登为 AF-420）

- 日期：2026-11-24
- 任务：AF-419「在场 delta 可调性收口：补齐 holding_present / cold_absent 的 env 覆写键与注释漂移」
- 终态：canceled（取消，未交付实现）
- 继任任务：AF-420（同题，scope 增补 `test/config/wp25-env-example-coverage.spec.ts`）

## 取消原因

实现阶段发现 `.env.example` 新增两个 `ENGINE_DELTA_*` 键后，守卫用例
`test/config/wp25-env-example-coverage.spec.ts` 的 `DELTA_TABLE_ENV_KEYS` 清单必须同步，
否则「模板 ↔ 代码」双向断言必然变红。AF-419 的 `scope.files` 未包含该文件，
而编排规则不允许在 `submitted/working` 阶段 rescope（`task rescope` 仅接受 backlog / ready）。

处置与 AF-416 一致：取消 AF-419，按补齐 scope 后的口径重登 AF-420，实现与证据在 AF-420 落地。

## 证据

- `task cancel` 输出：`status=canceled`，`cancelReason` 记录同上原因。
- `run-once` 的 `archive-terminal` 动作已把 AF-419 归档；归档数 391 → 392。
- 成功标准、门禁与范围隔离在 AF-420 任务单原样承接，无口径漂移。

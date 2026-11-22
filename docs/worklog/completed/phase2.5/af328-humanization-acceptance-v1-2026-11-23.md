# AF-328 · 文字真人度 humanization-v1 判据与离线审计 CLI 交付记录

- 日期：2026-11-23
- 任务类型：implementation
- 状态：已实现、已跑真实语料审计、待回执与归档
- 基线：`02c8a9ea8aad4a36420cec95930157dbcd5bca44`（AF-326 合入后的 `integrate`）

## 改了什么

| 文件 | 变更 |
| --- | --- |
| `src/auto-practice/metrics/humanization-acceptance.ts` | 新增 `humanization-v1` 纯判据模块：版本常量、四条判据、模式门、样本门、逐条结果、指标构建 |
| `bin/visitor-text-humanization-audit.ts` | 新增离线审计 CLI：扫描 debug session、按场次/总体输出六类数字与判据，支持 `--mode` / `--ids` / `--json` / `--out` / `--min-turns` / `--fail-on-violation` |
| `test/auto-practice/metrics/humanization-acceptance.spec.ts` | 新增 19 例单测：版本、判据边界、模式门、低样本、缺数据 fail-closed、指标契约、CLI 参数、场次与总体聚合 |
| `docs/worklog/completed/phase2.5/af328-humanization-audit-2026-11-23.md` | 真实 7 场 / 140 轮审计报告 |

未改 `RENDER_REALISM_MODE` 默认值，未改渲染链路，未改 `BatchMetricsV1`，未新增依赖，未新增 `package.json` 脚本。

## 关键设计决策

1. **模式门前置**：`evaluateHumanization` 先看 `realismMode`，非 `active` 一律 `not_applicable`。历史 off / audit 批次也带 `text.disfluency.*`，不加模式门会把「未开注入」误判成「真人度不合格」。
2. **样本门**：低于 `HUMANIZATION_MIN_TURNS = 5` 不做硬判定，避免 1 轮短场次放大噪声。
3. **只做护栏，不做临床评分**：四条门槛只排除「完全书面化」与「机械堆填充词 / 每轮改口」两个极端，中间地带不裁决。所有数值是工程种子。
4. **隐私最小化**：CLI 只输出 session id 与数字，不输出任何台词原文；报告同样只含数字。
5. **不新增 package.json 脚本**：AF-327 的 scope 含 `package.json` 与 `docs/worklog/` 越出 executor 资源域，经 `task rescope` 重签发为 AF-328 并收窄；CLI 以 `pnpm exec tsx bin/visitor-text-humanization-audit.ts` 调用即可，遵守 pnpm 工具链口径。
6. **不把 audit 基线冒充 active 证据**：审计报告单列「假设性 active 判定」，明确它只证明门槛不会在真实口语文档上假失败，不证明注入链路有效。

## 真实语料结果

- 7 场 / 140 轮；事件/轮 0.528571、轮次率 0.407143、密度/百字 1.321901、修正/轮 0.035714。
- 六类：filler 37 / pause 31 / repetition 1 / repair 5 / trailoff 0 / elongation 0。
- `--mode audit`：四条判据全部 `not_applicable`，只测量。
- `--mode active` 假设性判定：四条判据全部 `pass`，`--fail-on-violation` 退出码 0。
- 审计 JSON：`data/phase25-exit/af328-humanization/audit-7sessions.json`（gitignored，仅本机取证）。

## 闸门证据

| 闸门 | 结果 |
| --- | --- |
| `pnpm exec vitest run test/auto-practice/metrics/humanization-acceptance.spec.ts` | 1 文件 / 19 例通过 |
| `pnpm typecheck` | exit 0；`tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile node_modules/.tmp/tcheck-full.tsbuildinfo` |
| `pnpm lint` | exit 0；0 error / 0 warning（首轮 17 个 prettier + 1 个 prefer-switch 已修复后复跑通过） |
| `pnpm test` | 289 文件通过 / 1 跳过（290）；4456 例通过 / 4 跳过（4460）；18.69s |
| `git diff --stat HEAD -- src/engine-core` | 空 |
| `pnpm exec tsx bin/visitor-text-humanization-audit.ts --mode audit --ids "<7 ids>"` | 7 场 / 140 轮；判据 not_applicable |
| 同一批 `--mode active --fail-on-violation` | 判据 passed；exit 0 |

## 与任务单的偏差

1. **未新增 `package.json` 脚本**：scope 越界，按 rescope 收窄；不影响可复跑，命令写进报告与交付记录。
2. **实际做的是「判据 + 离线审计」而非 active 在线对照**：本机 MySQL / Redis / dev 服务未运行，无法生成 active / off 配对语料；在线对照登记为遗留项，不伪造证据。
3. **判据表为 4 条而非蓝图 P2 的全部条目**：只收口可离线复算、且有真实基线支撑的四条；其余（如 elongation / trailoff 专属判据）当前基线均为 0，硬设门槛会变成永远不通过的假指标。

## 遗留项

- AF328-B1：active / off 同场配对生成与对照，需要 MySQL / Redis / dev 服务可用后另立任务。
- AF328-B2：`BatchMetricsV1` 无 realism mode 字段；若要把判据接入批量验收，需先补批次元数据，否则仍会在 off 批次上误判。
- AF328-B3：四条门槛为工程种子，active 对照批次产出后应重新校准。
- AF328-B4：`trailoff` / `elongation` 在真实 7 场基线均为 0，暂不设独立判据，避免假指标。

## 提交

`feat(af328): 文字真人度 humanization-v1 判据与离线审计`

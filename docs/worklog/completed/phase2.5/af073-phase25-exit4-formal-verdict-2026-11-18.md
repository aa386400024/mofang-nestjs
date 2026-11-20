# AF-073 · Phase2.5 出口条件④正式判定与 WP-K 归档快照四态收口

- 任务单：`docs/worklog/pending/af073-phase25-exit4-task-2026-11-18.md`
- 基线：`cc9aad18d30ffaeaf1370c361fa9593309199d6f`（AF-069 合并 SHA）
- 分支：`task/AF-073-phase25-exit4`
- 结论：**出口条件④未通过；当前质量不达标，核心指标不可判。**
- 约束遵守：未新跑 LLM 批次；未改 `src/` 业务代码、`engine-core`、数据库 schema / migration / seed；闸门只跑定向 `tsc` / `eslint` / 定向 vitest / boundary。

## 1. 正式四态结论

正式比较采用“归档快照对归档快照”，因为当前库内批次 `uJHgP8uQGeM8Z6HbZY7M5` 的逐字稿已随环境迁移清理，从库内重算为 `0/8`、`file_missing=8`，不能作为当前有效快照。

```powershell
node node_modules/tsx/dist/cli.mjs bin/batch-report.ts `
  --snapshot data/batch-reports/uJHgP8uQGeM8Z6HbZY7M5.json `
  --baseline-snapshot data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json `
  --format both --out <TEMP>/af073-formal
```

结果：exit **0**；`uJHgP8uQGeM8Z6HbZY7M5` 的正式结论为 **`incomparable`**，不存在 `improved` / `neutral` / `regressed`。

- 不可比原因（CLI 原文）：`两批验收判据 (acceptance) 不同; 两批 characterSlug 集合不同`
- 加 `--fail-on-incomparable` 后 exit **2**，用于 CI 把“不可比”按不可判定处理。

因此，出口条件④不能写成“达标”；`incomparable` 只证明两批不能按同一口径比较，不是质量通过。

## 2. 数据与判定依据

| 项 | 旧 96 场基线 | 当前 8 场候选 |
|---|---|---|
| 批次 | `g3ONzlqSGMVJqkFMF9Lwh` | `uJHgP8uQGeM8Z6HbZY7M5` |
| 归档快照 | `data/batch-reports/g3ONzlqSGMVJqkFMF9Lwh.json` | `data/batch-reports/uJHgP8uQGeM8Z6HbZY7M5.json` |
| 覆盖 | 96/96 场，1112 轮 | 8/8 场，94 轮 |
| 指纹 | `491558624aeafdb3` | `1caeea117101e8d9` |
| intake | 历史记录 6/8 未全过 | 全局 **FAIL**（`safety Δ=0.0065` < 0.015，`zero_motion=1/idle`） |
| 当前库内重算 | 0 行 | 0/8，`file_missing=8` |

说明：`uJ...json` 在 AF-073 分支初始工作树中不存在，已从主工作区 `D:\work\Project\backend\mofang-nestjs\data\batch-reports\uJHgP8uQGeM8Z6HbZY7M5.json` 原样复制入本分支（33,527 B，8/8 / 94 轮），仅作为归档证据，不重建、不重跑。

关键不可判定因素：

1. 两批 `acceptance` 判据不同，`characterSlug` 集合不同，回归判定器直接判 `incomparable`。
2. 当前 8 场快照 `engine_version=v2026.11.16-6cfb46e-59-ga27aba5-dirty`，比当前 HEAD `g66c186f` 落后 8 个提交，而且逐字稿已清理，无法重算。
3. `data/eval-datasets/` 只有 `synthetic: true` 数据集（`synthetic-supervisor-v1`、`synthetic-train-v1`），没有真实督导结构化 `dataset.json`；80% 准确率没有可正式评测的标注集。

## 3. WP-K CLI 修复

`bin/batch-report.ts`：

- 新增 `--snapshot <file>`（可重复），直接读取并校验归档 `BatchMetricsV1` JSON，不需要数据库；与 `--batch` / `--all` 互斥。
- 新增 `--baseline-snapshot <file>`，以归档快照为比较基准；与 `--baseline` 互斥。
- 新增 `--fail-on-incomparable`，`incomparable` 时退出码 2。
- 请求批次在库内不存在时，明确输出 `数据不可用: 库内无批次 <id>` 并 exit 2；不再 exit 0 生成空 `index.md`。
- 仅归档快照模式不初始化 DataSource；DB 模式才建连接，并在 finally 中销毁。
- 报告渲染改为携带正式回归结论行，`writeReports` 接收 `verdicts` 映射。

验证：

```text
--batch g3ONzlqSGMVJqkFMF9Lwh --format json
→ exit 2；stdout: 数据不可用: 库内无批次 g3ONzlqSGMVJqkFMF9Lwh；未生成空报告
```

定向单测 `test/auto-practice/af073-batch-report-cli.spec.ts`（4 个用例）：

- 归档 96 快照为基线、当前 8 场快照为候选 → exit 0，Markdown 含 `回归结论: incomparable`
- `--fail-on-incomparable` → exit 2
- 快照文件缺失 → exit 2
- `--batch` 与 `--snapshot` 互斥 → exit 3

## 4. 闸门结果

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` | exit 0，0 error |
| 定向 lint | `node node_modules/eslint/bin/eslint.js bin/batch-report.ts test/auto-practice/af073-batch-report-cli.spec.ts` | exit 0，0 error 0 warning（先 `--fix` 修掉 4 个 prettier 格式项） |
| 定向单测 | `node node_modules/vitest/vitest.mjs run test/auto-practice/af073-batch-report-cli.spec.ts` | 4 passed / 0 failed |
| 内核边界 | `node node_modules/vitest/vitest.mjs run test/engine-core/boundary.spec.ts` | 12 passed / 0 failed |
| CLI 缺批 | `--batch g3ONzlqSGMVJqkFMF9Lwh --format json` | exit 2，无空报告 |
| CLI 正式四态 | `--snapshot uJ… --baseline-snapshot g3… --fail-on-incomparable` | exit 2，`incomparable` |

未运行 `bin/dev-up.ps1` 常驻段：该脚本最终会起 `nest watch` 并占用终端，且仓库配置指向远程 MySQL/Redis；本单实际通过 WP-K DB 模式连接成功（`--batch g3` 已进入 DataSource 初始化并输出库内无批次），未另起本地服务。未新跑任何 LLM 批次。

## 5. 文档与遗留项收口

- `docs/worklog/pending/phase2.5-README.md` §3.2 / §3.2.1 已回写为 2026-11-18 正式 CLI 判定：出口④未通过、核心指标不可判；旧的“无正式 CLI 四态 / CLI 缺批 exit 0”表述已替换为本次事实。
- AF-067 / AF-068 relay 回复已归档：
  - `docs/worklog/pending/archive/AF-067-relay-response-20261117-2248.md`
  - `docs/worklog/pending/archive/AF-068-relay-response-20261117-2310.md`
- `docs/security/GHSA-fc5q-39xc-vjpf.md` 增加 2026-11-18 AF-073 复核行：未发现 `>4.0.7` 修复版本，暴露面仍为构建/代码生成/ORM 元数据扫描且不接受终端用户 glob 输入；临时接受维持到 2027-02-18，到期重新审批，不自动续期。
- 出口④若要转为 PASS，仍需：真实督导结构化数据集 + 同口径可评测新批次（本单按约束不新跑 LLM 批次）。

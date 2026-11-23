# Agent Collaboration Framework 契约包（2.1.0）

本目录是框架仓 `aa386400024/agent-collaboration-framework` **v2.1.0**（commit `e412403`）机读契约的不可变发布制品，供本仓 CLI 与 CI 做 schema 硬校验。

## 本次新增（相对 2.0.0）

- `task-sheet` 1.2.0：`riskClass / riskRationale / gateProfile / supersedes / supersededBy`；`baselineRef` 明确为任务分支切出点 / merge-base，不用登记后移动的 HEAD 冒充。
- `task-state-index` 1.2.0：`riskClass / dependencyResolutions / timing`。
- `executor-session` 1.0.0：执行器会话心跳，区分投递证据与执行存活证据。
- 不变量 21 条（新增 INV-17～INV-21）。
- 枚举源 `contract-enums.json` 2.1.0。

## 刷新规则

- 只在框架发布新 tag 时刷新；新建版本目录，不覆盖旧目录。
- 刷新后更新 `PROVENANCE.json`，运行 `node scripts/orchestration/verify-framework-bundle.mjs --bundle 2.1.0`，并把 `cli validate` / CI 指向新版本。
- 本地开发仍优先读兄弟目录框架仓（`ORCH_FRAMEWORK_DIR` 可覆盖）；CI 显式指向本包，保证可复现。

## 目录

- `schemas/`：框架 2.1.0 的机读契约 + `versions.json` + `contract-enums.json`。
- `PROVENANCE.json`：来源与逐文件 SHA-256 / 字节数，禁止手改。

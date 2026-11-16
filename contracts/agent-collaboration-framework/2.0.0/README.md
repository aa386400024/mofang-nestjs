# Agent Collaboration Framework 契约包（2.0.0）

本目录是框架仓 `aa386400024/agent-collaboration-framework` **v2.0.0**（commit `c507188`）机读契约的不可变发布制品，供本仓 CLI 与 CI 做 schema 硬校验。

## 为什么固化

- 框架仓是私有仓，CI 默认令牌不能跨仓读取；把契约固化进本仓可让 CI 在无额外 secret 的前提下做真实 schema 校验，而不是软跳过。
- 固化包带 `PROVENANCE.json`（来源仓、tag、commit、逐文件 SHA-256），由 `scripts/orchestration/verify-framework-bundle.mjs` 复核；任何手改都会被 CI 拦下。

## 刷新规则

- 只在框架发布新 tag 时刷新；新建版本目录，不覆盖旧目录。
- 刷新后更新 `PROVENANCE.json`，运行 `node scripts/orchestration/verify-framework-bundle.mjs`，并把 `cli validate` 升到新版本号。
- 本地开发仍优先读兄弟目录框架仓（`ORCH_FRAMEWORK_DIR` 可覆盖）；CI 显式指向本包，保证可复现。

## 目录

- `schemas/`：框架 2.0.0 的 7 份实例契约 + `state-event` + `versions.json` + `contract-enums.json`。
- `PROVENANCE.json`：来源与哈希清单，禁止手改。

---
taskId: AF-214
contextId: phase3-orchestration-hardening
title: 记录包字节完整性（prettier 隔离回执）与密钥卫生（env-doctor / 跨机交接规程）
type: implementation
status: backlog
baselineRef: df4c772
dependsOn: []
priorTasks: [AF-213]
contractRef: urn:agent-collaboration-framework:schema:task-sheet:1.1.0
policyRefs: [conventions.md#1.1, agent-orchestration/README.md#强制准入]
createdAt: 2026-11-21T01:35:00+08:00
deadline: null
agentRole: orchestrator
scope:
  files:
    - .prettierignore
    - scripts/security/
    - docs/security/
    - package.json
    - docs/worklog/
  modules: []
  interfaces: []
artifacts:
  - name: 交付记录
    path: docs/worklog/completed/phase3-orchestration/af214-record-integrity-and-secret-hygiene-2026-11-21.md
    kind: report
  - name: 跨机密钥交接规程
    path: docs/security/secret-handoff.md
    kind: report
gates:
  - command: pnpm exec vitest run scripts/security/__tests__/
    check: env-doctor 纯函数用例全绿
    threshold: exit=0
  - command: pnpm typecheck
    check: 类型检查 0 error
    threshold: exit=0
  - command: pnpm lint
    check: ESLint 0 error
    threshold: exit=0
  - command: pnpm test
    check: 全量用例 0 failed（收尾一次）
    threshold: exit=0
  - command: git diff --stat HEAD -- src/engine-core
    check: engine-core 零改动
    threshold: empty
  - command: ORCH_REQUIRE_FRAMEWORK=1 pnpm orchestration:validate
    check: 机读校验全 PASS
    threshold: FAIL=0
successCriteria:
  - lint-staged 的 prettier 不再改写 docs/worklog/records/** 下的回执、manifest、任务单字节；记录包哈希校验在「prettier 全仓跑过」后仍稳定通过。
  - 新增 pnpm env:doctor：按 .env.example 声明的键集体检 .env，输出缺失键、空值、疑似密钥泄漏、.env 是否被 git 跟踪；不打印任何密钥值；--strict 下缺键或被跟踪即 exit 非 0。
  - docs/security/secret-handoff.md 给出跨机密钥交接的可执行规程（三方案对比、选定口径、交接回执模板、轮换与吊销）。
  - env-doctor 的解析与判定为纯函数并有确定性单测（不读真实 .env，不联网）。
---

# AF-214 · 记录包字节完整性与密钥卫生

## 背景（实证）

1. **记录包字节被格式化改写**：AF-212 交付时实证——`lint-staged` 的 `*.{json,md,yml,yaml}` 对暂存的 `docs/worklog/records/**` 回执跑 `prettier --write`，字节变化后 `manifest.receipts[].sha256` 与 `worklog verify` 的原文校验失配。当时靠手工重算哈希补救，机制缺口仍在。
2. **密钥分发无规程**：豆包 `LLM_DOUBAO_API_KEY` 已配进本机 `.env`，另一台机器只能靠人工记忆与口头传递填同一把；没有体检工具判断「这台机器的 .env 是否真的配齐」，也没有交接留痕。
3. **`.env` 被误提交的风险无门禁**：`.gitignore` 已忽略 `.env`，但没有工具在交付前主动确认「当前工作区的 .env 未被跟踪、且必需键齐全」。

## 设计

### 1. 记录包字节隔离

`.prettierignore` 增加 `docs/worklog/records/`，理由与框架契约包同构：这些文件被 manifest 以 SHA-256 固化，任何格式化都会破坏审计链。lint-staged 传入文件列表时 prettier 会尊重 ignore，因此不需要改 lint-staged 配置本身（少一处漂移点）。

### 2. env-doctor

`scripts/security/env-doctor.mjs`，纯函数拆分：

- `parseEnvKeys(text)`：解析 `KEY=VALUE` 行，跳过注释与空行，容忍 `export ` 前缀与引号；
- `diffEnvKeys(exampleKeys, envKeys)`：返回 missing / extra / emptyValue；
- `judgeEnvDoctor({example, env, tracked, ignored})`：合成 findings 与 exitCode；
- CLI：`pnpm env:doctor [--env <path>] [--example <path>] [--strict] [--json]`。

输出纪律：只打印键名、值长度与「疑似密钥」判定，永不打印值本身。

### 3. 跨机交接规程

`docs/security/secret-handoff.md`：三方案（凭据管理器 / 一次性人工粘贴 + 回执 / SOPS+age）对比，选定「一次性人工粘贴 + 交接回执」，给出回执模板（键名 + 指纹前 8 位 + 落地时间 + 目标机 + 校验命令）与轮换/吊销步骤。

## 范围

- 只改 `.prettierignore`、`scripts/security/`（新增）、`docs/security/`、`package.json`（加 `env:doctor` 入口）、`docs/worklog/`（任务单与交付记录）。
- 不碰 `src/`、`test/`、`bin/`、engine-core；不引入新依赖。

## 验收

- 新增单测覆盖解析、差集、判定与「不打印密钥值」的约束。
- 现场取证：`pnpm env:doctor` 在本机输出键齐 / 未跟踪；`prettier --write` 后 records 下文件字节不变。
- 定向用例、typecheck、lint、全量测试、validate 全绿；engine-core 零 diff。

commit message：`feat(AF-214): 记录包字节隔离与 env-doctor 密钥体检`

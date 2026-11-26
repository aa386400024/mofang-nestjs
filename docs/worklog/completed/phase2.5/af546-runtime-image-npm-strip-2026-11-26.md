---
taskId: AF-546
contextId: phase2.5-audit-remediation
title: 运行时镜像剥离 npm 自带高危依赖
status: completed
completedAt: 2026-11-26T19:45:00+08:00
baselineRef: 157f4bcba218d21b55908c5f4bdeda2d7d2406d7
commit: 任务分支 HEAD（以回执 changedFiles.commits 为准）
---

# AF-546 运行时镜像剥离 npm 自带高危依赖

## 根因

Trivy 扫到的 6 个 HIGH 全部在 `usr/local/lib/node_modules/npm/node_modules/`：npm 自带 undici 6.28.0（4 个 CVE）与 brace-expansion 5.0.9（2 个 CVE）。应用依赖树里 undici 已是 7.30.1、brace-expansion 已是 5.0.12，问题不在业务依赖。

## 改动

- `Dockerfile` prod 阶段删除 `/usr/local/lib/node_modules/npm`、`/usr/local/bin/npm`、`/usr/local/bin/npx`。
- `Dockerfile.prod` 在 `pnpm install` 与产物拷贝完成后删除 npm、corepack、pnpm 及其软链，再切非 root 用户。

运行期只保留 node、dist、生产 node_modules 与 curl/tini，不放宽扫描阈值、不升无关依赖。

## 验证

- 静态核对：prod 阶段不再保留任何包管理器目录，`CMD ["node","dist/app.js"]` 不依赖 npm。
- CI 由 Build (Docker) job 内的 Trivy 复扫确认归零。

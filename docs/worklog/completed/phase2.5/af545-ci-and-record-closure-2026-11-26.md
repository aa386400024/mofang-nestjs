---
taskId: AF-545
contextId: phase2.5-audit-remediation
title: 修复 CI 镜像扫描位置与取消任务记录包缺口
status: completed
completedAt: 2026-11-26T19:30:00+08:00
baselineRef: 33fe92e616ae3562ca7dec029fd84cfc06f9fb3e
commit: 任务分支 HEAD（以回执 changedFiles.commits 为准）
---

# AF-545 CI 镜像扫描与记录包缺口修复

## 改动

- `.github/workflows/ci.yml`：Trivy 从 `security-audit` job 移到 `build` job，紧跟镜像构建与体积检查之后，扫描同一 runner 上真实存在的 `mofang-nestjs:${{ github.sha }}`；`exit-code: '1'` 保留。Security Audit 仅保留 `pnpm audit`。
- `docs/worklog/completed/phase2.5/af538-...md`、`af539-...md`：补两份取消说明，修掉 worklog verify 的「交付记录缺文件」。

## 验证

- `node scripts/orchestration/cli.mjs worklog verify --strict --state-free`：缺口消除（AF-545 自身记录写完后再跑一次应 PASS）。
- 未改业务代码，engine-core 零 diff。

## 偏差

AF-540 初版把 Trivy 放到跨 job 扫描，实际镜像不可见导致 FATAL；本任务按 CI runner 隔离事实纠正。

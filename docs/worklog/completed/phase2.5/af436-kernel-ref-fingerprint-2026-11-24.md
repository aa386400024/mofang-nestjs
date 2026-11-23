# AF-436 取消说明

- 日期：2026-11-24
- 任务：AF-436 → **已取消（status=canceled）**
- 取消原因：任务单把 `src/`（执行器资源域）与 `scripts/`+`docs/`（编排者资源域）放进同一 scope，`run-once` 调度判 `scope-domain-conflict`，拒绝派发（任务留 ready）。
- 处置：按资源域拆分——AF-437（executor：src 侧 kernelRef 指纹模块 + 记录/服务写入 + 单测）、AF-438（orchestrator：台账按 kernelRef 分组 + 文档）。
- 本文件仅用于满足记录包校验对 canceled 任务交付记录的路径要求，不含实现内容；实现内容见 AF-437 / AF-438。

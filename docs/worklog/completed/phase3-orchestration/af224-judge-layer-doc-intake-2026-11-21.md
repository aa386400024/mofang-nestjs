# AF-224 · 预研文档入库 + 架构文档资源域补挂（交付记录）

- 任务：AF-224（documentation）
- 基线：`57077be`（AF-223 squash 合并后的 `integrate`）
- 日期：2026-11-21
- 结论：完成（预研文档入库，`docs/architecture/` 纳入 orchestrator 资源域）

## 1. 背景

`docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md` 是 2026-11-15 写下的 Phase3 AI 自动化评审体系（Judge Layer）预研方案：定位与边界、现状底座盘点、候选设计、成本与隐私边界、分阶段路线、待决策项。文档性质是预研备忘，明确声明不落地任何 `src` / `spec` / `migration` 改动。该文件自写出后一直留在工作区未跟踪，本轮按要求纳入版本库。

## 2. 改动清单

| 文件                                                                                     | 改动                                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `docs/architecture/phase3-judge-layer-ai-review-design-2026-11-15.md`                    | 新增入库，正文零改动（未改写任何结论、表格与边界声明） |
| `docs/team/agent-orchestration/agent-cards/orchestrator.json`                            | `resources` 追加 `docs/architecture/`                  |
| `docs/worklog/records/phase3-orchestration-hardening/AF-224/task-sheet.md`               | 任务单（登记产物）                                     |
| `docs/worklog/completed/phase3-orchestration/af224-judge-layer-doc-intake-2026-11-21.md` | 本交付记录                                             |
| `docs/worklog/records/phase3-orchestration-hardening/AF-224/manifest.json`               | 登记生成                                               |

## 3. 关键设计决策

1. **正文不改**：入库只做版本化，不顺手修订文档结论。文档内的基线（`bedd702`）与"预研备忘"定性保持原样，避免入库动作被误读为二次评审。
2. **同步补挂资源域**：`orchestrator` card 的 `resources` 原先不含 `docs/architecture/`，任何以该目录为 scope 的任务会在领单阶段被判 `scope-domain-conflict`（`card-router.mjs:128` 的 `validateScopeDomain` 逐条比对资源域，越域即 `valid=false`）。本单把 `docs/architecture/` 与既有的 `docs/security/`、`docs/worklog/` 并列，同层语义一致（都是"文档域"），后续架构文档类任务不再需要每次临时改 card 才能领单。
3. **顺序约束**：资源域修正本身是本单目标之一，但"不改 card 就领不到单"，因此先落 card 的一行改动再 `run-once` 领单，与 AF-222 处理 `.env.example` 越域时的处置方式一致。

## 4. 闸门数字（真实执行）

- `pnpm orchestration:contracts`：PASS，框架契约包 2.0.0（v2.0.0 / c507188），14 个文件哈希与版本一致，exit 0
- `pnpm lint`：0 error（双配置），exit 0
- `pnpm typecheck`：0 error（`tsc -b tsconfig.check.json`），exit 0
- `pnpm test`：246 files（245 passed + 1 skipped）、4162 tests（4155 passed + 7 skipped），126.83s，exit 0
- `git diff --stat HEAD -- src/engine-core`：空

## 5. 过程中踩到的两个坑（写进任务链，供后续复用）

1. **artifact kind 枚举**：任务单 `artifacts[].kind` 的合法值是 `document / dataset / schema / code / report / spec / test / other`（`contracts/agent-collaboration-framework/2.0.0/schemas/task-sheet.schema.json` 的 `artifactKind`）。写成 `doc` 会被 schema 拒（`/artifacts/1/kind must be equal to one of the allowed values`）。
2. **登记被自己的残留挡住**：首次登记失败后，手写在 `records/<id>/` 下的任务单会作为 `localRecords` 源命中，叠加自己刚创建的占号 ref（`remoteReservations`），二次登记报"编号已被占用"。处置口径：`task release-id --taskId <id>` 释放占号 → 把草稿移回 `docs/worklog/inbox/` 并清空 `records/<id>/` → 重新 `task register`。也就是"登记前不要预先在 `records/<id>/` 里写任务单"。

## 6. 提交

`docs(af224): Phase3 Judge Layer 预研方案入库 + orchestrator 资源域补挂 docs/architecture/`

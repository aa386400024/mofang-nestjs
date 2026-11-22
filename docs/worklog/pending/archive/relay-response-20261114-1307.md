# TD-14 交付回复 · entity 装饰器运行时依赖消除 · 只读方案评估

> 执行方：MiniMax Code ｜ 完成时间：2026-11-14 13:07（1307）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `20bbf53`（TD-13 交付后）

已写入交付记录。

## 1. 交付物（三件）

- **评估备忘（主交付物）**：`docs/architecture/entity-typeorm-decoupling-assessment-2026-11-14.md`（402 行 · 七章齐全：现状根因 / 四路径对比 / TypeORM 1.1.2 可行性核查 / 影响面清单 / 推荐结论 / 分期路线与试点标准 / 风险与未决项）
- **交付记录**：`docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-implementation-2026-11-14.md`
- **任务单（已归档）**：`docs/worklog/completed/phase2.5/td14-entity-typeorm-decoupling-assessment-task-2026-11-14.md`（状态行改 ✅ 并链交付记录与备忘，§7 九项已逐项勾选 + 执行方确认段）

## 2. 闸门真实数字

| 闸门         | 命令                                                                    | exit  | 数字                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                        | **0** | per-file 均值 **0.25 ms/文件**；warm 51 ms / 200 文件 / slow **0**；判定「合格（读取延迟正常，闸门数字可信）」                                                                                            |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0** | **0 error**                                                                                                                                                                                               |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**                                                                                                                                                                                               |
| Lint（权威） | `pnpm lint`                                                             | **0** | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— HEAD 既有基线，范围外未修）                                                                                           |
| oxlint fast  | `pnpm lint:fast`                                                        | **0** | **0 warning / 0 error**                                                                                                                                                                                   |
| 全量测试     | `pnpm test`                                                             | **0** | **194 passed / 1 skipped（195 文件）**、**3259 passed / 4 skipped（3263 例）**、Duration **95.06 s**；与基线 **3263 例 / 195 文件逐字一致**；本单未新增 spec                                              |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | **0** | **空**                                                                                                                                                                                                    |
| 源码零改动   | `git diff --stat HEAD -- src/ test/ bin/ src/migration/`                | **0** | **空**                                                                                                                                                                                                    |
| 范围隔离     | `git diff --name-only HEAD`                                             | **0** | 仅 **3 个 docs 文件**（台账 / phase2.5-README / wp-list，均为**主控 TD-14 立项回写**）+ 本单 3 个新文档（备忘、交付记录、归档后的任务单）；**无** package.json / tsconfig / vitest 配置 / CI / 业务域改动 |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | **12 passed**（1 文件 / 2.06 s）                                                                                                                                                                          |

**机器状态**：跑闸门时本机有 **5 个 node 常驻进程**（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite / `node dist/app`），**未擅自终止用户进程** ⇒ 墙钟 **95.06 s** 与历史基线（TD-11 约 66 s）**不可直接比较**，可比口径是用例数与文件数（本次 3263 例 / 195 文件 = 基线逐字一致）。取证会话 PATH 已补 `D:\Apps\Git\cmd`。

## 3. 备忘推荐结论（一句话）

**推荐路径 C（Row 纯类型 + 持久化分层映射）+ 配套 C+（枚举外移，3 个文件）；不推荐路径 B（纯类 + EntitySchema）—— TypeORM 1.1.2 的能力面无缺口（EntitySchema 完整覆盖仓内在用装饰器），但 B 相对 C 的增量只剩 3 个枚举的文件位置，代价却是数百文件 + 18 个关系 entity 重写 + 「schema 文件必然带 typeorm、需静态守护」的长期负担。**

两条配套判据：

- **C+ 配套必做**：枚举外移（`AnalyticsEventType` / `OAuthProvider` / `AuditEvent` → 独立纯类型文件）+「spec 零 entity import」作为每批验收项，否则闭包不解。
- **对另案 G 的收益口径修正**：**不再以「加载图减重」为 KPI**（TD-11 实测该收益为 0），改为「**service 源码层 typeorm 值符号 0 命中**」+「**该批 spec 值位置 entity import = 0**」；G 本身继续推进（契约边界 + 可测性有独立价值）。

## 4. §7 回写清单状态：九项全部完成（9/9）

| #   | 项                                                                                              | 状态                        |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------- |
| ①   | 评估备忘已写到 §3 固定路径，七章齐全                                                            | ✅                          |
| ②   | 交付记录已写到 §6 固定路径                                                                      | ✅                          |
| ③   | 任务单从 `pending/` 移到 `completed/phase2.5/`，状态行改 ✅ 并链交付记录与备忘                  | ✅                          |
| ④   | wp-list §四 TD-14 行改完成态 + 补备忘与交付记录链接                                             | ✅                          |
| ⑤   | phase2.5-README §3.0 TD-14 bullet 改完成态                                                      | ✅                          |
| ⑥   | 台账 §9 P-DEBT-11 行追加 H 项评估结论 + 链接；更新记录补一条「TD-14 落地」；另案 G / I / J 登记 | ✅（另**新增 K / L** 两项） |
| ⑦   | `git diff --stat HEAD -- src/engine-core` 空；`src/ test/ bin/ src/migration/` 零改动           | ✅                          |
| ⑧   | 提交分组核对：本单文件与并行进程产物分开                                                        | ✅                          |
| ⑨   | 给一行 commit message 草稿（**未提交**）                                                        | ✅                          |

**附加核验**：移位后全仓 markdown 相对链接逐条校验 —— **断裂 0 条**（含备忘、交付记录、任务单、wp-list、README、台账六份文件）；台账 §9 表与 wp-list §四 表的竖线数与表头一致（5 / 4），未破表。

### 遗留（本单不做，已登记）

- **G** 其余 117 个 service 仓储端口化分批推广 —— 🟠 待排期，**收益口径按备忘 §5.3 修正**
- **H** entity 装饰器运行时依赖消除 —— ✅ 评估段已交付，**实现段另案**，最小切口 = C+（3 个 entity 文件 + 1 个 spec）
- **I** 端口内存实现是否补 —— 🟢 暂不补（analytics 无此需求）
- **J** 混合形态 typeorm import 统一形态 —— 🟢 可读性向、零运行时收益，另案批量处理
- **K（新）** `bin/ormconfig.ts` 的 `entities` glob 口径脱节（CLI 看不到 99 个业务 entity；`bin/entity.ts` 反向生成器与 EntitySchema 不兼容）—— 🟠 独立既有债，本单不清理
- **L（新）** TD-13 analytics spec 残留测试闭包（仍值位置 import `AnalyticsEventType`）—— 🟠 已被 C+ 覆盖，本单只登记不改 spec

### 另需主控留意

- **锚点口径偏差**：§1 主控锚点与实测在 `@Column`(+1) / `@PrimaryGeneratedColumn`(+4) / `@PrimaryColumn`(+1) / `@JoinColumn`(+1) / `@ManyToOne`(+1) 上差 1~4 处，`forFeature` 锚点 77 计入了注释（**代码调用真值 = 40**，另 39 处注释提及）；未找到可统一解释全部差异的计数口径。**差异 ≤4 处、不影响任何结论**，已逐条登记在交付记录 §2.4 偏差表并列为未决项（备忘 §7.2 第 4 条），需一次口径对齐的复算。
- **评估中新发现（任务单未覆盖）**：TD-13 交付记录表述为「typeorm 值符号外泄 0 命中」，但其 analytics spec **仍值位置 import `AnalyticsEventType`** ⇒ **TD-13 解除了 service 源码层的直接边，没有解除测试闭包**（备忘 §1.3 事实 ③）。
- **本单零源码改动**，评估结论只陈述可行性与成本量级，**不替代未来实现单的设计决策**；备忘 §7.2 的 5 条已标注「需实现单验证」，本单不写确定结论。

## 5. commit message 草稿（**未提交，等指令**）

```
feat(td14): entity 装饰器运行时依赖消除只读评估（四路径对比 + TypeORM 1.1.2 可行性核查 + 推荐路径 C）
```

> 提交分组建议：本单改动**全部落在 docs/**，可与主控的 TD-14 立项回写（3 个已修改 docs 文件）**合并为一个 commit**；若要分开，先提交主控的立项回写，再提交本单的备忘 + 交付记录 + 归档任务单 + 三处索引回写。**不自动 commit / push**。

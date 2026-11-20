# TD-12 · coverage 阈值门禁立项（全局聚合阈值 · 观察期不阻断 build）

> 状态：✅ **已交付**（2026-11-14，MiniMax Code）→ [交付记录](td12-coverage-threshold-gate-implementation-2026-11-14.md)
> 执行方：MiniMax Code
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate
> 唯一事实源：`docs/worklog/completed/phase2.5/td11-ci-tooling-and-typeorm-type-import-implementation-2026-11-14.md` §5.3（首轮 coverage 报告）+ `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-12
> 任务性质：配置 / 口径落地（零业务代码改动）
> 改动范围：仅后端配置（`vitest.config.mts`）+ 本任务文档与索引回写；不碰 `src/` 业务代码、不碰 `test/`

---

## 0. 【必读入口】动手前按顺序读完（不许跳）

1. `E:\Work\Project\backend\mofang-nestjs\README.md` —— 仓库总览
2. `E:\Work\Project\backend\mofang-nestjs\docs\README.md` —— 文档导航
3. `E:\Work\Project\backend\mofang-nestjs\docs\team\conventions.md` —— 代码红线 + 交付格式（§1.1 engine-core 分层、§1.3 pnpm 命令规范）
4. 阶段工作入口：`docs/worklog/pending/phase2.5-README.md` 与 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md`
5. 本任务唯一事实源：TD-11 交付记录 §5.3（首轮报告数值与采集口径）
6. 本任务单（就是你在读的这份）

---

## 1. 背景（先读，方向别错）

TD-11（commit `fed30f4`）已接通 coverage 采集：`vitest.config.mts` 配了 provider v8 / text+lcov 双报告 / `./coverage` 输出目录，CI 新增独立 `coverage` job（单进程全量 `pnpm run test -- --coverage`，上传 `coverage/` artifact）。但 **当时有意不设 thresholds** —— 阈值必须先有一轮真实全量报告再拍板。现在首轮报告已产出，本单把"只采集、不阻断"补成**全局聚合阈值门禁**：覆盖率低于阈值时，采集命令 exit 非 0、CI coverage job 转红。

### 关键现状（已由主控核对，别当新问题）

- **配置现状**（`vitest.config.mts` `test.coverage` 段）：`provider: 'v8'`、`reporter: ['text', 'lcov']`、`reportsDirectory: './coverage'`、`include: ['src/**/*.ts']`、`exclude: ['src/entity/**']`；**无 `thresholds` 字段**。
- **首轮基线**（TD-11 §5.3，采集于 HEAD `1696e59`，全量 194 文件 / 3252 例，插桩 Duration 117.48 s）：

  | 指标       | 首轮覆盖率 | 命中 / 总量     |
  | ---------- | ---------- | --------------- |
  | Statements | **46.92%** | 12 391 / 26 408 |
  | Branches   | **45.66%** | 6 724 / 14 724  |
  | Functions  | **42.48%** | 2 149 / 5 058   |
  | Lines      | **46.68%** | 11 321 / 24 251 |

- **日常不插桩**：`package.json` 的 `test` 脚本是 `vitest run --exclude '**/e2e/**/*.ts'`，不带 `--coverage`；阈值只在显式采集（CI coverage job / 本机 `pnpm run test -- --coverage`）时校验，日常闸门不产生 coverage 开销。
- **CI 拓扑现状**：`build` job 的 `needs: [unit, e2e]`，**不依赖 coverage**；coverage job 独立运行、上传 artifact（`coverage-lcov`，保留 7 天），`coverage/` 不入缓存。
- **阈值类型**（vitest 5.0.5，`node_modules/vitest/dist/node.d.ts`）：`Threshold = "lines" | "functions" | "statements" | "branches"`；`perFile: boolean`；另有 `perFileThresholds`。字段名以该类型定义为准，不要用 istanbul 旧名。
- **口径事实（本单不改，仅记录）**：`exclude: ['src/entity/**']` 只覆盖 `src/entity/` 目录（内有 2 个样例 entity）；其余 **100 个业务 entity** 散在各业务域 `entities/` 子目录，目前**仍计入** coverage 统计。entity 是纯字段定义、函数覆盖天然偏低，会拉低 Functions 维度；是否调整 exclude 口径见 §2 另案。
- **pnpm 传参形态**（沿用 TD-11 D-7 结论）：采集必须走 `pnpm run test -- --coverage`；`pnpm test -- --coverage` 简写会被 pnpm 拦成 `Unknown option: 'coverage'`。

---

## 2. 范围（严格遵守，不越权）

### 在范围内

1. **`vitest.config.mts` 的 `coverage` 段新增 `thresholds`**（全局聚合，非逐文件）：

   | 指标         | 阈值（%，整数）                       | 首轮基线 | 缓冲   |
   | ------------ | ------------------------------------- | -------- | ------ |
   | `statements` | **44**                                | 46.92    | ≈2.9pp |
   | `branches`   | **43**                                | 45.66    | ≈2.7pp |
   | `functions`  | **40**                                | 42.48    | ≈2.5pp |
   | `lines`      | **44**                                | 46.68    | ≈2.7pp |
   | `perFile`    | **`false`**（显式写否，全局聚合校验） | —        | —      |
   - 阈值上方注释写明：基线来源（TD-11 §5.3 / HEAD `1696e59`）、拍板日期 2026-11-14、"只随实测覆盖率提升而上调、不向下放宽"的演进纪律。
   - 阈值数值是**本单唯一真相源**（见 §3）；除 config 注释外，不在代码 / 脚本 / 文档里另抄一份阈值数字。

2. **本机复现采集并核对**：跑 `pnpm run test -- --coverage`，确认 exit 0、四指标 ≥ §2 表内阈值；在交付记录记录新一轮报告的四指标数值、命中/总量、Duration 与机器状态（是否有 watch / dev server 常驻、盘读延迟是否正常；墙钟不与历史轮次直接比较）。

3. **CI 配置核对（拓扑不改）**：coverage job 命令与 `needs` 拓扑维持现状；静态校验 yml 可解析、引用的 package.json 脚本名存在。本单**不新增** package.json scripts（沿用 TD-11 D-5）。

4. **文档与索引回写**（§7 清单）：交付记录、任务单归档、台账 / toolchain / wp-list / README 四处索引改完成态并链交付记录。

### 明确不在范围内（禁止顺手做）

- **不改** `include` / `exclude` 口径（含是否把各域 `**/entities/**` 纳入 exclude；调整会重算基线，属另案）。
- **不启用** `perFile` / `perFileThresholds`（逐文件阈值无逐文件基线，既有低覆盖文件会逐文件卡红）。
- **不做分层阈值**（engine-core / engine-adapters / shared / 业务域分别设阈）：本地无分目录 lcov 明细，分层数值无依据，另案。
- **不改** `build` 的 `needs`：观察期内 coverage job 失败**不阻断** build；是否把 coverage 纳入 build 依赖链另案。
- **不改** `src/` 任何业务代码、**不改** `test/` 任何 spec / 夹具 / helper；**不新增**第三方依赖；**不改** `package.json`（scripts 与依赖）、tsconfig、Dockerfile / Dockerfile.prod、`.nvmrc`、CI `node-version`。
- **不为达标补测试 / 补覆盖**：本单只立门禁；低覆盖模块的补测专项另案。
- 覆盖率**不反向绑**练习评分 / 零压红线，也不作为临床正确性指标（沿用 TD-11 §5.3 口径）。
- 不碰 `admin-dashboard/` 与 Flutter；`engine-core/` 零改动，`boundary.spec.ts` 不许改。
- 不自动 git commit / push（写完给 commit 草稿，等用户指令）。

### 另案登记（本单不做，写入交付记录遗留段）

- A. 分层阈值（core / adapters / shared / 业务域）—— 待补分目录 lcov 明细后立项。
- B. 逐文件阈值 `perFile` + `perFileThresholds` —— 待逐文件基线沉淀后立项。
- C. coverage job 纳入 `build` 的 `needs`（阈值失败阻断构建）—— 观察期跑稳后评估。
- D. entity exclude 口径调整（各域 `entities/` 是否排除）—— 若调整，基线与阈值须基于重跑报告重新拍板。
- E. 低覆盖模块补测专项。
- F. 阈值定期复核与上调节奏机制。

---

## 3. 目标架构 / 交付物

- **交付物 1：阈值配置** —— `vitest.config.mts` `test.coverage.thresholds`：四指标全局阈值 + `perFile: false`，注释含基线来源与演进纪律。除该文件外无代码改动。
- **交付物 2：本机采集复现证据** —— 新一轮全量 coverage 报告数值（四指标 + 命中/总量 + Duration + 机器状态），写入交付记录 §闸门表；确认 exit 0 且不低于阈值。
- **交付物 3：测试** —— 本单无新增 spec；既有 3252 例 / 194 文件集合、断言、mock 语义、隔离语义逐字冻结。采集跑即全量 unit，顺带核对用例总数与基线一致。

> **口径真相源**：`vitest.config.mts` 的 `coverage.thresholds` 是阈值的唯一真相源。CI job、报告、索引文档只引用该配置，不复算、不另抄阈值数字。阈值演进纪律：只随实测覆盖率提升而上调；任何向下放宽必须另立任务单显式批准，不在本单内口头调整。

---

## 4. 红线（违反即返工）

- 分层归属：本单不触碰 engine-core；`git diff --stat HEAD -- src/engine-core` 必须为空，`boundary.spec.ts` 不改。
- 心理对话原文禁止进日志 / console / crash report（只出码和计数）。
- 阈值只写在 `vitest.config.mts`；不在 CI yml、脚本、文档里复制第二份阈值数字。
- 若本机复跑四指标中**任一**低于 §2 表内阈值，**不得自行下调阈值凑绿**：记录实测数值与差异、停下回报主控，由主控拍板（补测 / 调阈 / 登记豁免三选一）。
- 若复跑指标相对首轮基线偏差 >3pp（任一维度），同样停下回报，不自行解释为噪声。
- pnpm 命令规范：一律 `pnpm` / `pnpm exec`，禁止裸 `npx`；采集走 `pnpm run test -- --coverage`。
- schema / migration / 映射函数 / module 装配一律不碰；不越权加需求外功能。
- 不自动 commit / push。

---

## 5. 闸门（分层执行，填真实数字，禁止留空）

### 5.0 前置（命令规范，强制）

- 跑闸门前确认机器干净：无 `nest start --watch` / `vite dev` / `node dist/app` 常驻；跑 `pnpm doctor:fs` 记录结果（读税体检）。
- 取证会话 PATH 先补 git：`D:\Apps\Git\cmd`（依赖外部命令的 spec 才不会假失败）。

### 5.1 收尾闸门（本单跑一次，记录真实命令 / exit / 数字）

| 闸门            | 命令                                                                    | 要求                                                                                                                            |
| --------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置        | `pnpm doctor:fs`                                                        | exit 0，记录均值 ms/文件与 slow 占比                                                                                            |
| 根类型          | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                                                                         |
| 构建类型        | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                                                                         |
| Lint（权威）    | `pnpm lint`                                                             | 0 error，记录 warning 数（基线既有 1 条 e2e warning，范围外不修）                                                               |
| oxlint fast     | `pnpm lint:fast`                                                        | 0 warning / 0 error                                                                                                             |
| 采集 + 阈值校验 | `pnpm run test -- --coverage`                                           | exit 0；四指标 ≥ §2 阈值；记录四指标命中/总量、Duration、机器状态；用例总数 3252（3248 passed + 4 skipped）、194 文件与基线一致 |
| engine-core     | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                                                              |
| 测试目录        | `git diff --name-only HEAD -- test`                                     | 0 文件                                                                                                                          |
| 边界            | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                                                                       |
| CI yml 自检     | yml.parse + 脚本名比对                                                  | YAML_PARSE_OK；`lint` / `migration:run` / `test` / `test:e2e` 脚本名 4/4 存在；cache path 仍不含 `coverage`                     |

> 验收侧不重跑全量；执行方交付记录里的采集数字 + CI 结果作为合并底线。定向核对见模板 §5.4。

---

## 6. 交付记录（完成后写，路径固定）

`docs/worklog/completed/phase2.5/td12-coverage-threshold-gate-implementation-2026-11-14.md`

内容必须含：

1. 本单做了什么（一句话总结）；
2. 方案设计：实际实现 vs 任务单方案；偏差逐条写清原方案 / 实际方案 / 理由（conventions §2.5）；
3. 改动文件清单（新建 / 修改 / 删除，逐个一句用途）；
4. 闸门表：命令 / exit code / 真实数字（error、warning、用例数、coverage 四指标）；
5. 任务特有结果：新一轮 coverage 四指标 vs §2 阈值的对照、缓冲余量；
6. 风险与回归：确认未碰 engine-core / schema / 业务代码 / 内容字段；既有测试未改；
7. 遗留项：§2 另案 A–F 逐条登记 + Actions 侧待复核点（coverage job 在 CI 上是否按阈值转红 / artifact 是否上传）。

---

## 7. 【交付回写清单】做完逐项勾选（硬清单，不许跳）

- [x] 交付记录已写到 §6 固定路径
- [x] 本任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录
- [x] 回写 WP 登记表：`docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-12 行改完成、补交付记录链接
- [x] 回写阶段入口：`docs/worklog/pending/phase2.5-README.md` §3.0 TD-12 bullet 改完成态
- [x] 回写台账：`docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-12 行追加 TD-12 阈值门禁已落地结论 + 链接
- [x] 回写 backlog：`docs/worklog/pending/phase2.5-toolchain-tech-debt-2026-11-11.md` D-b 行阈值门禁状态改完成；另案 A–F 登记到对应遗留段
- [x] `git diff --stat HEAD -- src/engine-core` 为空
- [x] 提交分组核对：本单文件与并行进程产物分开；若授权代提交，stage 只含本单文件
- [x] 给一行 commit message 草稿（**不自己 commit / push**，等用户指令）

---

## 8. 回复输出约定

完成后在对话里：

1. 说一句"已写入交付记录"并附文件路径，不重复贴全文；
2. 报告闸门真实数字（tsc / eslint / vitest / coverage 四指标）；
3. 报告 §7 回写清单哪几项已做、有没有遗留；
4. 不把代码 diff 全文贴进对话，让用户自己 `git diff`。

---

_本单无新增第三方依赖；无 schema / migration 变更；未自动 commit / push。_

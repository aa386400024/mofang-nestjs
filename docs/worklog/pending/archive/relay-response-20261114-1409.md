# TD-15 交付回复 · C+ 枚举外移最小切口（P-DEBT-11 / L-1 · TD-14 推荐路线第一段）

> 执行方：MiniMax Code ｜ 完成时间：2026-11-14 14:09（1409）
> 仓库：E:\Work\Project\backend\mofang-nestjs，分支 integrate，基线 HEAD `36b3bb8`（TD-14 交付后）

已写入交付记录。

## 1. 交付物

- **交付记录**：`docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-implementation-2026-11-14.md`
- **任务单（已归档）**：`docs/worklog/completed/phase2.5/td15-enum-extraction-cplus-task-2026-11-14.md`（状态行改 ✅ 并链交付记录与上游备忘，§7 八项已逐项勾选 + 执行方确认段）
- **代码改动**：新建 3 个纯枚举文件 + 修改 19 个文件（3 entity + 15 引用点 + 1 barrel）

## 2. 本单结论（一句话）

**3 个 entity 内枚举（`AnalyticsEventType` / `OAuthProvider` / `AuditEvent`）已外移到零 typeorm 依赖的独立纯枚举文件，15 个引用点改 import 路径（3 条混 import 拆两条）+ `user/index.ts` barrel 补导出，「枚举值 → entity 文件 → typeorm 装饰器求值」这条传递闭包边解除；另案 L（TD-13 analytics spec 残留测试闭包）实测解除并关闭。**

**枚举值冻结实测**：成员 **7 / 3 / 23** 条与 HEAD **逐字节一致**；三个 entity 文件的装饰器计数 HEAD 与工作区**逐字相同**（10 / 15 / 12），diff 只见「枚举块删除 + import 增行」。

## 3. 闸门真实数字

| 闸门         | 命令                                                                    | exit  | 数字                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                        | **0** | per-file 均值 **0.15 ms/文件**；warm 29 ms / 200 文件 / slow **0**；判定「合格」                                                                                  |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | **0** | **0 error**                                                                                                                                                       |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | **0** | **0 error**                                                                                                                                                       |
| Lint（权威） | `pnpm lint`                                                             | **0** | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable —— HEAD 既有基线，范围外未修）                                                   |
| oxlint fast  | `pnpm lint:fast`                                                        | **0** | **0 warning / 0 error**                                                                                                                                           |
| 全量测试     | `pnpm test`                                                             | **0** | **194 passed / 1 skipped（195 文件）**、**3259 passed / 4 skipped（3263 例）**、Duration **112.31 s**；与基线 **逐字一致**；**未新增 spec（增量 0 例 / 0 文件）** |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                               | **0** | **空**                                                                                                                                                            |
| migration    | `git diff --stat HEAD -- src/migration/`                                | **0** | **空**                                                                                                                                                            |
| 范围隔离     | `git diff --name-only HEAD`                                             | **0** | **22 个文件** = 3 docs（主控 TD-15 立项回写）+ 19 个代码文件；**无** package.json / tsconfig / vitest 配置 / CI / 其他业务域改动                                  |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | **0** | **12 passed**（1.51 s）                                                                                                                                           |

**机器状态**：跑闸门时本机有 **5 个 node 常驻进程**（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite / `node dist/app`），**未擅自终止用户进程** ⇒ 墙钟 112.31 s 与历史基线不可直接比较，**可比口径是用例数 / 文件数**（3263 例 / 195 文件 = 基线逐字一致）。

## 4. 静态复核四项（任务单 §3.2）

| #   | 项                                            | 结果                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ①   | 3 个枚举文件零 typeorm 依赖、不引用 entity 类 | **import 语句 0 / typeorm import 0 / `@nestjs/typeorm` import 0 / entity 类 import 0**（三个文件各 0）。注：文件头注释里各出现 5 处 typeorm、2 处 entities/ 字样，是「为什么必须零依赖」的规则说明文案，不是 import                                                                  |
| ②   | td13 spec 不再 import entity                  | `analytics-event.entity` 命中 = **0**（改前 1 处值位置 import）⇒ **另案 L 实测解除并关闭**                                                                                                                                                                                           |
| ③   | 原 `entities/` 路径下枚举 import 残留         | 扫 `src/` + `test/` 全量：**RESIDUAL_COUNT = 0**；三个 entity 文件自身也不再 export 任何枚举                                                                                                                                                                                         |
| ④   | barrel 导出面不断链                           | `src/user/index.ts`：`audit-event.enum` **2** 行、`oauth-provider.enum` **2** 行（`export type *` + `export *`），`audit-log.entity` / `oauth-identity.entity` 各 **2** 行保留 ⇒ 对外可见性与改前逐字等价；全仓复核**无消费方经该 barrel 导入这两个枚举**（消费方只取 `UserModule`） |

## 5. 引用点复核与偏差

**§1.2 主控锚点偏差 = 0 处**：15 个引用点的文件清单、import 行号、值 / 类型位置定性、3 条混 import 构成**全部逐字一致**（src 11 + test 4，混 import 3 条）。逐文件明细见交付记录 §三。

**混 import 拆分口径**（entity 类留在 `entities/`，枚举走 `enums/`）：`analytics-event.repository.typeorm.ts`（`AnalyticsEvent` 值 + `AnalyticsEventType` type）、`oauth.service.ts`（`OAuthIdentity` 值 + `OAuthProvider` 值）、`audit-log.processor.ts`（`AuditLog` 值 + `AuditEvent` 值）。

**唯一与任务单表述有出入的一处**：§3.2 第 1 条的 typeorm import = 0 —— 实测 import 语句确为 0，但三个枚举文件的**文件头注释**里各出现 5 处 typeorm 字样、2 处 entities/ 字样（仓内 `// V<date> 治本` + 反双胞胎 / 如何验证三段式注释风格要求写明「为什么必须零依赖」）。复核口径按 import 语句计，已在交付记录 §三与本回复写明。

## 6. §7 回写清单状态：八项全部完成（8/8）

| #   | 项                                                                                                                  | 状态 |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| ①   | 交付记录已写到 §6 固定路径                                                                                          | ✅   |
| ②   | 任务单从 `pending/` 移到 `completed/phase2.5/`，状态行改 ✅ 并链交付记录                                            | ✅   |
| ③   | wp-list §四 TD-15 行改完成态 + 补交付记录链接                                                                       | ✅   |
| ④   | phase2.5-README §3.0 TD-15 bullet 改完成态                                                                          | ✅   |
| ⑤   | 台账 §9 P-DEBT-11 行追加 C+ 落地结论 + 链接；更新记录补一条；另案 C1 / C2 / G / I / J / K 登记；**另案 L 标注关闭** | ✅   |
| ⑥   | `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动                                             | ✅   |
| ⑦   | 提交分组核对：本单文件与并行进程产物分开                                                                            | ✅   |
| ⑧   | 给一行 commit message 草稿（**未提交**）                                                                            | ✅   |

**附加核验**：移位后六份文档的全仓 markdown 相对链接逐条校验 —— **断裂 0 条**；台账 §9 表与 wp-list §四 表的竖线数与表头一致，未破表。

## 7. 遗留（本单不做，已登记）

- **C1** 试点域（life-map → quality → home / inner_world / ai-engine）—— 🟠 **前置已满足**（C+ 验收通过即可启动）
- **C2 / G** 其余 service 端口化分批推广 —— 🟠 待排期，收益口径以 TD-14 备忘 §5.3 为准（**不以加载图减重为 KPI**）
- **I** 端口内存实现 —— 🟢 暂不补；**J** 混合形态 typeorm import 统一 —— 🟢 另案；**K** CLI `entities` glob 口径脱节 —— 🟠 独立既有债
- **L** TD-13 analytics spec 残留测试闭包 —— ✅ **本单实测解除并关闭**
- **M（新）** entity 类值位置边（`AnalyticsEvent` / `OAuthIdentity` / `AuditLog` 作为 DI token 被值位置引用）—— 🟠 **归 C1 / C2**，本单明确不动
- **N（新）** 枚举文件零 typeorm 依赖的静态守护 —— 🟢 **本单未新增守护 spec**（守住「用例数 3263 逐字不变」这条闸门口径，守护证据走 grep 四项 + lint）；建议后续并入架构测试或 lint 规则

## 8. commit message 草稿（**未提交，等指令**）

```
feat(td15): C+ 枚举外移（3 个 entity 内枚举移到纯枚举文件 + 15 个引用点改路径，解除枚举经 entity 的 typeorm 传递边）
```

> 提交分组建议：**代码与文档可分两个 commit** —— 先 `feat(td15)` 提交 22 个代码文件，再 `docs(td15)` 提交交付记录 + 归档任务单 + 3 处索引回写；主控的 TD-15 立项回写（3 个已修改 docs 文件）建议单独或与 docs 段合并。**不自动 commit / push**。

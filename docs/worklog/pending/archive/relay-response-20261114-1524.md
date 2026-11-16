# TD-16 · C1 试点域仓储端口化（life-map 域）— 交付回复

> 时间：2026-11-14 15:24 GMT+8 · 分支 integrate · 基线 HEAD `0b5cf55` · 未自动 commit / push

## 一、已写入交付记录

`docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`（281 行 / 9 章）

---

## 二、本单做了什么（一句话）

life-map 域按 TD-13 四件套落地仓储端口 —— **4 个端口**（interface + Symbol token + 窄 Row 出参）+ **4 个 TypeORM 实现**（收进 `src/life-map/data/`）+ **module 4 组 token 接线** + **端口替身 spec（26 例，零 entity import）**，产出可复制的域级模板与**首个「spec 零 entity import」样板**。

**代码改动（9 新 / 3 改 / 1 删）**

| 类别          | 文件                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| 新增端口（4） | `src/life-map/domain/repositories/{life-stage-progress,key-event,genome-dimension,drift-bottle}.repository.ts` |
| 新增实现（4） | `src/life-map/data/{life-stage-progress,key-event,genome-dimension,drift-bottle}.repository.typeorm.ts`        |
| 新增测试（1） | `test/life-map/td16-life-map-port-pilot.spec.ts`（909 行 / 26 例）                                             |
| 修改（3）     | `providers/life-map.service.ts`、`providers/drift-bottle.service.ts`、`life-map.module.ts`                     |
| 删除（1）     | `providers/drift-bottle.repository.ts`（163 行，迁入 `data/`）                                                 |

**端口方法面**：共 **20** 个方法（阶段 2 + 事件 6 + 维度 3 + 漂流瓶 9），只收 service 现有调用，**不扩通用仓储代理**，不暴露 `Repository` / `EntityManager` / `FindOptions` / 查询选项 / 操作符。

**端口划分粒度判定（任务单待决点）= 按实体分 4 个端口**，理由：三张表查询口径不同（阶段表 upsert 命中判定**不带** `deletedAt` 过滤 vs 事件 / 维度表列表**带**软删过滤），合一后同一 interface 会并存两种例外口径，C2 推广时容易被照抄成通用代理；漂流瓶是独立三态状态机 + 独立实体。

**零改动**：4 个 entity 文件一字未改；DTO / controller / enums / 其他业务域 / migration / package.json / tsconfig / vitest / CI 全不碰。

---

## 三、闸门真实数字（同机实测，2026-11-14 15:07-15:21）

| 闸门        | 命令                                                                    | 基线（TD-15 同机）                                                                | 本单实测                                                                                                                       | 结论                                                   |
| ----------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 盘读前置    | `pnpm doctor:fs`                                                        | per-file 均值 0.15 ms                                                             | per-file 均值 **0.18 ms**（walk 57ms / cold 41ms / warm 36ms / slow 0）                                                        | 判定「合格」，exit 0                                   |
| 根类型      | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                           | **0 error**，exit 0                                                                                                            | ✅                                                     |
| 构建类型    | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                           | **0 error**，exit 0                                                                                                            | ✅                                                     |
| ESLint      | `pnpm lint`                                                             | 0 error / 1 warning                                                               | **0 error / 1 warning**（唯一 warning：`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，既有基线，范围外未修），exit 0 | ✅                                                     |
| oxlint      | `pnpm lint:fast`                                                        | 0/0                                                                               | **0 error / 0 warning**，exit 0                                                                                                | ✅                                                     |
| 定向 spec   | `pnpm exec vitest run test/life-map/`                                   | —                                                                                 | **1 文件 / 26 例全过**，exit 0                                                                                                 | ✅                                                     |
| 全量测试    | `pnpm test`                                                             | 194 passed \| 1 skipped（195 文件）/ 3259 passed \| 4 skipped（3263 例）/ 112.31s | **195 passed \| 1 skipped（196 文件）/ 3285 passed \| 4 skipped（3289 例）/ 89.41s**，exit 0                                   | ✅ 净增 **+1 文件 / +26 例**，既有 3263 例**一条不减** |
| 边界        | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                         | **12 passed**，1.59s，exit 0                                                                                                   | ✅                                                     |
| engine-core | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                                | **空**                                                                                                                         | ✅                                                     |
| migration   | `git diff --stat HEAD -- src/migration/`                                | 空                                                                                | **空**                                                                                                                         | ✅                                                     |
| 范围隔离    | `git diff --name-only HEAD` + `git status --short`                      | —                                                                                 | 仅 `src/life-map/**` + `test/life-map/**` + 4 份交付文档                                                                       | ✅                                                     |

**机器状态**：5 个 node 常驻进程（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite / `node dist/app`），与 TD-15 同机同状态，未杀用户进程；墙钟不可跨单比较，**闸门以用例数为准**。

**静态复核四项（全部 0 命中）**

| 复核项                             | 口径                                                                                                                           | 结果                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| ① typeorm 值符号外泄               | TD-13 D-5 六项正则（`Repository` / `Between` / `FindOptions` / `EntityManager` / `from 'typeorm'` / `from '@nestjs/typeorm'`） | 端口 4 + service 2 + 新 spec 共 **7 个受检文件 0 命中**；落点仅 `data/` 4 个实现 + module 装配层                                |
| ② spec 零 entity import            | `entities/\|\.entity\.js`                                                                                                      | **实际 import = 0**（唯一命中是文件头注释里的说明性字面量）；`DriftBottleStatus` 按 TD-13 同款口径从**纯枚举文件**值位置 import |
| ③ service 值位置 entity import = 0 | `providers/` 下 `entities/\|\.entity\.js`                                                                                      | **0**                                                                                                                           |
| ④ 方法面不泛化                     | `findAll\|findOne\|updateById\|save(\|createQueryBuilder\|FindOptions\|EntityManager`                                          | 端口目录 **0 命中**                                                                                                             |

---

## 四、§7 回写清单（8 项全做）

- [x] **交付记录**已写到固定路径 `docs/worklog/completed/phase2.5/td16-life-map-port-pilot-c1-implementation-2026-11-14.md`
- [x] **任务单**已从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录；§7 清单 8 个勾选框全部打勾
- [x] **WP 登记表** `phase2.5-wp-list-2026-11-08.md` §四 TD-16 行改完成态 + 补交付记录链接
- [x] **阶段入口** `phase2.5-README.md` §3.0 TD-16 bullet 改完成态 + 补链接
- [x] **台账** `gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C1 落地结论 + 任务单 / 交付记录链接；**更新记录**补一条「TD-16 落地」；另案 C2 / G / I / J / K / M / N 登记口径更新
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] **提交分组核对**：本单 12 项文件（3 文档改 + 4 新增文档/源目录 + 3 源改 + 1 删）与并行进程产物分离，**无并行进程产物混入**（5 个 node 常驻进程不产生 git 改动，`admin-dashboard/` 未触碰）
- [x] **commit message 草稿**已给（见下），**未自己 commit / push**

**链接完整性复核**：回写后对 5 份受影响文档做全量相对链接校验（249 条），**本单新增 / 修改的链接全部可解析**；仅剩 1 条既有坏链（`phase2.5-README.md` 的 `../../../data/quality/disfluency-baseline-memo-2026-11-13.md`，HEAD 版本即存在，**非本单引入**，范围外未修）。

---

## 五、偏差登记（详见交付记录 §六）

D-1 端口划分粒度 = 按实体分 4 个端口（任务单允许三实体合一 / 保留类形态）· D-2 `update(id, patch)` 拆为 `markPicked` / `markResponded`（落库字段集与改前完全相同）· D-3 `getStats` 出参改端口本地 `DriftBottleStats`（结构同构）· D-4 module `exports` 去掉 `DriftBottleRepository`（全仓无跨域消费方）· D-5 upsert 语义下沉（命中判定仍不带 `deletedAt` 过滤，与改前逐字一致）· D-6 软删收成 `softDeleteEvent(eventId, deletedAt)`（删除时刻由 service 生成，DB 终态与查询数不变）· D-7 端口类型别名用 `import type` 取（编译期擦除，零运行时依赖）· D-8 本单不新增静态守护 spec（守住用例数基线）· D-9 端口内存实现不补。

任务单 §1.1 / §1.2 / §1.3 锚点与实测**一致**（`DriftBottleRepository` 仅域内消费、全仓无订阅器、9 个 helper 仅域内调用）。

---

## 六、遗留另案

**C2**（按域推广，域级模板已成型）· **G**（其余 service 分批推广，收益口径按 TD-14 §5.3 修正）· **I**（端口内存实现，🟢 暂不补）· **J**（Row 域内收编）· **K**（装配层表清单收口）· **M**（端口类型别名真相源外移）· **N**（静态守护 spec，本单未新增）。

本单**无阻塞遗留**。

---

## 七、commit message 草稿（不自己 commit / push）

```
feat(life-map): TD-16 C1 试点域仓储端口化 —— 4 端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(life-map): TD-16 C1 试点域仓储端口化 —— 4 端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-16 交付记录 + 索引回写（P-DEBT-11 / L-1）`

---

## 八、回复输出约定落实

1. 已写入交付记录并附路径（见 §一）✅
2. 闸门真实数字见 §三 ✅
3. 本单结论一句话见 §二；§7 回写清单 8 项全做见 §四；遗留见 §六 ✅
4. 未贴代码 diff 全文 ✅

---

_本单不新增第三方依赖；不改 schema / migration；仅 life-map 域仓储端口化 + 新增端口替身 spec；engine-core 零 diff；未自动 commit / push。_

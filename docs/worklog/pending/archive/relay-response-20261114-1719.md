# TD-17 · C2 第一批仓储端口化（consent 域）— 交付回复

> 时间：2026-11-14 17:19 GMT+8 · 分支 integrate · 基线 HEAD `bc7d0db` · 未自动 commit / push

## 一、已写入交付记录

`docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md`（10 章）

---

## 二、本单做了什么（一句话）

consent 域按 TD-13 四件套落地仓储端口 —— **1 个端口**（interface + Symbol token + Row / 写入入参）+ **1 个 TypeORM 实现**（收进 `src/consent/data/`）+ **module 接线** + **端口替身 spec（13 例，零 entity import）**，验证域级模板在「单 entity / 单 service」形态下的可复制性。

**代码改动（3 新 / 3 改 / 0 删）**

| 类别 | 文件                                                                                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 | `src/consent/domain/repositories/consent.repository.ts`（134 行）· `src/consent/data/consent.repository.typeorm.ts`（122 行）· `test/consent/td17-consent-port-c2-batch1.spec.ts`（363 行 / 13 例）                                                |
| 修改 | `src/consent/providers/consent.service.ts`（依赖改端口 + 行构造移到 service）· `src/consent/consent.module.ts`（1 组 token 接线，保留 `forFeature`）· `test/admin-debug/wp69-debug-panel-improvements.spec.ts`（既有 spec 替身形状适配，断言未改） |
| 删除 | 无                                                                                                                                                                                                                                                 |

**端口方法面**：**4 个方法**，一一对应改前 5 处仓储调用（`save` 复用两路写入）—— `findByIdempotentKey` / `findLatestByDevice` / `save` / `bindDeviceToUser`。只收现有调用，不扩通用仓储代理，不暴露 Repository / EntityManager / FindOptions / 查询选项，端口不写 SQL。

**端口划分粒度判定 = 单端口**：1 张表 / 1 个 service / 5 处调用同表，拆多端口只会把同表口径切碎（与 TD-16 life-map 的 4 端口判定不冲突 —— 那里是 4 张表、4 套不同口径）。

**零改动**：entity 文件一字未改（12 字段 / 1 唯一 + 3 普通索引全保留）；DTO / controller（3 端点 + 限流 + 鉴权）/ barrel 导出面 / migration / 配置 / CI / 其他业务域全不碰。

---

## 三、闸门真实数字（同机实测，2026-11-14 17:06-17:14）

| 闸门           | 命令                                                                    | 基线（HEAD `bc7d0db`）                                                      | 本单实测                                                                                                                       | 结论                                                   |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 盘读前置       | `pnpm doctor:fs`                                                        | per-file 均值 0.15 ms                                                       | per-file 均值 **0.31 ms**（walk 90ms / cold 381ms slow 13 / warm 61ms slow 2）                                                 | 判定「合格」，exit 0                                   |
| 根类型         | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"` | 0 error                                                                     | **0 error**，exit 0                                                                                                            | ✅                                                     |
| 构建类型       | `pnpm exec tsc -p tsconfig.build.json --noEmit`                         | 0 error                                                                     | **0 error**，exit 0                                                                                                            | ✅                                                     |
| ESLint         | `pnpm lint`                                                             | 0 error / 1 warning                                                         | **0 error / 1 warning**（唯一 warning：`test/e2e/v2-user-flow.spec.ts:1` unused eslint-disable，既有基线，范围外未修），exit 0 | ✅                                                     |
| oxlint         | `pnpm lint:fast`                                                        | 0/0                                                                         | **0 error / 0 warning**，exit 0                                                                                                | ✅                                                     |
| 定向 spec      | `pnpm exec vitest run test/consent/`                                    | —                                                                           | **1 文件 / 13 例全过**，exit 0                                                                                                 | ✅                                                     |
| 既有 spec 连带 | `pnpm exec vitest run test/consent/ test/admin-debug/ test/config/`     | —                                                                           | **19 文件**（18 passed + 1 skipped）/ **286 例**（282 passed + 4 skipped），exit 0                                             | ✅                                                     |
| 全量测试       | `pnpm test`                                                             | 195 passed \| 1 skipped（196 文件）/ 3285 passed \| 4 skipped（3289 例）/ — | **196 passed \| 1 skipped（197 文件）/ 3298 passed \| 4 skipped（3302 例）/ 85.10s**，exit 0                                   | ✅ 净增 **+1 文件 / +13 例**，既有 3289 例**一条不减** |
| 边界           | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                | 12 passed                                                                   | **12 passed**，2.49s，exit 0                                                                                                   | ✅                                                     |
| engine-core    | `git diff --stat HEAD -- src/engine-core`                               | 空                                                                          | **空**                                                                                                                         | ✅                                                     |
| migration      | `git diff --stat HEAD -- src/migration/`                                | 空                                                                          | **空**                                                                                                                         | ✅                                                     |
| 范围隔离       | `git diff --name-only HEAD` + `git status --short`                      | —                                                                           | 仅 `src/consent/**` + `test/consent/**` + 1 处既有 spec 替身 + 交付文档                                                        | ✅                                                     |

**机器状态**：5 个 node 常驻进程（`pnpm start:dev` / `nest start --watch` / `pnpm dev` / admin-dashboard vite / `node dist/app`），与 TD-15 / TD-16 同机同状态，未杀用户进程；墙钟不可跨单比较，**闸门以用例数为准**。

**静态复核四项（全部 0 命中）**

| 复核项                             | 口径                                                                                             | 结果                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| ① typeorm 值符号外泄               | TD-13 D-5 六项正则                                                                               | 端口 1 + service 1 + 新 spec 共 **3 个受检文件 0 命中**；落点仅 `data/` 实现（6）+ module 装配层 |
| ② spec 零 entity import            | `entities/\|\.entity\.js\|UserConsent`                                                           | **0**（连 DTO 类都不 import，按结构传参）                                                        |
| ③ service 值位置 entity import = 0 | `providers/` 下同口径                                                                            | **0**                                                                                            |
| ④ 方法面不泛化                     | `findAll\|findOne\|updateById\|.save(\|createQueryBuilder\|FindOptions\|EntityManager\|.create(` | 端口目录 **0 命中**                                                                              |

---

## 四、偏差登记（详见交付记录 §六，共 7 条）

**D-1（重要）** 任务单 §1.2 / §2 称「`test/` 下**零** consent 既有 spec」「其他域 spec 不新增、不修改」—— 实测**有 2 处既有 spec 引用本域 service**：① `test/admin-debug/wp69-debug-panel-improvements.spec.ts` 直接 `new ConsentService({ findOne: async () => null } as never, stubConfig(...))`，构造参数类型随端口化变化 ⇒ 替身**形状必须改**（`findOne` → `findLatestByDevice`，3 处），**断言逐字未改**（最小适配）；② `test/config/wp69-env-blindspot-expansion.spec.ts` 以**源码文本**断言 `get<{ currentVersion?: string }>('consent')` 仍在 —— 本单保留该行**逐字不变**，该 spec **零改动**且全绿。

**D-2（重要）** 任务单 §3.1 称「fire-and-forget 写入失败容忍语义（不抛异常，返回 lastError）」—— 实测 `ConsentService.record` **无 try/catch、无 lastError 字段**，写入失败**会抛异常**（类头注释与实现不一致）。本单以实测为准：**不新增 try/catch**（属行为变更，超出结构重构范围），改用**新 spec A13 行为锁**把现状锁住，并登记为**另案 P**。

**D-3** `save` 出入参类型：任务单建议 `save(row: ConsentRow)`；实测「新增行」路径**没有 id**，Row 表达不了「新增 / 更新」两条路径 ⇒ 改为 `save(input: SaveConsentInput)`（`id` / `acceptedAt` / `updatedAt` 可选）。

**D-4** metadata 缺省判定**不用 `??`**：DTO 的 `@IsOptional()` 让显式 `null` 也能过校验，改前在 null 时会**写 null**，而 `??` 会**保留原值**（漂移）⇒ 用显式 `let metadata` + `if (dto.metadata !== undefined)` 保留原语义。

**D-5** 实现类名取 `ConsentRepositoryTypeorm`（任务单示例写作 `ConsentRepositoryTypeOrm`）—— 沿用 TD-16 域级模板命名，仅命名。

**D-6** service 侧**零仓储工厂依赖**（行纯对象在 service 内构造），实现层落库仍走实体工厂调用 —— 符合任务单意图，属实现细节。

**D-7** 端口 4 个方法与任务单 §1.3 锚点**一致**，无偏差。

任务单其余锚点（域选定 5 条标准、8 个 `.ts` 清单、5 处调用形态、entity 索引口径、forFeature 保留、exports 不变）与实测**一致**。

---

## 五、§7 回写清单（8 项全做）

- [x] **交付记录**已写到固定路径 `docs/worklog/completed/phase2.5/td17-consent-port-c2-batch1-implementation-2026-11-14.md`
- [x] **任务单**已从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录；§7 清单 8 个勾选框全部打勾
- [x] **WP 登记表** `phase2.5-wp-list-2026-11-08.md` §四 TD-17 行改完成态 + 补交付记录链接
- [x] **阶段入口** `phase2.5-README.md` §3 TD-17 bullet 改完成态 + 补链接
- [x] **台账** `gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 **C2 第一批落地结论** + 任务单 / 交付记录链接；**更新记录**补一条「TD-17 落地」；另案 C2 / G / I / J / K / M / N 登记口径更新 + **P** 新增
- [x] `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
- [x] **提交分组核对**：本单 12 项文件与并行进程产物分离（5 个 node 常驻进程无 git 改动；`admin-dashboard/` 未触碰；主控归档的 `docs/worklog/pending/archive/relay-response-20261114-1524.md` 属 TD-16 产物，**不纳入本单 stage**）
- [x] **commit message 草稿**已给，**未自己 commit / push**

**链接完整性复核**：回写后对 5 份受影响文档做全量相对链接校验（255 条），**本单新增 / 修改的链接全部可解析**；仅剩 1 条既有坏链（`phase2.5-README.md` 的 `../../../data/quality/disfluency-baseline-memo-2026-11-13.md`，HEAD 版本即存在、**非本单引入**，范围外未修）。

---

## 六、遗留另案

**C2**（第二批候选：emergency → good_state_diary → home / inner_world / ai-engine）· **G**（其余 service 分批推广，收益口径按 TD-14 §5.3 修正）· **I**（端口内存实现，🟢 暂不补）· **J**（混合形态 import 统一）· **K**（CLI entities glob 口径脱节）· **M**（barrel entity 类值导出边）· **N**（静态守护 spec，本单未新增）· **P**（新增：consent 失败容忍语义未落地 —— 类注释承诺「不抛异常 / 返回 lastError」但实现无 try/catch，**建议单独一单**统一）。

本单**无阻塞遗留**。

---

## 七、commit message 草稿（不自己 commit / push）

```
feat(consent): TD-17 C2 第一批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(consent): TD-17 C2 第一批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-17 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第一批）`

---

_本单不新增第三方依赖；不改 schema / migration；仅 consent 域仓储端口化 + 新增端口替身 spec + 1 处既有 spec 替身形状最小适配；engine-core 零 diff；未自动 commit / push。_

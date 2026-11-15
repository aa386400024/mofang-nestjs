# TD-19 · C2 第三批仓储端口化（emergency 域）— 交付回执

已写入交付记录：`docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md`

**结论一句话**：emergency 域按 TD-13 四件套完成仓储端口化（C2 推广第三批）—— **1 个端口（4 个方法）** + TypeORM 实现（**两处原生 `repo.query()` SQL 全文下沉**）+ module 接线 + 端口替身 spec（16 例），**spec 零 entity import**、**本域零既有测试适配面**，业务语义零漂移。

---

## 一、闸门真实数字（本机实跑，exit code 实测）

机器状态：闸门前后各查一次，**5 个 node 常驻进程**（PID 12992 `pnpm start:dev` · 14612 `nest start --watch` · 20740 `pnpm dev`（admin-dashboard）· 7860 `vite`（admin-dashboard）· 7264 `node --enable-source-maps dist/app`）—— 未杀用户进程；墙钟可比性以用例数 / 文件数为准。

| 闸门         | 命令                                                                     | exit | 实测数字                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                         | 0    | walk 39 ms · cold 33 ms slow 0 · warm 27 ms slow 0 · **per-file 均值 0.13 ms/文件** · 判定「合格（读取延迟正常，闸门数字可信）」                    |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`  | 0    | **0 error**                                                                                                                                         |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                          | 0    | **0 error**                                                                                                                                         |
| Lint（权威） | `pnpm lint`                                                              | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，基线既有、范围外未修）                                       |
| oxlint fast  | `pnpm lint:fast`                                                         | 0    | **0 warning / 0 error**                                                                                                                             |
| 定向 spec    | `pnpm exec vitest run test/emergency/`                                   | 0    | **1 文件 / 16 例全绿**，772 ms                                                                                                                      |
| 全量测试     | `pnpm test`                                                              | 0    | **198 passed + 1 skipped（199 文件）· 3334 passed + 4 skipped（3338 例）**，Start 02:18:32，**Duration 94.13 s**                                    |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                | 0    | **空**（零 diff）                                                                                                                                   |
| migration    | `git diff --stat HEAD -- src/migration/`                                 | 0    | **空**（零 diff）                                                                                                                                   |
| 范围隔离     | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` | 0    | 本单 = 3 新增（端口 / 实现 / 新 spec）+ 2 修改（service / module）+ 交付文档；另有主控归档 relay 3 份 ?? 与 TD-18 遗留 3 份索引改动，**不纳入本单** |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                 | 0    | **12 passed**                                                                                                                                       |

**全量口径对比**：基线 **3318 passed + 4 skipped（3322 例 / 198 文件）** → 本单 **3334 passed + 4 skipped（3338 例 / 199 文件）**，净增 **+16 例 / +1 文件**，增量 = 本单新增 spec 的 16 例，**既有 3322 例一条不减**。

---

## 二、静态复核四项（§3.2）

1. **typeorm 符号外泄** = **0 命中**（受检面 3 个文件：端口 / service / 新 spec；grep 模式 `Repository<` · `Between` · `FindOptions` · `EntityManager` · `from "typeorm"` · `from "@nestjs/typeorm"` · `@InjectRepository` · `getRepositoryToken` · `createQueryBuilder` · `SelectQueryBuilder` · `repo.query`）。typeorm 值符号只落 2 处：`src/emergency/data/emergency-session.repository.typeorm.ts`（实现层）+ `emergency.module.ts`（装配层 `forFeature`）。宽模式 `Repository` 的命中**全部**是自研命名（端口 interface `EmergencySessionRepository`），已归因登记。
2. **spec 零 entity import** = **0**（新 spec 对 `entities/` 路径 / 实体类名的引用全为 0）。
3. **service 值位置 entity import** = **0**（含注释：原 TS2345 说明里的实体类名已改为 `_QueryDeepPartialEntity<…>`，语义不变）。
4. **方法面不泛化** = 端口恰 **4** 个方法（upsert / findById / list / aggregateToolStats），与 5 处既有调用一一对应（① + ② 合并为 `upsert`），无 `findAll` / `updateById` 之类通用代理；新 spec **A15** 显式断言方法名集合恰为那 4 个。

**另两项开工取证**：

- `isTerminalPhase` 全仓 grep = **1 处命中（仅自身定义）** → 确认 **0 调用方**（死代码观察项成立）
- `test/` 下 4 个他域 spec 提到 emergency，但 grep `EmergencySessionEntity` / `EmergencyService` / 本域路径 import = **0** → 确认**零既有测试适配面**

---

## 三、§7 回写清单（8 项全做）

1. ✅ 交付记录已写到固定路径 `docs/worklog/completed/phase2.5/td19-emergency-port-c2-batch3-implementation-2026-11-15.md`
2. ✅ 任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录；§7 清单 8 个勾选框已逐项打勾
3. ✅ 回写 WP 登记表 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-19 行改完成态 + 补交付记录链接
4. ✅ 回写阶段入口 `docs/worklog/pending/phase2.5-README.md` §3 TD-19 bullet 改完成态
5. ✅ 回写台账 `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第三批落地结论 + TD-19 任务单 / 交付记录链接 + `· **C2 / G**` 更新为「第一 / 二 / 三批已交付」+ 新观察（`isTerminalPhase` 0 调用方）+ 更新记录补一条 TD-19 落地
6. ✅ `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
7. ✅ 提交分组核对：本单文件与并行进程产物分开（主控归档 relay 3 份与 TD-18 遗留 3 份索引改动不纳入本单 stage）
8. ✅ 给一行 commit message 草稿（**未自动 commit / push**）

**链接可达性复核**：交付记录 / 归档任务单 / wp-list / phase2.5-README / 台账 5 份文档共 **135** 个相对链接目标全部实测存在（ALL_OK），TD-19 两份文档各被 3 处引用。

---

## 四、遗留

- **另案沿用**：C2 / G（下一批候选 home / inner_world / ai-engine → companion → profile / user / counselor）、I（端口内存实现）、J（混合形态 import 统一）、K（CLI entities glob 口径脱节）、M（barrel entity 值导出边）、N（静态守护 spec）、P（consent 失败容忍语义，与本域无关）
- **新观察**：`src/emergency/enums/emergency.enums.ts` 的 `isTerminalPhase(phase)` 实测**全仓 0 调用方**（grep 仅命中自身定义）—— 死代码，另案评估是否删除；本单**不动 enums 文件**
- **沿用 TD-18 观察**：根目录 e2e 遗留 spec 未被任何 vitest config 收集，测试入口收纳另案评估
- **Actions 侧**：CI 结果待主控 push 后在 Actions 复核（本机闸门已全绿）
- **偏差**（已登记交付记录 §八）：D-1 upsert 出参取 `Promise<EmergencySessionRow | null>`，抛错判定留 service（对齐 TD-18 口径）；D-2 `findById(id, uid?)` 一方法两读法（upsert 回读 id 单条件 / getOne id+uid 双条件）；D-3 聚合行 snake_case→camelCase + `Number(...)` + AVG NULL 兜底下沉实现层；D-4 service 注释内实体类名 scrub 为 `_QueryDeepPartialEntity<…>`；D-5 默认列表上限 100 随口径下沉实现层；D-6 upsert 回读不单列端口方法（对外仍 4 方法）

---

## 五、commit message 草稿（未提交，等指令）

```
feat(emergency): TD-19 C2 第三批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(emergency): TD-19 C2 第三批仓储端口化 —— 1 端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-19 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第三批）`

_回执时间：2026-11-15 GMT+8 · 基线 HEAD `bedd702` · 未自动提交_

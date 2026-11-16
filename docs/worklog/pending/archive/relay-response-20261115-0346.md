# TD-20 · C2 第四批仓储端口化（home 域 · 干净切片：home_messages + mood_logs）— 交付回执

已写入交付记录：`docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-implementation-2026-11-15.md`

**结论一句话**：home 域的 **home_messages + mood_logs** 两张扁平子表按 TD-13 四件套完成仓储端口化（C2 推广第四批）—— **2 个端口**（消息 2 方法**无 Row 出参** / 打卡 4 方法带 `MoodLogRow`）+ **2 个 TypeORM 实现**（**实体工厂下沉** + 两个时间窗查询 + 物理删除）+ module 两组 token 接线 + 端口替身 spec（**22 例**），**spec 零 entity import**、**零既有测试适配面**，业务语义零漂移。

---

## 一、闸门真实数字（本机实跑，exit code 实测）

机器状态：闸门前后各查一次，**5 个 node 常驻进程**（PID 7860 `vite`（admin-dashboard）· 12992 `pnpm start:dev` · 14612 `nest start --watch` · 15832 `node --enable-source-maps dist/app` · 20740 `pnpm dev`（admin-dashboard））—— 未杀用户进程；墙钟可比性以用例数 / 文件数为准。

| 闸门         | 命令                                                                     | exit | 实测数字                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 盘读前置     | `pnpm doctor:fs`                                                         | 0    | walk 41 ms · cold 39 ms slow 0 · warm 34 ms slow 0 · **per-file 均值 0.17 ms/文件** · 判定「合格（读取延迟正常，闸门数字可信）」                                                           |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`  | 0    | **0 error**                                                                                                                                                                                |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                          | 0    | **0 error**                                                                                                                                                                                |
| Lint（权威） | `pnpm lint`                                                              | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，基线既有、范围外未修）                                                                              |
| oxlint fast  | `pnpm lint:fast`                                                         | 0    | **0 warning / 0 error**                                                                                                                                                                    |
| 定向 spec    | `pnpm exec vitest run test/home/`                                        | 0    | **1 文件 / 22 例全绿**，924 ms                                                                                                                                                             |
| 全量测试     | `pnpm test`                                                              | 0    | **199 passed + 1 skipped（200 文件）· 3356 passed + 4 skipped（3360 例）**，Start 03:43:13，**Duration 92.37 s**                                                                           |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                | 0    | **空**（零 diff）                                                                                                                                                                          |
| migration    | `git diff --stat HEAD -- src/migration/`                                 | 0    | **空**（零 diff）                                                                                                                                                                          |
| 范围隔离     | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` | 0    | 本单 = 5 新增（2 端口 / 2 实现 / 1 新 spec）+ 3 修改（2 service / module）+ 交付文档；另有主控产物（phase3 设计文档 ?? + 4 份归档 relay ??）与 TD-19 遗留的 3 份索引文档 M，**不纳入本单** |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                 | 0    | **12 passed**（1.81 s）                                                                                                                                                                    |

**全量口径对比**：基线 **3334 passed + 4 skipped（3338 例 / 199 文件）** → 本单 **3356 passed + 4 skipped（3360 例 / 200 文件）**，净增 **+22 例 / +1 文件**，增量 = 本单新增 spec 的 22 例，**既有 3338 例一条不减**。

---

## 二、静态复核四项（§3.2）

1. **typeorm 符号外泄** = **0 命中**（受检面 5 个文件：2 端口 + 2 service + 新 spec；grep 模式 `Repository<` · `Between` · `FindOptions` · `EntityManager` · `from "typeorm"` · `from "@nestjs/typeorm"` · `@InjectRepository` · `getRepositoryToken` · `createQueryBuilder` · `SelectQueryBuilder` · `repo.query` · `MoreThanOrEqual` · `IsNull` · `In(`）。typeorm 值符号只落 3 处：2 个 `data/` 实现文件（9 / 7 命中）+ `home.module.ts`（装配层 `forFeature`）。宽模式 `Repository` 的命中**全部**是自研命名（端口 interface `HomeMessageRepository` / `MoodLogRepository`），已归因登记。
2. **spec 零 entity import** = **0**（新 spec 对 `entities/` 路径的引用全为 0）。
3. **service 值位置 entity import = 0** = **0**（词边界正则 `\bHomeMessage\b` / `\bMoodLog\b` 在 5 个受检文件全为 0 命中；含注释：原注释里的 `FindOptionsWhere<HomeMessage>` / `MoreThanOrEqual` 已改为业务口径描述）。
4. **方法面不泛化** = 消息端口恰 **2** 个方法、打卡端口恰 **4** 个方法，与 8 处既有调用一一对应（① / ③ 同口径合并为 `countUnread`、④ 工厂 + 保存合并为 `create`），无 `findAll` / `updateById` 之类通用代理；新 spec **A7 / B13** 显式断言方法名集合。

---

## 三、§7 回写清单（8 项全做）

1. ✅ 交付记录已写到固定路径 `docs/worklog/completed/phase2.5/td20-home-messages-moodlog-port-c2-batch4-implementation-2026-11-15.md`
2. ✅ 任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录；§7 清单 8 个勾选框已逐项打勾
3. ✅ 回写 WP 登记表 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-20 行改完成态 + 补交付记录链接
4. ✅ 回写阶段入口 `docs/worklog/pending/phase2.5-README.md` §3 TD-20 bullet 改完成态
5. ✅ 回写台账 `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第四批落地结论 + TD-20 任务单 / 交付记录链接 + `· **C2 / G**` 更新为「第一 / 二 / 三 / 四批已交付」+ 新观察（`logMood` 全仓 0 调用方、本域日期按服务端本地时区）+ 更新记录补一条 TD-20 落地
6. ✅ `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
7. ✅ 提交分组核对：本单文件与并行进程产物分开（主控 phase3 文档与 4 份归档 relay、TD-19 遗留的 3 份索引改动不纳入本单 stage）
8. ✅ 给一行 commit message 草稿（**未自动 commit / push**）

**链接可达性复核**：交付记录 / 归档任务单 / wp-list / phase2.5-README / 台账共 **137** 个相对链接目标全部实测存在（ALL_OK 137）。

---

## 四、遗留

- **另案沿用**：C2 / G（下一批候选 home 微干预一族 + companion / overview 切片 → inner_world → ai-engine → companion → profile / user / counselor）、I（端口内存实现）、J（混合形态 import 统一）、K（CLI entities glob 口径脱节）、M（barrel entity 值导出边）、N（静态守护 spec）、P（consent 失败容忍语义，与本域无关）
- **新观察**：`HomeMoodLogService.logMood` 全仓 grep 仅命中自身定义与日志行 → **0 调用方**（home 域无 mood-log controller，公共 API 预留；本单不改其存在性）；`getRecentTrend` / `getTodayLatest` 的「今天 / 近 N 天」边界按服务端本地时区计算（V3 计划接 timezone 入参，本批不改该口径）；两个 entity 自身注释仍写「软删用 read_at」而 `readAt` **不是软删列**（entity 一字不改红线内，另案）
- **沿用 TD-19 观察**：`isTerminalPhase` 全仓 0 调用方死代码；**沿用 TD-18 观察**：根目录 e2e 遗留 spec 未被任何 vitest config 收集
- **Actions 侧**：CI 结果待主控 push 后在 Actions 复核（本机闸门已全绿）
- **偏差**（已登记交付记录 §八）：D-1 端口 `markRead` 签名取 `string[] | undefined`（跟 service 形参逐字一致，不引入 null↔undefined 转换）；D-2 `logMood` 出参由 entity 类改为结构等价的 `MoodLogRow`（6 字段不变、无调用方受影响）；D-3 `getTodayLatest` / `toOverviewFields` 类型签名换 `MoodLogRow`；D-4 已读时刻生成点移到实现层（语义等价）；D-5 注释内 typeorm 字面量 scrub；D-6 「软删」措辞改「已读隐藏」；D-7 消息端口无 Row 出参（按任务单锚点实现）；D-8 任务单「受检面共 6 个」为**计数错配**，实测 5 个（2 端口 + 2 service + 1 spec）

---

## 五、commit message 草稿（未提交，等指令）

```
feat(home): TD-20 C2 第四批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(home): TD-20 C2 第四批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-20 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第四批）`

_回执时间：2026-11-15 GMT+8 · 基线 HEAD `6d3b457` · 未自动提交_

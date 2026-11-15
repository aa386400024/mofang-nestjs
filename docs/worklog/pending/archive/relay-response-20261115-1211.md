# TD-21 · C2 第五批仓储端口化（counselor 域 · 金句子族：quotes + user_quote_favorites）— 交付回执

已写入交付记录：`docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-implementation-2026-11-15.md`

**结论一句话**：counselor 域的**金句子族**（两张扁平子表 + 唯一消费 `QuoteService`）按 TD-13 四件套完成仓储端口化（C2 推广第五批）—— **2 个端口**（金句 5 方法 + `QuoteRow` 13 字段**含列级软删 `deletedAt`**；收藏 4 方法 + `FavoriteRow` 5 字段**硬删无软删列**）+ **2 个 TypeORM 实现**（**可见性查询构造 + keyset 游标下沉**）+ module 两组 token 接线 + 端口替身 spec（**21 例**），spec 零 entity import、零既有测试适配面，业务语义零漂移。

---

## 一、闸门真实数字（本机实跑，exit code 实测）

机器状态：闸门前后各查一次，**2 个 node 常驻进程**（PID 7860 `vite`（admin-dashboard）· 20740 `pnpm dev`（admin-dashboard））—— 本次会话期间 `nest start --watch` / `pnpm start:dev` / `node dist/app` **未运行**（较 TD-19 / TD-20 会话少 3 个常驻进程），故本次墙钟不代表最坏工况；墙钟可比性以用例数 / 文件数为准。

| 闸门         | 命令                                                                     | exit | 实测数字                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 盘读前置     | `pnpm doctor:fs`                                                         | 0    | walk 45 ms · cold 142 ms slow 7 · warm 25 ms slow 0 · **per-file 均值 0.12 ms/文件** · 判定「合格（读取延迟正常，闸门数字可信）」                                                        |
| 根类型       | `pnpm exec tsc -p tsconfig.json --noEmit --types "node,vitest/globals"`  | 0    | **0 error**                                                                                                                                                                              |
| 构建类型     | `pnpm exec tsc -p tsconfig.build.json --noEmit`                          | 0    | **0 error**                                                                                                                                                                              |
| Lint（权威） | `pnpm lint`                                                              | 0    | **0 error / 1 warning**（`test/e2e/v2-user-flow.spec.ts:1` 既有 unused eslint-disable，基线既有、范围外未修）                                                                            |
| oxlint fast  | `pnpm lint:fast`                                                         | 0    | **0 warning / 0 error**                                                                                                                                                                  |
| 定向 spec    | `pnpm exec vitest run test/counselor/`                                   | 0    | **19 文件 / 287 例全绿**，23.24 s（既有 18 文件 / 266 例 + 本批新增 1 文件 / 21 例）                                                                                                     |
| 全量测试     | `pnpm test`                                                              | 0    | **200 passed + 1 skipped（201 文件）· 3377 passed + 4 skipped（3381 例）**，Start 12:06:39，**Duration 102.14 s**                                                                        |
| engine-core  | `git diff --stat HEAD -- src/engine-core`                                | 0    | **空**（零 diff）                                                                                                                                                                        |
| migration    | `git diff --stat HEAD -- src/migration/`                                 | 0    | **空**（零 diff）                                                                                                                                                                        |
| 范围隔离     | `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` | 0    | 本单 = 5 新增（2 端口 / 2 实现 / 1 新 spec）+ 2 修改（service / module）+ 交付文档；另有主控产物（phase3 设计文档 ?? + 5 份归档 relay ??）与 TD-20 遗留的 3 份索引文档 M，**不纳入本单** |
| 边界         | `pnpm exec vitest run test/engine-core/boundary.spec.ts`                 | 0    | **12 passed**（1.93 s）                                                                                                                                                                  |

**全量口径对比**：基线 **3356 passed + 4 skipped（3360 例 / 200 文件）** → 本单 **3377 passed + 4 skipped（3381 例 / 201 文件）**，净增 **+21 例 / +1 文件**，增量 = 本单新增 spec 的 21 例，**既有 3360 例一条不减**。

---

## 二、静态复核四项（§3.2）

1. **typeorm 符号外泄** = **0 命中**（受检面 4 个文件：2 端口 + 目标 service + 新 spec；grep 模式 `Repository<` · `Between` · `FindOptions` · `EntityManager` · `from "typeorm"` · `from "@nestjs/typeorm"` · `@InjectRepository` · `getRepositoryToken` · `createQueryBuilder` · `SelectQueryBuilder` · `repo.query` · `MoreThanOrEqual` · `IsNull` · `In(`）。typeorm 值符号只落 3 处：2 个 `data/` 实现文件（8 / 5 命中）+ `counselor.module.ts`（装配层 `forFeature`）。宽模式 `Repository` 的命中**全部**是自研命名（`QuoteRepository` / `QuoteFavoriteRepository`），已归因登记。
2. **spec 零 entity import** = **0**（新 spec 对 `entities/` 路径的引用全为 0）。
3. **service 值位置 entity import = 0** = **0**（词边界正则 `\bQuote\b` / `\bUserQuoteFavorite\b` 在 4 个受检文件全为 0 命中；含注释：service 内 entity 类名与 `entities/` 路径引用已清零）。
4. **方法面不泛化** = 金句端口恰 **5** 个方法、收藏端口恰 **4** 个方法，与 9 处调用形态一一对应（今日池 / feed keyset / 游标锚点 / 存在性校验 / 按 id 集合取行 + 幂等 upsert / 硬删 / 收藏关系列表 / 已收藏 id 查询），无 `findAll` / `updateById` / `deleteAll` 之类通用代理；新 spec **E2** 显式断言两个方法名集合。

**可见性谓词全仓唯一一处**：全仓 grep `q.userId IS NULL OR q.userId = :userId` = **1 处命中**（`src/counselor/data/quote.repository.typeorm.ts`）—— 改前该谓词在 service 内**写了两遍**（今日池 + feed），本单收敛为唯一一处，文本逐字未变。

---

## 三、§7 回写清单（8 项全做）

1. ✅ 交付记录已写到固定路径 `docs/worklog/completed/phase2.5/td21-counselor-quote-port-c2-batch5-implementation-2026-11-15.md`
2. ✅ 任务单从 `pending/` 移到 `completed/phase2.5/`，顶部状态行改 ✅ 并链交付记录；§7 清单 8 个勾选框已逐项打勾
3. ✅ 回写 WP 登记表 `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` §四 TD-21 行改完成态 + 补交付记录链接
4. ✅ 回写阶段入口 `docs/worklog/pending/phase2.5-README.md` §3 TD-21 bullet 改完成态
5. ✅ 回写台账 `docs/team/gate-performance-remediation-2026-11-11.md` §9 P-DEBT-11 行追加 C2 第五批落地结论 + TD-21 任务单 / 交付记录链接 + `· **C2 / G**` 更新为「第一 ~ 第五批已交付」+ 新观察（收藏 entity 注释与实现脱节）+ 更新记录补一条 TD-21 落地（主控并行写入的 TD-21 立项段已就地改写为落地结论，未重复登记）
6. ✅ `git diff --stat HEAD -- src/engine-core` 为空；`src/migration/` 零改动
7. ✅ 提交分组核对：本单文件与并行进程产物分开（主控 phase3 文档与 5 份归档 relay、TD-20 遗留的 3 份索引改动不纳入本单 stage）
8. ✅ 给一行 commit message 草稿（**未自动 commit / push**）

**链接可达性复核**：交付记录 / 归档任务单 / wp-list / phase2.5-README / 台账共 **143** 个相对链接目标全部实测存在（ALL_OK 143）。

---

## 四、遗留

- **另案沿用**：C2 / G（下一批候选 counselor 其余子族：枢纽仓 `TrainingSession` / 关系仓 `LongTermCase*` / ability / training-exercise / visitor-pool / supervision / practice-* → home 微干预一族 + companion / overview 切片 → inner_world → ai-engine）、I（端口内存实现）、J（混合形态 import 统一）、K（CLI entities glob 口径脱节）、M（barrel entity 值导出边）、N（静态守护 spec）、P（consent 失败容忍语义，与本域无关）
- **新观察**：`src/counselor/entities/user-quote-favorite.entity.ts` 头部注释写「created_at / deleted_at (软删)」，但类内**实际无 `deletedAt` 列**（该表按 entity 理由走硬删）—— 注释与实现脱节；entity 一字不改红线内不改，注释修正另案登记
- **沿用观察**：`isTerminalPhase` 全仓 0 调用方死代码；根目录 e2e 遗留 spec 未被任何 vitest config 收集；home `logMood` 全仓 0 调用方与日期本地时区口径
- **Actions 侧**：CI 结果待主控 push 后在 Actions 复核（本机闸门已全绿）
- **偏差**（已登记交付记录 §八）：D-1 `findAnchorById` 与 `findById` 按锚点保留两个方法（语义不同，不合并）；D-2 两处可见性 QB 收敛为一个私有构造（谓词全仓唯一一处）；D-3 私有 `findVisibleQuotes` 随 QB 下沉一并移除；D-4 `assertQuoteExists` / `toDto` 类型签名换窄 Row；D-5 `loadFavoritedIds` 改为端口返 id 数组、Set 聚合留 service；D-6 任务单「受检面共 5 个」为**计数错配**（实测 4 个）；D-7 任务单「既有 spec 16 个」为**计数错配**（实测 18 个文件 / 266 例）；D-8 `deletedAt` 是**列级**软删标记（字段名同 TD-18 diary、机制不同），口径不得混写

---

## 五、commit message 草稿（未提交，等指令）

```
feat(counselor): TD-21 C2 第五批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec
```

建议拆 2 个 commit：

1. `feat(counselor): TD-21 C2 第五批仓储端口化 —— 双端口 + TypeORM 实现 + 端口替身 spec`
2. `docs(worklog): TD-21 交付记录 + 索引回写（P-DEBT-11 / L-1 · C2 第五批）`

_回执时间：2026-11-15 GMT+8 · 基线 HEAD `2b03756` · 未自动提交_

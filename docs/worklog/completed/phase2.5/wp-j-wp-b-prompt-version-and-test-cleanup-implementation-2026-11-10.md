# WP-J · WP-B prompt_version 落库 + 4 个既有测试失败修复 — 交付记录

> 日期：2026-11-10
> 执行方：MiniMax Code（后端仓库 `mofang-nestjs`，分支 `integrate`，基线 HEAD `3e9646f`）
> 前序：[`wp-j-p1d-route1-wiring-fixes-implementation-2026-11-10.md`](./wp-j-p1d-route1-wiring-fixes-implementation-2026-11-10.md)
> 验收/重跑方案：`docs/worklog/pending/phase2.5-p1d-acceptance-and-rerun-plan-2026-11-10.md`

---

## 一、一句话结论

**任务一**：WP-B 剩下的 `prompt_version` 已落库（场次表 + 批次表 + 批次详情 API + 逐字稿索引），算法 = **关键 prompt 模板文件的 sha256 前 16 位**，选型理由写进了代码注释。

**任务二**：4 个既有失败**全部修完**，全量 vitest 从 **4 failed → 0 failed**。其中 3 个是同一个根因（`POST /admin/api/characters` 引入后，路由清单 gold 与"全是 GET"的一刀切断言过期），1 个是**测试夹具**依赖了一个已经失效的前提（保留上限 50→500 后时间戳开始循环）。**没有一个是生产逻辑 bug** —— 详见 §四。

闸门：`tsc` 0 错 · `npm run lint` 0 错（修掉 1 个既有错）· `npx vitest run` **0 failed** · `git diff --stat HEAD -- src/engine-core` **空**。

---

## 二、任务一 · WP-B `prompt_version` 落库

### 2.1 根因 / 为什么要这个字段

`ap_practice_sessions` / `ap_practice_batches` 只记了 `engine_version`（= `git describe --always --dirty`），它答的是"**哪份代码**跑的"，答不了"**prompt 文案**变没变"。三个具体缺口：

| 缺口 | 场景 | engine_version 的表现 |
|---|---|---|
| ① 工作区改了还没 commit | "改完 prompt 先跑一批看效果"（P1d 就是这个流程） | git sha **不变** → 只带 `-dirty` 标记，**看不出 prompt 变了** |
| ② 改了无关文件 | 加一行日志、改个逻辑 | git sha **也变** → 批次对比时误判成"prompt 变了" |
| ③ 生产环境 | 服务器**不保留源码 / node_modules / git**（`docs/runbooks/docker-deploy.md`） | git sha 恒为 `unknown` → 等于没做 |

### 2.2 算法（为什么选文件 sha256，不是 git sha）

**`prompt_version` = 关键 prompt 模板文件内容的 sha256，取前 16 位 hex。**

```ts
// src/auto-practice/prompt-fingerprint.ts
export const PROMPT_TEMPLATE_FILES: readonly string[] = [
  '../engine-adapters/rendering/turn-render-orchestrator',   // 访客者 system prompt
  '../engine-adapters/deliberation/deliberation-prompt',      // 审议 prompt
  'counselor-agent.service',                                 // 咨询师 prompt 的代码部分
];
```

选型理由（同样写进了源码注释）：

| 候选 | 为什么不用 |
|---|---|
| **git sha** | ① 未提交的改动体现不出来（而 prompt 文案恰恰经常先改后跑）；② 无关提交会让"prompt 没变但版本变了"；③ 生产无 `.git` → 恒 `unknown` |
| **文案语义哈希**（把文案抽成常量再 hash） | 更精确（只有文案变了才变），但要动渲染层把散落的内联文案抽成常量 —— 改动面大，且将来新增文案**忘了登记**就静默漏报 |
| **文件内容 sha256** ✅ | **绝不漏报**（prompt 文案就在这些文件里 → 文件变 → 指纹必变）；不需要文件系统之外的任何东西；实现简单 |

**已知取舍（诚实写明）**：

- 同一文件里的**非文案**改动（加日志 / 改逻辑）也会改变指纹 —— 这是**保守方向**：宁可多报"变了"，不可漏报"没变"；
- 指纹按**当前进程实际加载的那份代码**计算：扩展名由本模块自己的 `import.meta.url` 推导 —— `nest start` 直跑 `.ts` → 算 `.ts`；`node dist/app.js` → 算 `.js`。**两种口径互不可比**（同一份文案的 `.ts` 与 `.js` 字节不同），批次对比请统一用 dist 口径（仓库的部署方式与本地验证方式都是 dist）；
- 路径也进哈希（两个文件内容互换 → 值不同），避免"换名不换内容"撞值；
- **fail-closed**：任何一个模板文件读不到 → 整个指纹返回 `unknown`，**不返回"只算了一半"的值**（半个指纹比没有指纹更坏 —— 它看起来像个正常版本号）；
- env `PROMPT_VERSION` 可显式覆盖（与 `ENGINE_VERSION` 同款优先级：env → 自动计算 → `unknown`）；
- 每进程只算一次（缓存），理由同 `gitDescribeDirty`。

**覆盖边界（写进注释，避免误以为覆盖了全部 prompt）**：

| 覆盖 | 不覆盖（是**数据**，不是代码模板） |
|---|---|
| 访客者 system prompt（渲染层；P1d 改的 `INFO_INCREMENT_INSTRUCTION` / `ATTACHMENT_BEHAVIOR_INSTRUCTION` 就在这个文件里）、审议 prompt、咨询师 prompt 的代码部分（输出纪律 / 收尾纪律 / 危机协议） | 咨询师模式人设（`counselor_modes.system_prompt`，在 DB 里）、角色 5Ps / 核心信念 / `verbal_voice`（由 `character_version` 覆盖） |

### 2.3 落库链路（改了哪些文件）

```
A src/auto-practice/prompt-fingerprint.ts                       # 指纹模块 (纯函数 + 读文件)
A src/migration/1714900000043-AddPromptVersionColumns.ts       # migration
A test/auto-practice/prompt-version.spec.ts                    # 13 例单测

M src/auto-practice/inference-fingerprint.service.ts            # InferenceFingerprint.promptVersion + 缓存 + env 覆盖
M src/auto-practice/entities/practice-session.entity.ts        # prompt_version 列
M src/auto-practice/entities/practice-batch.entity.ts          # prompt_version 列
M src/auto-practice/practice-runner.service.ts                 # 建场时落 prompt_version
M src/auto-practice/practice-batch-health.service.ts           # 批次行 + 逐字稿索引带 prompt_version
M src/auto-practice/auto-practice.controller.ts                # 批次详情 API 批次级 + 逐场带两个版本号
M src/migration/index.ts                                       # migration 导出 (跟 ormconfig 严格 1:1)
M bin/ormconfig.ts                                             # migration 真注册点 (import + migrations[])
M .env.example                                                 # PROMPT_VERSION 键登记 (WP25 双向守卫要求)
```

**migration**：`src/migration/1714900000043-AddPromptVersionColumns.ts`

```sql
ALTER TABLE ap_practice_sessions ADD COLUMN prompt_version VARCHAR(64) NULL AFTER engine_version;
ALTER TABLE ap_practice_batches  ADD COLUMN prompt_version VARCHAR(64) NULL AFTER engine_version;
```

- **幂等**：先查 `INFORMATION_SCHEMA.COLUMNS`，缺才加；`AFTER` 锚点缺失时退回表尾；
- **历史行不回填**：老场次跑的时候压根没算过指纹 —— 回填就是编数据。保持 `NULL` = "不知道"，不是"和现在一样"；
- **注册点两处都补**：`bin/ormconfig.ts`（import + `migrations[]` 数组 —— AGENTS.md 强调的真注册点）+ `src/migration/index.ts`；
- `down` 干净删两列，可回滚。

### 2.4 验证

**单测（13 例全绿）** `test/auto-practice/prompt-version.spec.ts`：

| # | 用例 |
|---|---|
| ① | 同一份内容 → 同一个指纹（稳定性） |
| ② | 格式 = 16 位 hex |
| ③ | **内容改一个字 → 指纹变**（这个字段存在的全部理由） |
| ④ | 路径也进哈希：两个文件内容互换 → 指纹变 |
| ⑤ | 真实仓库里算得出（清单里的文件路径全对，不是 `unknown`） |
| ⑥ | 文件读不到 → fail-closed 返回 `unknown` |
| ⑦ | 清单为空 → `unknown`（不是空串指纹） |
| ⑧ | 改了模板文件 → 指纹变（读文件 → hash 端到端） |
| ⑨-⑪ | env 覆盖三级优先级（env → 计算值 → unknown） |
| ⑫ | 模板清单非空（清空了指纹就成了常量） |
| ⑬ | **指纹服务把 `promptVersion` 放进 `InferenceFingerprint`**（落库链路的前提） |

**实测（3100 临时实例 + DB 实查）**：

| 口径 | 指纹 |
|---|---|
| 源码态（`nest start` / tsx 直跑 `.ts`） | `68a20ac6eb039c03` |
| 产物态（`node dist/app.js`） | `33bb150fa6a54fc7` |

两者不同 = 上面写的"两种口径互不可比"，符合预期。

DB 实查（3100 实例跑 1 场 anxious、maxTurns=2，批次 `XhkRkyS0NFJp-4EXDQZVx`）：

```
ap_practice_sessions: id=5VwgDcXsPoq1dzAWSL4PY  engine_version=3e9646f-dirty  prompt_version=33bb150fa6a54fc7
ap_practice_batches : batch_id=XhkRkyS0NFJp-4EXDQZVx  engine_version=3e9646f-dirty  prompt_version=33bb150fa6a54fc7
老场次/老批次:                                        prompt_version = null   ← 不伪造历史
```

`GET /admin/api/auto-practice/batches/:id` 实测返回：批次级 `engineVersion=3e9646f-dirty` / `promptVersion=33bb150fa6a54fc7`，逐场同样带这两个字段。

**migration 实跑**：

```
AddPromptVersionColumns1714900000043 has been executed successfully.
ALTER TABLE ap_practice_sessions ADD COLUMN prompt_version VARCHAR(64) NULL AFTER engine_version;
ALTER TABLE ap_practice_batches ADD COLUMN prompt_version VARCHAR(64) NULL AFTER engine_version;
```

INFORMATION_SCHEMA 实查确认两列都在（`varchar(64)` / `IS_NULLABLE=YES`）。

---

## 三、任务二 · 4 个既有测试失败：根因与修法

### 3.1 三个守卫用例（同一根因）

**根因不是"`characters` 路由重复注册"** —— 全仓只有一处 `@Get('characters')`（`admin-debug.controller.ts:258`）。真相是：

| 项 | 事实 |
|---|---|
| Phase2.5 做了什么 | 加了 `POST /admin/api/characters`（`admin-debug.controller.ts:303`，新建角色基线，供快速扩充角色池） |
| 于是控制器有 | **13 条**路由（12 GET + 1 POST），其中 `characters` 这个**路径**出现两次（GET 列表 / POST 新建） |
| wp26 的断言 | 路由清单是**逐字 gold**（11 条、全 GET）+ `"全部端点都必须是 GET"` |
| 实际收到 | 12 条 → `expected [ 'characters', 'characters', …(10) ] to deeply equal [ 'characters', …(10) ]` |
| wp30 / wp31 的断言 | 同一个循环里 `expect(route.method).toBe(RequestMethod.GET)` 对**全部**端点生效 → `expected 1 to be +0`（1 = POST） |

**修法（不放松断言，把不变量改得更精确）**：

```diff
  // wp26
- expect(routes.map((route) => route.path).sort()).toEqual([...11 条 GET...]);
+ expect(routes.map((route) => `${RequestMethod[route.method]} ${route.path}`).sort()).toEqual([
+   'GET characters', 'GET characters/:slug', 'GET characters/:slug/sessions',
+   'GET cost/sessions', 'GET cost/trend', 'GET deliberation/stats', 'GET health',
+   'GET sessions', 'GET sessions/:id', 'GET sessions/:id/memories', 'GET sessions/:id/trajectory',
+   'POST characters',
+ ]);
  for (const route of routes) {
-   expect(route.method).toBe(RequestMethod.GET);
    expect(route.guards).toContain(AdminRoleGuard);
  }
+ // method 断言: **写端点有且只有一个**, 其余全是只读.
+ const writeRoutes = routes.filter((route) => route.method !== RequestMethod.GET);
+ expect(writeRoutes.map((route) => `${RequestMethod[route.method]} ${route.path}`).sort()).toEqual(['POST characters']);
```

wp30 / wp31 同样处理（守卫断言仍对**所有**端点生效；method 只管读端点；写端点单独钉住）。

**为什么这不是"放宽断言"**：

- 守卫覆盖（测试的真正目的）**一点没松** —— 仍然逐个端点断言 `guards` 含 `AdminRoleGuard`；
- method 断言从"**全部**都是 GET"变成"**写端点有且只有一个，且是 POST characters**" —— 将来再加第二个写端点会红（原来那版"全是 GET"同样会红，但含义含糊）；
- 路由清单改成 `"METHOD path"` 后，**同路径不同 method 才分得开**（老写法 `path` 看着像重复注册，就是这个原因）。

### 3.2 `debug-session-persistence` ②（夹具前提失效，不是生产 bug）

**根因链**：

```
commit 1cd56ee (2026-11-09)「chore(auto-practice): 上调调试会话与队列的保留量」
  MAX_DEBUG_SESSIONS  50 → 500
  理由（提交说明原文）: "批量实验期间两处保留上限都不够用，会直接吃掉对比基线",
                   "自动对练单批 300+ 场，跑一半就把最老的逐字稿顶掉了"
```

上限改了，**测试夹具没跟着改**：

```ts
// 旧夹具 (2026-11-05 写)
createdAt: `2026-11-05T12:${String(i % 60).padStart(2, '0')}:00.000Z`
```

`i % 60` 只保证**前 60 场**时间戳互不相同。上限抬到 500 后，本用例要建 **503** 个会话 → 时间戳开始**每 60 场循环一次** → 大量**同秒并列** → `prune()` 按 `createdAt` 降序切尾部时，"最旧的 3 个具体是哪几个"变得**不确定**（并列项的先后取决于 `readdir` 顺序）→ `expect(files).not.toContain('debug_000.json')` 随机红。

**生产逻辑是对的**：

```ts
// debug-session-store.ts prune()
const stale = dated.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(MAX_DEBUG_SESSIONS);
// 保留 createdAt 最新的 MAX 个 —— 语义正确, 与"保留最近 N 个"一致.
```

**修法**：夹具改成**严格递增**的时间戳（每场 +1 秒），让淘汰名单唯一确定；同时把 describe 标题参数化、把源码里"为什么是 50"的过期注释补成 500 并写上 `1cd56ee` 的理由。

```diff
- await store.create(buildRecord(`debug_${i}`, { createdAt: `2026-11-05T12:${String(i % 60).padStart(2, '0')}:00.000Z` }));
+ const base = Date.parse('2026-11-05T12:00:00.000Z');
+ await store.create(buildRecord(`debug_${i}`, { createdAt: new Date(base + i * 1000).toISOString() }));
```

### 3.3 我这次改动自己引出的 2 个新失败（已一并修掉）

| # | 用例 | 根因 | 修法 |
|---|---|---|---|
| 5 | `wp25-env-example-coverage` ① | 新 env 键 `PROMPT_VERSION` 被代码读了但 `.env.example` 没登记（WP25 的双向守卫） | 在 `.env.example` 登记（带注释说明它答什么、什么时候该显式指定） |
| 6 | `wp-h-wave2-3-batch-observability` ④ | 逐字稿索引的**零内容护栏**用"查子串 `'prompt'`"实现，被我新加的字段名 `promptVersion` 撞了 | 护栏改成按**内容特征**判定（查渲染层 system 开头 / 咨询师输出纪律开头）+ 断言 `promptVersion` 确实进了索引 |

第 6 条说明一下为什么这不是"把护栏改松了"：原来的三个探针（`'text'` / `'reply'` / `'prompt'`）只能拦**英文驼峰字段名**，拦不住任何中文正文 —— 改成按内容特征判定后，**比原来更严**（真正在查 prompt 文本），同时不再被字段名误伤。

### 3.4 顺手修掉的一个既有 lint 错

`npm run lint` 在 HEAD 上就有 1 个错：`src/quality/quality-annotation.service.ts` 的 `import { join } from 'node:path'` 触发 `unicorn/import-style`（node: 内置模块没有 default export，规则误报）。P1d 修过这个文件的 import 顺序，把行号从 20 挪到了 19，所以现在才显出来。按仓库既有约定（`debug-session-store.ts` / `prompt-fingerprint.ts` 同款）补了一行 `eslint-disable-next-line` 豁免 + 说明。

---

## 四、闸门数字（前后对比）

| 闸门 | 修前 | 修后 |
|---|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | 0 错 | **0 错** |
| `npm run lint`（全仓 `src,test,bin`） | **1 错**（既有：`node:path` import 风格） | **0 错** |
| `npx vitest run`（文件） | 4 failed / 163 passed / 5 skipped（172） | **168 passed / 5 skipped（173）** |
| `npx vitest run`（用例） | 4 failed / 2706 passed / 19 skipped（2729） | **2723 passed / 19 skipped（2742）** |
| `git diff --stat HEAD -- src/engine-core` | 空 | **空**（红线未碰） |

**逐条核对被修的 4 个失败**：`wp26` / `wp30` / `wp31` / `debug-session-persistence` 四个 spec 单独跑 = **4 files / 76 tests passed**。

---

## 五、纪律与现场

| 项 | 状态 |
|---|---|
| `src/engine-core/**` | ✅ **零改动**（`git diff --stat HEAD -- src/engine-core` 空） |
| `quality_annotation` 表 | ✅ **未碰**（本次只动 `ap_practice_sessions` / `ap_practice_batches`，且只加两列不改存量行） |
| 3000 端口 | ✅ **全程未动**（实测期间该端口无监听；本次只用 3100 临时实例，已关：`listeners_3100 = 0`） |
| 3100 临时实例 | ✅ **已关闭**（PID 30556 已终止） |
| 逐字稿 | 本次新跑 1 份已归档到 `data/archives/debug-sessions-verify-prompt-version-2026-11-10/`；`data/debug-sessions/` 保持 **57 份基线** |
| 临时文件 | 本单产物全部删除（`bin/tmp-prompt-version-*.ts` / `.tmp-pv-*` / `.tmp-vitest-*` / `.pending-tmp.txt`）；仓库根残留的 `.tmp-annotations.json`（0 字节）**不是本单产物** —— 是豆包同伴进程读 `quality_annotation` 时占着的锁文件，被另一个进程占用，故不删除、也不触碰 |
| migration | **已对真库执行**（`mofang_dev`），两列已建 |
| git | **未 commit / 未 push** |

---

## 六、遗留问题（本期**没修**的）

| # | 严重度 | 问题 | 建议修法 |
|---|---|---|---|
| **L1** | P2 | **`prune()` 是平方级 IO**：每次 `create()` 都 `readdir` + **逐个 readFile + JSON.parse** 全部会话文件（上限 500 → 一次建档 500 次文件读；建 503 场 = 约 12 万次读）。这是 `debug-session-persistence` 单跑要 25~31 秒的原因，批量实验期单批 300+ 场也是同样的代价 | ① 用文件 `mtime` 排序代替读文件取 `createdAt`（`stat` 比 read+parse 便宜一个量级）；② 或在 store 内维护一份 `id → createdAt` 内存索引（进程内已有一份会话目录）；③ 或按 `ADMIN_DEBUG_SESSION_DIR` 分目录隔离，绕开单目录上限（`1cd56ee` 的提交说明里已点名这条）。**本期只上报，未改** —— 改淘汰口径会影响"哪些逐字稿被删"，属于数据留存策略，得大炮拍板 |
| **L2** | P2 | **`prompt_version` 的两种口径不可比**（源码态 `68a20ac6…` vs 产物态 `33bb150f…`） | 批次对比统一用 dist 口径（仓库部署与本地验证都是 dist）；若要彻底消除，需改成"文案语义哈希"（把渲染层文案集中抽成常量再 hash）—— 那是渲染层重构，本期不做 |
| **L3** | P2 | **DB 里的 prompt 数据不在指纹内**（`counselor_modes.system_prompt`、角色 5Ps / `verbal_voice`） | 咨询师人设变了要靠内容比对；角色内容由 `character_version` 覆盖。若要更严，可给 `counselor_modes` 也加一个内容哈希列 |
| **L4** | P3 | `admin-debug` 命名空间**不再是纯只读**（Phase2.5 引入 `POST characters`） | 守卫覆盖没漏（class 级 guard + basic auth 双保险），但命名空间的可写面值得在文档里写明 |
| **L5** | — | WP-B 的另一半：**考核场景纯规则待核实**（backlog §出口条件② 里仍标着"待核实"） | 本期只做 prompt_version 落库，考核隔离没动 |

---

## 七、改动文件清单（全量）

```
A src/auto-practice/prompt-fingerprint.ts
A src/migration/1714900000043-AddPromptVersionColumns.ts
A test/auto-practice/prompt-version.spec.ts

M src/auto-practice/inference-fingerprint.service.ts
M src/auto-practice/entities/practice-session.entity.ts
M src/auto-practice/entities/practice-batch.entity.ts
M src/auto-practice/practice-runner.service.ts
M src/auto-practice/practice-batch-health.service.ts
M src/auto-practice/auto-practice.controller.ts
M src/admin-debug/debug-session-store.ts            # 只改过期注释 ("为什么是 50" → 500 + 1cd56ee 的理由)
M src/quality/quality-annotation.service.ts         # 只加 node:path 的 lint 豁免注释 (既有错)
M src/migration/index.ts                            # migration 导出
M bin/ormconfig.ts                                  # migration 真注册点
M .env.example                                      # PROMPT_VERSION 键
M test/admin-debug/wp26-admin-role-guard.spec.ts
M test/admin-debug/wp30-admin-real-api.spec.ts
M test/admin-debug/wp31-cost-board.spec.ts
M test/admin-debug/debug-session-persistence.spec.ts
M test/auto-practice/wp-h-wave2-3-batch-observability.spec.ts   # 索引零内容护栏改判据 + 断言新字段

(P1d 的改动仍在工作区未提交, 与本单一起提交)
```

---

## 八、commit message

```
feat(wp-j-wp-b): prompt_version 落库 (模板文件 sha256 前 16 位) + 修 4 个既有测试失败 (全量 vitest 0 failed)
```

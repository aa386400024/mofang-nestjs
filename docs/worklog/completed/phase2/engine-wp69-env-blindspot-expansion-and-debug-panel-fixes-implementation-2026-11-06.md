# WP69 · env 盲区扩面 + consent 路径修复 + 调试面板小改进 · 交付记录

> 日期：2026-11-06
> 任务单：[`wp69-env-blindspot-expansion-and-debug-panel-fixes-2026-11-06.md`](./wp69-env-blindspot-expansion-and-debug-panel-fixes-2026-11-06.md)
> 范围：14 个 env 盲区键扩面 · consent 路径错误 bug · 调试面板 `active` 字段 · 调试 trace `eventTags`
> 边界：engine-core 零改动（§2.5 的内核加出口方案需大炮批准例外）

---

## 一、一句话

WP48 挖出的 16 个「配了不生效」的 env 键，本单处理掉 **13 个**（6 个挪进预留区 + 7 个死遗产直接删），
另 1 个（`CONSENT_CURRENT_VERSION`）用**修路径**的方式治本 —— 修完它就真的有人消费了，不再是盲区；
顺手修掉一个「配了不生效」的**线上 bug**（consent 读错配置路径）；调试面板加 `active` 字段（刷新后能分清
「可继续聊」与「只读历史」）。

**engine-core 零改动**（`git diff --stat HEAD -- src/engine-core` 为空）。

**§2.5（trace 接引擎事件标签）本单不做** —— 取真值必须动内核（破红线，须大炮批准），已登记后续单（§九）。

---

## 二、做了什么

### 2.1 env 盲区扩面：6 个键挪进预留区

| env 键 | config 路径 | 为什么没人消费 |
|---|---|---|
| `SMS_ACCESS_KEY` | `sms.accessKey` | 短信服务只读 `enabled` / `provider`（`shared/infra/sms/sms.service.ts`），凭据要等接阿里云/腾讯云 SDK 才用得上 |
| `SMS_ACCESS_SECRET` | `sms.accessSecret` | 同上 |
| `SMS_SIGN_NAME` | `sms.signName` | 同上 |
| `SMS_TEMPLATE_CODE` | `sms.templateCode` | 同上 —— ⚠️ `sms.service.ts` 里那个 `templateCode` 是 `send()` 的**入参**，不是这个配置字段，名字撞了而已 |
| `SMS_REGION` | `sms.region` | 同上 |
| `METRICS_PATH` | `metrics.path` | `/metrics` 的路由是**硬编码**的（`metrics.controller.ts` 上 `@Controller()` + `@Get('metrics')`），配 env 不生效 |

**做法**：`default.ts` 里给这 6 个字段加 `// @unused-read` 标记（格式与 WP48 一致），
`.env.example` 里从**生效区**挪进**底部预留区**（值原样保留，将来接线照旧）。

> **WP48 的用例⑤ 自动覆盖了这 6 个键** —— 断言 A（标记 → 必须在预留区）与断言 C（预留区 → 必须有标记）
> 双向逼着两处同步，守卫**一行没改**（只加了一个性能缓存，见 §三 B3）。

### 2.2 EMBEDDING_* 7 个死遗产键直接删

`default.ts` 整个 `embedding` 命名空间（7 个字段）删除，`.env.example` 对应 7 行删除。

**为什么删而不是挪预留区**：这 7 个键服务的是 **bge 自托管 / chatanywhere** 老方案，而 2026-10-14 大炮已拍板
「B 方案 —— 删 bge 自托管 TEI 容器，改走 OpenAI 兼容 embedding（4 provider 之一）」（见
`src/ai-engine/ai-engine.module.ts` 文件头）。RAG 已改走 LLM provider pool，这 7 个键**零消费点**
（`grep` 全仓确认），留着只会让运维以为要自建 bge —— 连 `http://bge-embedding.internal:8080`
这种已下线架构的内网地址都还在模板里。

**向量化口径现在只有一个**：`LLM_DEFAULT_EMBEDDING_PROVIDER` + `LLM_<PROVIDER>_API_KEY`。

### 2.3 consent 路径错误 bug 修复（线上 bug）

`src/consent/providers/consent.service.ts:41` 原来读的是**平铺键**：

``ts
this.currentVersion = this.config.get<string>('consentCurrentVersion') ?? 'v1.0';
`@

但 `default.ts` 里这个字段在 `config.consent` **命名空间**下（`consent.currentVersion`）——
**没有**平铺的 `consentCurrentVersion`。于是读出来恒为 `undefined` → 永远回落 `v1.0` →
**配 `CONSENT_CURRENT_VERSION=v2.0` 永远不生效**（服务端不强制客户端重弹同意 dialog）。

改后（两个 service 同一口径）：

``ts
this.currentVersion = this.config.get<{ currentVersion?: string }>('consent')?.currentVersion ?? 'v1.0';
`@

- `src/consent/providers/consent.service.ts`（心塑/魔方共用同意记录）
- `src/profile/providers/consent.service.ts`（陪伴者知情同意书）—— 原先**硬编码** `'v1.0'`，
  注释写着「V3 走 config.consentCurrentVersion」，实际从没走过；现在注入 `ConfigService` 真读 config。

> **副作用（有意）**：配 `v2.0` 后陪伴者知情同意书版本会跟着升 → 客户端按 `documentVersion` 校验
> 时会要求**重签**。这正是 V3 的设计意图（注释里写明的「提示重签」），但正文 6 章节仍是 V2.0 静态文案 ——
> 将来改文案要同步升版本号。

### 2.4 调试面板改进 1：会话列表加 `active: boolean`

`GET /admin/api/debug/sessions` 每行多带一个 `active`：**这场会话在当前进程的内存里还有运行时状态**
（内核句柄活着）→ 可以继续发消息。

⚠️ **`active` 与落盘字段 `status` 不是一回事**（这点很容易踩）：

| 字段 | 含义 | 进程重启后 |
|---|---|---|
| `status` | 落盘时这场会话**被显式关过没有**（`active` / `completed`） | 仍是 `'active'`（文件里写着） |
| `active` | **当前进程**内存里还有没有它的内核句柄 | **`false`**（句柄没了） |

所以前端判「能不能继续聊」**只能看 `active`**，不能看 `status` —— 否则刷新页面后，
一场已经死掉的会话会被当成活的（点了发消息报「调试会话不存在」），而一场还活着的会话反而被当成只读。

实现：`DebugSessionService.listPersistedSessions()` 把落盘摘要投影成 `DebugSessionListItem`
（新增导出类型，`extends DebugSessionSummary` + `active`），落盘存储层（`DebugSessionStore`）**零改动**
—— 它不关心运行时状态。

### 2.5 调试面板改进 2：trace 加 `eventTags: string[]` —— **本单不做（方案 C）**

> **状态**：❌ **本单不做**（方案 C，见 §六 / §九）。任务单 §2.5 的目标（引擎这一轮输出的事件标签）
> 在「engine-core 零改动」前提下**取不到真值**，原因如下：

引擎把事件分类锁在 `InMemoryEngineSession.turn()` 内部：

1. `EngineTurnOutput`（内核出参）**不带**事件字段 —— 只有 reply / snapshot / turnIndex / intention /
   openingContext / trajectoryTrace / safety；
2. 唯一的事件出口是 `TurnDeltaCapReport.events`，但 `buildDeltaCapReport` 在**没被砍幅时返回 null**
   → 观察者根本不触发；
3. 端口 `EngineSessionPort` 只有 open / turn / close 三个方法，没有观测口。

**适配层自己预判也不行**：内核 DTO 白纸黑字写着「事件分类……由内核从文本内部推导，**不由 adapter 预判** ——
否则'事件分类'这套语义会泄漏到传输层」（`domain/engine-session.types.ts`）。

⇒ 三个方案（A 内核加只读出口 / B 适配层深路径 import 规则分类器 / C 本单不做）已提交大炮拍板。
**本单按方案 C 收口**（不擅自破「engine-core 零改动」红线），**已登记后续单**（§九）——
§2.5 是本单**唯一没做**的条目，其余四项全部完成并通过闸门。

---

## 三、偏差表

| # | 任务单写的 | 实际做的 | 理由 |
|---|---|---|---|
| B1 | §2.1 表：`CONSENT_CURRENT_VERSION` 「加 @unused-read 标记 + 挪进预留区」 | **不标记、不挪**，留在生效区 | §2.1 与 §2.3 **自相矛盾**：§2.3 把路径修好后，这个键**真的有人消费**了 → 它不再是盲区。真按 §2.1 做，守卫断言 B（标记的键必须无人消费）会**当场变红**；而把它挪进预留区等于告诉运维「配了不生效」—— 与修好的事实相反。**按修路径治本**（偏差 = 少挪一个键，多修一个 bug） |
| B2 | §2.3 给的代码 `this.config.get<string>('consent').currentVersion ?? 'v1.0'` | `this.config.get<{ currentVersion?: string }>('consent')?.currentVersion ?? 'v1.0'` | 任务单那行**编译不过**：`get<string>('consent')` 的类型是 `string`，再取 `.currentVersion` 是 TS 报错；且 `get` 不带 `infer` 时返回非空类型，没有 `?` 的话 `.currentVersion` 在类型上恒存在。按仓库既有写法（`config.get('sms')` 再取字段）取命名空间对象 |
| B3 | §2.1 步骤 4：「守卫不用改」 | 守卫**加了文件级缓存**（语义零变化） | 标记从 2 个扩到 8 个后，`findConfigConsumptions` 是「每个待查字段扫一遍全 `src/`」的形状 → 重复解析 8 遍 ≈ 36s > vitest 默认 30s 超时，守卫**直接红**。加 `Map` 缓存后每个文件只解析一次 → **7.2s**（比 WP48 时的 21s 还快）。**只加缓存，不动任何断言** |
| B4 | §2.3：`profile/providers/consent.service.ts` 「跟着一起读 config」 | 同上，并补了「为什么改」的注释 | 该 service 原注释写着「V3 走 config.consentCurrentVersion」—— 路径本身也是错的（平铺键），一并修正注释 |
| B5 | §3.3 验收：「前端事件分类 tab 显示中文标签」 | 后端**不碰前端** | AGENTS.md 硬约束「不写前端代码（不碰 admin-dashboard/）」。后端交付数据 + 契约，前端接线归前端 AI（登记见 §七） |
| B6 | §2.5「trace 加 `eventTags`」 | **本单不做**（方案 C），登记后续单（§九） | 见 §2.5 + §六 —— 取真值必须动内核（`EngineTurnOutput` 加只读出口），那是破「engine-core 零改动」红线、须大炮批准；本单不擅自破线，改为登记后续单 |
| B7 | 母版统计表：P1 标「20 条」但列了 21 个编号；合计 41 条 | 本单加 WP69 后：P1 **21 条**（校正原错标）、P2 **13 条**、合计 **42 条**（WP27–WP69） | WP69 是**母版之外新增的编号 WP**，登记进去才不算「交付了但母版里没有」。加完之后三档计数与实际编号列表**首次自洽**（8+21+13=42）—— 原表的 20/13 与实际列表对不上是既有笔误，顺手校正 |

---

## 四、闸门数字（本单实跑）

| 闸门 | 命令 | 结果 |
|---|---|---|
| lint | `npx eslint "{src,test,bin}/**/*.ts"` | **0 error** ✅ |
| 类型 | `npx tsc -p tsconfig.build.json --noEmit` | **0 error** ✅ |
| env 守卫 | `npx vitest run test/config/wp25-env-example-coverage.spec.ts` | **10 例全绿**（用例⑤ 自动覆盖新 6 键）✅ |
| WP69 新增 | `npx vitest run test/config/wp69-env-blindspot-expansion.spec.ts test/admin-debug/wp69-debug-panel-improvements.spec.ts` | **15 例全绿** ✅ |
| 全量单测 | `npx vitest run --exclude '**/e2e/**/*.ts'` | **116 文件 / 1971 例全绿** ✅ |
| **engine-core 红线** | `git diff --stat HEAD -- src/engine-core` | **空** ✅ |

---

## 五、验收逐条

### 5.1 env 盲区扩面
- [x] SMS_* 5 个键 + METRICS_PATH 都有 `@unused-read` 标记（default.ts 共 8 个标记）
- [x] 这些键都在 `.env.example` 预留区里（生效区已无，生效区只留 `SMS_ENABLED` / `SMS_PROVIDER`）
- [x] EMBEDDING_* 7 个键全删（default.ts + `.env.example`；残留只在注释里，且注释在解释「为什么删」）
- [x] `npx vitest run test/config/wp25-env-example-coverage.spec.ts` 全绿

### 5.2 consent 路径修复
- [x] `consent.service.ts:41` 改成读 `consent` 命名空间下的 `currentVersion`
- [x] `profile/providers/consent.service.ts` 跟着改（注入 ConfigService，不再硬编码）
- [x] 配 `CONSENT_CURRENT_VERSION=v2.0` 真的生效（单测 3 例钉死：v2.0 生效 / 旧平铺键无效 / 没配回落 v1.0）

### 5.3 调试面板改进
- [x] `list()` 接口每个会话有 `active: boolean`（4 例单测：内存有 → true、只在文件 → false、
      status='active' 但内存没有 → false、关掉会话 → false）
- [ ] trace 里有 `eventTags: string[]` —— ❌ **本单不做**（§2.5 / §六 / §九 后续单）
- [ ] 前端事件分类 tab 显示中文标签 —— ❌ 归前端 AI（§七；本单不碰 admin-dashboard）

### 5.4 闸门
- [x] `npx tsc -p tsconfig.build.json --noEmit` 0 错
- [x] `npx eslint "{src,test}/**/*.ts"` 0 error
- [x] 全量单测全绿
- [x] engine-core 零改动

---

## 六、`eventTags` 的取数口径（三方案 + 本单取舍）

**本单取舍 = 方案 C**（不破 engine-core 零改动红线）；**方案 A 仍是推荐口径**，留待后续单按大炮批准执行。

**问题**：调试面板要显示「这一轮咨询师说了什么 techniques」（共情回应 / 开放提问 / 评判…），
但引擎把事件分类锁在 `turn()` 内部，适配层**取不到真值**（三条路都被堵死，见 §2.5）。

| 方案 | 做法 | 代价 | 拿到的是 |
|---|---|---|---|
| **A** | 内核加只读出口：`EngineTurnOutput` 加 `events?: readonly CounselorEventKind[]`，内核自己填 | **破「engine-core 零改动」承诺**（2 个内核文件，纯加可选字段，不改任何决策与数值；`boundary.spec.ts` ⑥ 白名单不用动，因为 `CounselorEventKind` 已在白名单里） | **引擎真值**，口径唯一，未来督导/留痕都能复用 |
| **B** | engine-core 零改动：适配层深路径 import 规则分类器，注入记录型装饰器 | 违反「barrel 是唯一公开出口」纪律（内核 barrel 明确不导出规则实现）；分类器是进程级单例，多会话并发时事件归属要靠对齐，有错配风险 | 引擎真值（但耦合内核内部） |
| **C** | 本单不做 | 无 | 无 —— `eventTags` 留空数组 + 注释，与 WP58 已登记的缺口一致 |

**推荐 A**：事件分类是内核的**唯一真相**，适配层预判 = 双胞胎（内核 DTO 已明令禁止）。
B 换来的「零内核改动」是以破坏公开面纪律 + 并发错配风险换的，不划算。
**但本单不动内核** —— 动内核须大炮批准，故登记后续单（§九）。

---

## 七、归前端 AI 的接线（2 处，各 1 行）

> 本仓库 AGENTS.md 规定后端不碰 `admin-dashboard/`，以下两处**只登记不实施**。

1. **会话列表 `active`**：`admin-dashboard/src/views/debug/SessionList.vue` 的本地 `DebugSessionSummary`
   接口加 `active: boolean`，并在 `loadSessions()` 里把 `active === true` 的 id 塞进
   `DebugChat.vue` 的 `activeSessionIds`（那个集合已经在等这个字段了 ——
   `isReadOnly` 就靠它算）。→ 刷新页面后「可继续聊 / 只读历史」就分得对了。
2. **事件分类 tab**：前端 `eventTagMap` 只有 6 个键，其中 **3 个引擎根本不产**
   （`micro_expression` / `emotion_reflection` / `open_discussion`），
   而引擎真实的 11 类里它**缺了 7 个**（`acceptance` / `affirmation` / `judgment` /
   `preaching` / `minimizing` / `boundary_cross` / `sensitive_touch`）。
   等 §2.5 定稿后，按后端给的权威标签清单补齐。

---

## 八、给大炮的两条手工动作

1. **`admin-dashboard/` 那几个改动文件不是本单的**（`DebugChat.vue` / `SessionList.vue` /
   `CharacterDetail.vue` / `CharactersList.vue` / `SessionDetail.vue` / `SessionsList.vue`）——
   是前端 AI 并行做的接线，**提交时别带上**。
2. `CONSENT_CURRENT_VERSION` 的版本号一旦升到 v2.0，**陪伴者知情同意书正文仍是 V2.0 静态 6 章节**
   （本单只修版本号读取，没改正文）—— 要改文案时记得同步升版本号，否则会出现「版本升了但内容没变」的重签。

---

## 九、后续单（本单登记，未做）

### 后续单 D：调试 trace 接引擎事件标签（`eventTags`）

**为什么没在本单做**：引擎把事件分类锁在 `InMemoryEngineSession.turn()` 内部，适配层取不到真值
（三条堵死路径见 §2.5）；唯一干净的口径是**内核加一个只读出口**（方案 A）—— 那是破
「engine-core 零改动」红线，**须大炮批准**，本单不擅自破线。

**建议落法（方案 A；2 个内核文件 + 2 个适配层文件）**：

1. `src/engine-core/domain/engine-session.types.ts` —— `EngineTurnOutput` 加
   `events?: readonly CounselorEventKind[]`（**可选字段**，不改任何既有字段与决策）；
2. `src/engine-core/in-memory/in-memory-engine-session.ts` —— turn 里把已算出的
   `events.map((e) => e.kind)` 填进出参（内核自己分类 → 真值唯一）；
3. `src/engine-adapters/rendering/turn-render-orchestrator.ts` —— `TurnRenderResult` 透传该字段；
4. `src/admin-debug/debug-session.service.ts` —— 读进 trace 的 `eventTags`（并给中文标签映射）。

**边界**：`boundary.spec.ts` 断言⑥ 的公开面白名单**不用改**（`CounselorEventKind` / `SessionEvent`
已在白名单里）；内核**决策与数值逐字不变**（纯加观测字段）。

**顺带**：中文标签映射建议由**后端出一份权威表随 trace 下发** —— 前端那份 `eventTagMap` 缺 7 个
真实标签、多 3 个引擎根本不产的标签（见 §七），两份映射迟早漂。

### 后续单 E（暂不开）：env 守卫的「路径错误型」盲区检测

本单修掉的是 `CONSENT_CURRENT_VERSION` **这一处**路径错误（人工发现）。
守卫目前只能发现「读了没人消费」，**发现不了「消费点读错路径」**（WP48 §1.2.1 已登记）。
要做需要一份「config 字段 ↔ env 键」静态对照表 + 消费点路径校验 —— 成本高、易脆，
按任务单 §四.1「不做全自动路径比对守卫」，**暂不开单**；真有第二例再议。

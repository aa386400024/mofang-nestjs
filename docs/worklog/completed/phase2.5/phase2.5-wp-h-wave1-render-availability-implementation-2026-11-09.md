# Phase2.5 WP-H 第一波 · 渲染可用性修复 · 交付记录

> **任务单**：[`pending/wp-h-render-availability-fix-task.md`](../../pending/wp-h-render-availability-fix-task.md)（WP-H 共三波，本记录只覆盖**第一波：改动 1~4**）
> **交付日期**：2026-11-09
> **基线 commit**：`94d9982`（`docs(phase2.5): 补数据链路体检记录与 WP-H 任务单`；其上一条 `4063666` 是 WP-G 的提交）
> **红线复核**：`src/engine-core/` **零改动**（`git diff --stat HEAD -- src/engine-core` 输出为空，0 行）
> **范围**：4 项改动 · **19 个代码/配置文件**（16 改 + 3 新增，其中 2 个既有 spec 同步补类型）· 4 个文档（3 改 + 1 新增）

---

## 一、本单做了什么

**一句话：让 LLM 真的被调用。** 上一波三批自动对练（1034 场）里，1031 个有轮次场次中 926 场（89.8%）整场 `total_tokens = 0`、来访者 91.8% 的发言是渲染兜底池那 4 句 —— 根因不是"角色 prompt 话术太少"，而是**熔断一开就是全损 + 没有备份候选 + 冷却 5 分钟 + 重试策略不可控**。本波把这四处全部变成可断言的契约。

| # | 改动 | 落点文件 | 一句话 |
|---|---|---|---|
| 1 | 候选序列 ≥ 2 校验 | `src/engine-adapters/wiring/render-config.factory.ts` | 单候选 → **启动期告警**；`ENGINE_RENDER_REQUIRE_FAILOVER=true` → 装配期直接抛错 |
| 2 | 冷却 300s→60s + 半开探测 | `render-adapter.config.ts` / `render-failover.runtime.ts` / `llm-render.adapter.ts` | 冷却期内**放一次探测**，不再是全程兜底；冷却时长与半开间隔可观测 |
| 3 | 显式退避重试层 | **新增** `src/llm/common/llm-retry.ts` + `openai-compatible-chat.provider.ts` + `llm-router.service.ts` + `router-chat-caller.ts` | 关掉 LangChain 的隐式 6 次重试，自建"429/5xx/超时才退避、鉴权/参数错立即失败"的显式层；**超时即中止**，不再有幽灵重试 |
| 4 | 批量并发可配置 | `src/auto-practice/practice-queue.service.ts` | 缺省 3 → **2**，范围 1~5，越界夹取并告警 |

### 改动 2 的半开探测状态机

```
失败 ×N ──► 冷却 [0, 60s]（上限 60s, 基数 30s × 2^(N-1) 封顶）
              │
              ├─ t < 30s  ──► 无候选可用 → 直接降级兜底（计数 +1: cooldown_served）
              │
              └─ t ≥ 30s  ──► 放**一次**探测（probe_attempts +1）
                                 ├─ 成功 ──► markSuccess: 计数与冷却全部清零，完全恢复
                                 └─ 失败 ──► 冷却时长 ×2、半开间隔 ×2（均以 cooldownMaxMs 封顶）
```

### 新增 env 键（5 个，全部登记进 `.env.example`）

| 键 | 缺省 | 作用 |
|---|---|---|
| `ENGINE_RENDER_FALLBACK_PROVIDERS` | 空 | 渲染备候选 provider 列表（逗号分隔） |
| `ENGINE_RENDER_REQUIRE_FAILOVER` | `false` | true 时单候选直接启动失败 |
| `ENGINE_RENDER_HALF_OPEN_AFTER_MS` | `30000` | 冷却期内多久放一次探测 |
| `LLM_REQUEST_TIMEOUT_MS` | `60000` | OpenAI 兼容 chat provider 的**客户端**单次请求超时 |
| `LLM_MAX_RETRIES` | `2` | 显式退避层的最大重试次数（首次 + 2 次重试） |

---

## 二、关键设计决策与偏差说明

### 偏差 B1 · 改动 3 的文件路径在任务单里是错的（**最重要的一条**）

**任务单写的**：`MINIMAX_LLM_MAX_RETRIES=2`，"无退避，429 下等于放弃"，落在 `src/llm/`。

**实测**：

| 事实 | 证据 |
|---|---|
| `MINIMAX_LLM_MAX_RETRIES` **只被 `src/agent/llm/llm.service.ts` 消费**（旧 agent 语音链路） | `config/envs/default.ts:160` → `agent/llm/llm.service.ts:128` |
| **渲染链路根本不读它** | 渲染链路是 `LlmRouterService.chat` → `provider.chat` → LangChain `ChatOpenAI`，全程不碰这个 env |
| 渲染链路真实重试来自 **LangChain `AsyncCaller`：`maxRetries` 默认 6**（指数退避 + 抖动） | `@langchain/core@1.8.0` `utils/async_caller.cjs`：`this.maxRetries = params.maxRetries ?? 6` |
| OpenAI SDK 层被 LangChain **置 `maxRetries: 0`** | `@langchain/openai@1.8.0` `chat_models/base.cjs:324`：`maxRetries: 0` |
| LangChain 的重试**不看我们的截止时间** | 适配器 `withTimeout(30s)` 不取消底层请求（`llm-render.adapter.ts:1107` 原文写着"超时后不取消底层请求"） |

**结论**：任务单"无退避，429 下等于放弃"的定性**不成立**。真实问题反过来了 —— 重试**太多**（6 次）、**不可配**、**无单测**，而且**不看渲染截止时间**。

**实际做法**：在 `src/llm/common/base/openai-compatible-chat.provider.ts` 的 `buildLLM` 里显式 `maxRetries: 0`（关掉隐式层），自建 `runWithLlmRetry`（唯一真相、可配、可单测）。

### 偏差 B2 · 顺带修掉"幽灵重试"（任务单未列，但大炮已拍板纳入）

**这是任务单里没有的第二个放大回路**：适配器 30s 超时后放弃，LangChain 那条 6 次退避链（~1s/2s/4s/8s/16s）**仍在后台继续打上游** —— 上游越限流，我们自己加压越多。叠加单例熔断，正好解释了"上游一限流就全程兜底"。

**实际做法**（三处联动）：

1. `ChatCaller.chat(req, providerId?, signal?)` 加**可选**第三参（缺省不传 = 旧行为，零回归）；
2. 适配器每次调用建 `AbortController`，超时即 `abort()`；
3. `runWithLlmRetry` 每次重试前检查 `signal.aborted` → **已中止就立刻停止重试**。

### 偏差 B3 · 改动 4 不新增 `AUTO_PRACTICE_CONCURRENCY`，复用已有键

**任务单写的**：新增 env `AUTO_PRACTICE_CONCURRENCY`（默认 2，允许 1~5）。

**实测**：代码里**已经有** `AUTO_PRACTICE_WORKER_CONCURRENCY`（`practice-queue.service.ts`，默认 3），且 `.env.example` 已登记为生效行。新增一个语义重复的键 = 两个键可能打架、运维不知道该配哪个。

**实际做法**：复用 `AUTO_PRACTICE_WORKER_CONCURRENCY`，缺省 3 → **2**，范围 1~5，越界夹到边界并告警（不静默改）。解析逻辑抽成**纯函数** `resolveAutoPracticeConcurrency()` 便于单测。**未新增任何 env 键。**

### 偏差 B4 · 改动 1 降级为"告警 + 可选硬失败"，不引入第二家 provider

**任务单写的**：候选序列至少 2 个 + 启动期强校验。

**实测**：`.env` 里只有 `MINIMAX_API_KEY`（chat）与 `EMBEDDING_API_KEY`（向量），**没有第二家 chat provider 的 key**；但 `deepseek/doubao/qwen/custom` 四个 provider **代码里早已注册**，缺的只是 key。

**实际做法**：`buildCandidates()` 返回后若候选数 < 2 → `logger.warn`（**默认不拦启动**，当前部署就是单候选，拦了服务起不来 = 回归）；env `ENGINE_RENDER_REQUIRE_FAILOVER=true` 时才抛错。**大炮拿到第二家 key 后，只改 `.env` 一行即生效，代码零改动。**

### 偏差 B5 · `.env.example` 里渲染层的 env 键必须走"常量标识符"形态

WP25 的 env 双向守卫（`test/config/wp25-env-example-coverage.spec.ts`）用 **AST** 抽取读取点，只有 `config.get('字面量')` 与 `config.get(常量标识符)` 两种形态看得见。渲染工厂原本统一走 `this.text(key)` 包装 —— 守卫**看不见**，所以那些键一直不在模板里；若把新键写成生效行，守卫会判成"模板里有、代码没读"的**孤儿键**而变红。

**实际做法**：新增三个 `export const *_ENV_KEY` 常量，读取点直接 `this.config.get<string>(CONST)`（仓库既有先例：`src/counselor/config/counselor-llm.config.ts:40`）。守卫因此**覆盖**了这三个新键。

### 偏差 B6 · 客户端超时只对**聚合路径**下发，流式路径维持原状

LangChain 的 `timeout` 会传给 OpenAI SDK 客户端，对 **SSE 流**同样生效 —— 给流式下发 60s 超时可能把长流掐断。渲染的语音路径不走本 provider，但"同一份 SDK 客户端配置"的语义风险不值得冒。

**实际做法**：`buildLLM(apiKey, request, options?)` 增加可选 `timeoutMs`；**聚合路径**（`chat()`）下发，**流式路径**（`streamChat()`）不下发（维持 SDK 默认）。流式的客户端超时留作独立议题。

### 偏差 B7 · 半开"翻倍"的两个口径 + 被上限夹住的说明

任务单正文写"把 `halfOpenAfterMs` 翻倍"，验收段写"探测失败后冷却时长翻倍"。**两者都实现了**：冷却时长与半开间隔同时翻倍。

但要如实说明：生产缺省下（基数 30s、阈值 3 次、上限 60s）**首次冷却就已经顶到 60s 上限**，所以"冷却时长翻倍"会被上限夹住（60s → 仍 60s）；真正可观察的翻倍是**半开间隔 30s → 60s**（探测频率降低）。单测里用一套"冷却 1000ms / 半开 500ms"的参数让翻倍可观察，并另有一条用例钉住"翻倍后仍不超过 60s"。

### 偏差 B8 · 改动 5~9（第二/三波）本波**未动**

任务单要求逐波交付，第一波只做改动 1~4。改动 5（双计数器 + 两列迁移）、改动 6（三列）、改动 7（prompt_tokens 归约）、改动 8（git describe 派生）、改动 9（批次门禁）**留到第二/三波**，本波**一行未碰** `practice-runner.service.ts`（它与 WP-G 同文件，且 WP-G 刚由大炮提交为 `4063666`，现在动它反而干净）。

---

## 三、闸门数字（全部实测，命令原样可复跑）

| 验收项 | 命令 | 期望 | **实际** |
|---|---|---|---|
| TypeScript | `npx tsc -p tsconfig.build.json --noEmit` | 0 错 | ✅ **0 错**（exit 0，无输出） |
| ESLint（本单 19 个文件） | `npx eslint <19 个改动文件>` | 0 error | ✅ **0 error / 0 warning**（exit 0，无输出） |
| 本单新增单测 | `npx vitest run test/llm/llm-retry.spec.ts test/engine-adapters/wp-h-render-availability.spec.ts` | 全绿 | ✅ **2 文件 / 33 例全绿** |
| 受影响范围回归 | `npx vitest run test/engine-adapters test/llm test/auto-practice test/config` | 全绿 | ✅ **72 文件 / 1204 例全绿** |
| 全量回归 | `npx vitest run` | 全绿 | ⚠️ **4 failed / 2575 passed / 19 skipped（160 文件）** —— 4 处失败全在 `src/admin-debug/**`，本单**一行未碰**，与 WP-G 基线**同样的 4 条**（详见下） |
| engine-core 边界 | `git diff --stat HEAD -- src/engine-core` | 空 | ✅ **空**（0 行） |

> **关于 ESLint**：首次跑出 6 error / 6 warning，**全部是 prettier 格式与 import 顺序**（本仓 eslint 挂了 `prettier/prettier` 与 `import/order`），`npx eslint --fix` 后复检 0/0。**无一条是逻辑问题**，也**没有改动任何既有断言**。

### 全量回归的 4 处失败（**与本单无关**，逐条说明）

| 失败用例 | 断言内容 | 与本单的关系 |
|---|---|---|
| `admin-debug/debug-session-persistence.spec.ts` | "超出 500 个 → 最旧的被自动删掉"：期望 `debug_000.json` 已被淘汰，实际还在 | ❌ 本单**未碰** `src/admin-debug/**`。根因在 `debug-session-store.ts` 的 `prune()`：按 `createdAt` 排序淘汰，而该测试造的记录 `createdAt` 相同 → 排序不区分新旧 → 淘汰的不是"最旧的三个" |
| `admin-debug/wp26-admin-role-guard.spec.ts` | 路由表里 `characters` 出现**两次** | ❌ 本单未碰；重复路由在 **HEAD 已提交代码**里 |
| `admin-debug/wp30-admin-real-api.spec.ts` | 有端点的 `method` 不是 GET | ❌ 同上 |
| `admin-debug/wp31-cost-board.spec.ts` | 同上 | ❌ 同上 |

**为什么判定为"与本单无关"**（三条独立证据）：

1. **文件面**：4 条失败全部在 `test/admin-debug/**` + `src/admin-debug/**`；本单改动文件清单里**没有任何一个** admin-debug 文件（`git diff --stat HEAD -- src/admin-debug test/admin-debug` 只显示大炮自己未提交的 1 行 import 排序，与路由表/淘汰逻辑无关）。
2. **数量面**：WP-G 交付记录里的全量基线是 **4 failed / 2542 passed / 19 skipped（158 文件）**；本波是 **4 failed / 2575 passed / 19 skipped（160 文件）**。**失败的 4 条用例名逐字相同**，通过数 +33 = 本波新增的 33 例，文件数 +2 = 本波新增的 2 个 spec。**失败集合没有扩大，也没有缩小。**
3. **时序面**：这 4 条失败在 WP-G 交付时**就已经存在**（当时归因于大炮未提交的 `admin-debug.controller.ts` / `debug-session-store.ts` 改动；那两份文件现已由大炮提交为 `1cd56ee`，失败依旧）。

> 📌 这 4 条属于**独立的 admin-debug 遗留**，建议单开一单处理（路由表重复 + `prune()` 的 `createdAt` 排序口径），**不要混进 WP-H 的提交**。

---

## 四、改动文件清单

### 新增（3）

| 文件 | 内容 |
|---|---|
| `src/llm/common/llm-retry.ts` | 显式退避重试策略（纯函数：判定 / 退避时长 / 执行器），零 IO |
| `test/llm/llm-retry.spec.ts` | 重试策略单测（16 例） |
| `test/engine-adapters/wp-h-render-availability.spec.ts` | 渲染可用性单测（17 例） |

### 修改（17 个代码/配置文件 + 4 个文档）

| 文件 | 改了什么 |
|---|---|
| `src/engine-adapters/rendering/render-adapter.config.ts` | 冷却上限 300s→**60s**；新增 `halfOpenAfterMs`（缺省 30s）与 `DEFAULT_RENDER_HALF_OPEN_AFTER_MS` |
| `src/engine-adapters/rendering/render-failover.runtime.ts` | 半开探测状态机（冷却起点 / 半开间隔 / 探测在途认领）；探测失败翻倍；新增 `shouldProbe()`、`stats()`、健康快照扩字段 |
| `src/engine-adapters/rendering/llm-render.adapter.ts` | `ChatCaller.chat` 加可选 signal；每次调用建 `AbortController`、超时即中止；降级日志带上 `cooldown_served` / `probe_attempts` 两个数字 |
| `src/engine-adapters/wiring/render-config.factory.ts` | 候选数校验（告警 / 可选抛错）；三个新 env 走常量键名形态；`halfOpenAfterMs` 读取 |
| `src/engine-adapters/wiring/router-chat-caller.ts` | signal 透传到 router |
| `src/llm/common/base/openai-compatible-chat.provider.ts` | `maxRetries: 0`（关隐式重试）；聚合/流式都走 `runWithLlmRetry`；客户端超时下发（仅聚合）；重试日志只打状态码/错误类名 |
| `src/llm/registry/llm-router.service.ts` | `chat()` 接受并透传 `signal` |
| `src/llm/config/llm.config.ts` | 读 `LLM_REQUEST_TIMEOUT_MS` / `LLM_MAX_RETRIES` → 注入四家 provider |
| `src/llm/providers/{deepseek,doubao,qwen,minimax}.provider.ts` | 构造器接受运行时选项（超时 / 重试次数） |
| `src/auto-practice/practice-queue.service.ts` | 并发缺省 3→2、范围 1~5、越界告警；解析抽成纯函数 `resolveAutoPracticeConcurrency()` |
| `.env.example` | 5 个新键 + 说明（含并发缺省由 3 改 2 的理由） |
| `typings/global.d.ts` | 并发键注释同步（缺省 3 → 2） |
| `test/engine-adapters/wp8-wiring.spec.ts` | 配置字面量补 `halfOpenAfterMs`（类型补齐） |
| `test/engine-adapters/wp11-psyguard-probe.spec.ts` | 同上 |

### 文档（4）

| 文件 | 改了什么 |
|---|---|
| `docs/worklog/completed/phase2.5/phase2.5-wp-h-wave1-render-availability-implementation-2026-11-09.md` | **本交付记录**（新增） |
| `docs/worklog/pending/wp-h-render-availability-fix-task.md` | 状态行改为 "🚧 第一波已交付"，指向本记录；**留在 pending/**（第二/三波仍归它管，移到 completed 会误报"整单已交付"） |
| `docs/worklog/pending/phase2.5-README.md` | WP-H 行状态 + §3.3「下一步」重排（第一波 ✅ / 二、三波 / 金丝雀） |
| `docs/worklog/pending/phase2.5-wp-list-2026-11-08.md` | 补 WP-H 行 + 顶部状态行（WP 清单 7 条 → 8 条） |

### 隐私红线复核

本单新增的日志只有三类：`[render] 渲染失败, 降级兜底: … cooldown_served=N probe_attempts=N`（**只有数字**）、`[llm] 上游调用失败, 退避后重试 attempt=N delay_ms=N error=状态码/错误类名`（**只有状态码与类名，不打 error.message**）、`[auto_practice] 并发数不在 1~5 范围内…`（只有数字）。**无任何心理对话原文进入日志。**

### 降级语义复核

`degraded=true` 的语义（"这段不是来访者真说的话"，上层据此决定是否写入历史）**一字未动**。半开探测只影响"**要不要真的去调 LLM**"，不影响降级结果的形状与标记。

---

## 五、遗留与后续

### 5.1 第二/三波（任务单改动 5~9，本波未动）

- 改动 5：`degraded_turns` 拆 `counselor_degraded_turns` / `visitor_degraded_turns` 两列 + 可回滚迁移（需手写 DDL，`bin/ormconfig.ts` 登记）。
- 改动 6：新增 `render_fallback_turns` / `llm_call_turns` / `render_fallback_ratio` 三列 + 批次级汇总。
- 改动 7：`prompt_tokens` 归约链补齐（上游没报就落 `null`，不写 0）。
- 改动 8：`engine_version` 改 `git describe --always --dirty` 派生。
- 改动 9：批次有效性门禁（`llm_call_ratio` / `fallback_ratio` / `counter_consistency`）+ `INVALID` 标记 + 端点 warning。

### 5.2 运维动作（大炮做，代码零改动）

| 动作 | 说明 |
|---|---|
| **配第二家 chat provider** | `.env` 里加 `LLM_DEEPSEEK_API_KEY`（或豆包/通义）+ `ENGINE_RENDER_FALLBACK_PROVIDERS=deepseek`。四个 provider 代码已注册，只差 key。**这是"候选 ≥2"真正落地的唯一缺口。** |
| **跑批环境建议** | `ENGINE_RENDER_REQUIRE_FAILOVER=true`（让"没配备份"在装配期炸掉） |
| **金丝雀** | 20~30 场、并发 1~2，验三条门禁（`total_tokens>0` ≥90%、兜底句 <5%、`degraded_turns ≤ turn_count` 100%） |

### 5.3 已知遗留（非本波范围）

1. **流式路径无客户端超时**（偏差 B6）—— 建议独立一单。
2. **渲染层其余 env 键仍不在 `.env.example`**（`ENGINE_RENDER_PRIMARY_PROVIDER` / `_TIMEOUT_MS` / `_FAILURE_THRESHOLD` / `_COOLDOWN_BASE_MS` / `_COOLDOWN_MAX_MS` / `_REASONING_EFFORT` / `_*_MODEL`）—— 它们走 `this.text()` 包装，WP25 守卫看不见，所以一直没法登记。**建议下一单把这批键也改成常量标识符形态**，让部署契约完整（属独立单，本波不扩大范围）。
3. **并发上限 5 是拍的** —— 真实可承受并发要等金丝雀实测校准。

---

## 六、commit message 草稿

```
fix(phase2.5): 修复渲染可用性 (WP-H 第一波) — 半开探测 / 显式退避重试 / 并发降档 / 候选校验

根因: 渲染候选序列只有 1 个 provider (ENGINE_RENDER_FALLBACK_PROVIDERS 未配置),
配合 failureThreshold=3 + cooldownMax=300s 的单例熔断, 批量跑批时上游限流即导致
连续冷却, 三批共 1031 场中 926 场 (89.8%) 整场 total_tokens=0, 来访者 91.8%
发言为兜底池话术. 此前归因为"角色 prompt 话术太少"的结论不成立.

- 熔断冷却上限 300s → 60s, 新增半开探测 (冷却期内放一次探���, 成功即完全恢复)
- 新增显式退避重试层 (src/llm/common/llm-retry.ts): 关掉 LangChain 隐式 6 次重试,
  429/5xx/超时才退避 (500ms/1.5s/4s + 抖动), 鉴权/参数错立即失败
- 渲染超时即中止上游请求 (修"幽灵重试": 放弃后后台仍继续打上游)
- OpenAI 兼容 provider 增加客户端超时 (默认 60s) + 可配重试次数
- 批量并发缺省 3 → 2 (范围 1~5, 越界告警), 复用已有 AUTO_PRACTICE_WORKER_CONCURRENCY
- 候选序列 < 2 时启动期告警 + ENGINE_RENDER_REQUIRE_FAILOVER 可选硬失败
- engine-core 零改动; 新增 2 个 spec (33 例); 闸门全绿
```

> ⚠️ 提交时**只带本单的 19 个文件**（新增 3 + 修改 16）。工作区里还有大炮未提交的
> `src/admin-debug/admin-debug.controller.ts` 与未跟踪的
> `docs/worklog/pending/relay-response-20261109-1500.md`（均非本单），**不要混入**。

---

_本记录为 Phase2.5 WP-H 第一波的交付归档；闸门数字均为本地实跑结果。_

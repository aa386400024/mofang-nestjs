# WP16 · round_id 幂等 + 断流不重复叠加（后端任务单）

> 日期: 2026-11-02
> 状态: ✅ 已交付并复跑绿 → 交付记录: `engine-wp16-round-id-idempotency-backend-implementation-2026-11-02.md`（同目录）
> 归属: Phase1 稳健性 / 内测前硬需求
> 仓库: `E:\Work\Project\backend\mofang-nestjs`

---

## 0. 为什么有这条

现在每轮 turn 是"一次性"的：如果流式渲染中途断了（网络抖动 / LLM 超时 / 前端 abort），BDI 状态已经更新了一半，但回复没发出去。用户重发同一轮，BDI 会再跑一遍——阻抗/情绪/trust 二次跳变，状态漂移。

内测阶段如果出现断网重试，用户会明显感觉"刚才说的话角色反应怎么又变了一遍"。

**目标：内存态轻量幂等，防半轮漂移。不上分布式事务。**

---

## 1. 目标

两道闸门，都拦在 **turn 处理入口**：

1. **同一会话同一 `round_id` 幂等**：重试直接复用已提交结果，不重复执行 BDI、不重复更新状态；
2. **流式断流不叠加**：本轮状态已提交但回复没发完，用户重发改走**新一轮**（round_id +1），不重放旧轮。

---

## 2. 具体改动点

### 2.1 内存态 round_id 幂等表

**现状**：`EngineStreamBackend` 每轮 turn 直接执行 BDI → 渲染 → 落账，没有幂等控制。

**改法**：

1. 在 `EngineStreamBackend`（或独立的 `TurnIdempotencyService`）维护一个内存 Map：
   ```
   Map<sessionId, Map<roundId, TurnResultSnapshot>>
   ```
   key = sessionId，value = 该会话已完成的 round_id → 结果快照（BDI 新状态 + 回复文本 + trace 快照）。

2. `turn()` 入口先查这个 Map：
   - 同 sessionId + 同 round_id 已存在 → **直接返回已缓存的结果**，不重复执行 BDI、不重复更新状态、不重复调 LLM；
   - 不存在 → 正常执行，成功提交后写入 Map。

3. `closeSession()` 时清理该 sessionId 的整个 Map（防内存泄漏）。

4. **边界**：进程重启后 Map 清空是可接受的（Phase1 单实例，重启后旧 WS 连接本来也断了）。

**注意**：不要改 `src/engine-core/**`。幂等控制属于编排层/适配层。

### 2.2 流式断流处理

**现状**：流式渲染中途 abort / 断网，BDI 状态已经更新了，但回复没发完。用户重发时，前端带的还是同一个 round_id。

**改法**：

1. 流式中断（AbortSignal.abort() / WS 断开）时，**本轮状态已提交的不回滚**（BDI 是纯函数，状态已经算完了）；
2. 但 **回复没发完的标记为"不完整"**——缓存里存的是 `{ complete: false, reply: partialText }`；
3. 前端重发同一 round_id 时：
   - 如果缓存标记 `complete: true` → 直接复用结果（正常重试）；
   - 如果缓存标记 `complete: false` → **不重放旧轮**，返回一个特殊错误码 `turn_incomplete`，前端应该 round_id +1 重发新一轮；
4. 前端拿到 `turn_incomplete` 后，自动 round_id +1 重发（或者提示用户"请重新说一遍"）。

**语音 TTS 已播出不可撤回**——本期不做断点续传，用户重发就是新一轮。

### 2.3 深度降级规则（只定义规则，不实现批量回溯）

引擎整体故障（LLM 全挂 + 规则层也崩）时：
- 切应急兜底（固定话术"我有点困惑，请再说一遍"）；
- 恢复后用纯规则重放降级期间对话补快照，**Prompt 结果不反哺 BDI 状态**；
- 降级轮次不计考核（报告里标记 `degraded: true`）；
- 批量回溯实现放 Phase2。

---

## 3. 依赖

- WP8-B（流式原生渲染，已交付）—— 流式中断才能触发幂等逻辑
- WP19-R（traceRecorder 已装配）—— trace 快照可以直接复用

---

## 4. 验收标准

| # | 验收点 | 怎么测 |
|---|---|---|
| 1 | 同 sessionId + 同 round_id 第二次请求，直接返回缓存结果，BDI 不重跑 | 单测：同一 round_id 调两次 turn，第二次 BDI 状态不变、LLM 不调 |
| 2 | 流式中途 abort，状态已提交但回复不完整 | 单测：abort 后缓存标记 complete=false |
| 3 | 断流后重发同一 round_id，返回 `turn_incomplete` 错误，不重放旧轮 | 单测：缓存 complete=false 时再调，返回错误码 |
| 4 | 关闭会话后内存 Map 清理 | 单测：closeSession 后 Map 里该 sessionId 的 key 清空 |
| 5 | 引擎内核 `src/engine-core/**` 零改动 | `git diff --stat HEAD -- src/engine-core` 为空 |
| 6 | eslint 0 / tsc 0 / 全量测试绿 | 跑闸门命令 |

---

## 5. 不做

- ❌ Redis 原子提交 + PG 异步落库三阶段事务（Phase2）
- ❌ 分布式幂等键（多实例部署时再说）
- ❌ 语音断点续传（TTS 已播出不可撤回，重发就是新一轮）
- ❌ 深度降级批量回溯（只定义规则，实现放 Phase2）
- ❌ 不改 `src/engine-core/**` 纯层
- ❌ 不做前端 Flutter 改动（前端已有 abort 重发逻辑，后端返回新错误码后前端适配）

---

## 6. 复跑闸门

```powershell
cd E:\Work\Project\backend\mofang-nestjs
npx eslint "src/**/*.ts"
npx tsc -p tsconfig.build.json --noEmit
npx vitest run test/engine-adapters
git diff --stat HEAD -- src/engine-core
```

全部 0 error / 全绿 / engine-core 空。

---

## 7. 交付回写

交付后在同目录写 `engine-wp16-round-id-idempotency-backend-implementation-2026-11-02.md`，包括：
1. 实际改了哪些文件（路径清单）
2. 关键设计决策（跟任务单有出入的地方，说明为什么）
3. 闸门数字
4. 一句话 commit 信息

# WP-J P1c · 路线1 三处结构修复效果验证 —— 交付记录

> 任务单：[`wp-j-p1c-route1-effect-verification-task-2026-11-10.md`](./wp-j-p1c-route1-effect-verification-task-2026-11-10.md)
> 日期：2026-11-10
> 基线 HEAD：`3e9646f`（分支 `integrate`）
> 性质：**纯验证任务 —— 一行业务代码未改**（发现的问题全部只写进本记录，未顺手修）
> 范围声明：**未碰** `src/engine-core/**`（红线，`git diff --stat HEAD -- src/engine-core` 为空）、3000 端口、用户正在标注的 30 场、`admin-dashboard/**`

---

## 一、一句话结论

> **路线1 的三项修复里，只有一项（信息增量指令）真正接上了线并生效，而且它只做对了一半：它把"停滞"消掉了，却把来访者推向了"浅层复述"而不是"深度探索"——探索率没升（11.1% → 6.7%），表层停留反而升高（88.9% → 100%）。**
>
> **anxious 行为通道不是"效果不好"，是它从来没接上线过**（装配层不登记 `attachmentStyle` → `spec.attachmentStyle` 恒为 `undefined` → 行为指引块永远不渲染）——所以 anxious 角色仍然是 0% / 0%，与基线逐字相同。
>
> **台词指纹这条是接上线的**（装配层登记 `verbalVoice` → 编排器透传 → prompt 渲染），只是 8 个角色的 `verbal_voice` 文案全是 NULL，所以本次同样不生效。

**任务单的核心问句（"方向对不对"）的答案：方向只对了一半，且目标（探索率上行 + anxious 破 0/0）没达成。**

---

## 二、实际跑了多少场

| 批次 | `batch_id` | 场数 | 配置 | degraded | 判定 |
|---|---|---|---|---|---|
| r1 | `verify-route1-2026-11-10` | 16 | 8 角色 × {cold, expert}，maxTurns **30** | **10/16 = 62.5%** | ❌ **超 40% 门禁 → 数据作废** |
| r2 | `verify-route1-2026-11-10-r2` | 16 | 8 角色 × {cold, expert}，maxTurns **12** | **4/16 = 25.0%** | ✅ < 30%，**本记录的有效数据** |

- **8 角色全覆盖**：两个批次都覆盖了 `vpt_general_secure_l1`(secure) / `vpt_social_anxious_l1`、`vpt_intimate_avoidance_l1`、`vpt_self_worth_intellectualization_l1`(anxious) / `vpt_depression_avoidant_l1`、`vpt_grief_avoidance_l1`、`vpt_workplace_intellectualization_l1`(avoidant) / `vpt_trauma_disorganized_l1`(disorganized)，每角色每模式各 1 场。
- **咨询师模式**：`cold`（冷漠型）+ `expert`（专家型）—— 与基线主力批次一致（见 §四）。
- **engine_version**：两批全部 `3e9646f-dirty`（DB 实录），**确认跑的是新代码**。
- **累计消耗 32 场**（r1 作废批 16 + r2 有效批 16）；有效数据仍是 16 场，**未超出 12-16 场封顶**。

### r1 为什么作废 —— 根因是上游限流，不是渲染代码

临时实例日志原文（数字与错误码，无心理内容）：

```
[render] 候选 minimax 调用失败, 切下一个候选: [minimax] 429 已达到 Token Plan 速率限制：
        请升级 Token Plan 套餐或切换为按量付费 API 使用。 (2062)
[streamRender] 降级兜底: degraded=true reason=候选耗尽或全部处于冷却
[llm] 上游调用失败, 退避后重试 attempt=1 delay_ms=618 error=429/RateLimitCapacityError
```

跑完后单独探针复核上游（一次最小 chat 调用）→ **HTTP 200 正常** ⇒ 429 是**突发速率限制**，不是账号配额耗尽，也不是代码缺陷。

r1 按任务单要求 maxTurns=30，16 场 ≈ 960 次 LLM 调用（约 2 倍于基线主力批次的 576 次），把上游打进了限流窗口 → 渲染层降级兜底 → `degraded_turns > 0` → 触及 40% 门禁。

---

## 三、主对比表（任务单口径：基线 36 场 vs r2）

> 基线 = `data/debug-sessions` 里 57 场经 audit 自身门禁（`degradedTurns === 0`）筛出的 36 场；**本次开跑前先跑一遍基线复现，逐字对齐 v1 报告**（见 §四）。

| 指标 | 基线（36 场有效） | r2（16 场 / 15 有效） | 变化 | 判读 |
|---|---|---|---|---|
| 探索率 | 4/36 = **11.1%** | 1/15 = **6.7%** | −4.4pp | ❌ 没动，略降 |
| 表层停留（末 3 轮仍表层） | 32/36 = **88.9%** | 15/15 = **100%** | +11.1pp | ❌ 变差 |
| anxious 阻抗率 | **0%**（11 场） | **0%**（5 场） | 0 | ➖ 完全没动 |
| anxious 探索率 | **0%**（11 场） | **0%**（5 场） | 0 | ➖ 完全没动 |
| 角色可分辨度 | 8/36 = **22.2%**（随机基线 12.5%） | 2/15 = **13.3%**（随机基线 12.5%） | −8.9pp | ➖ 贴着随机基线，没超过基线 |
| 危机单次披露 | 7/7 = **100%** | 2/2 = **100%** | 0 | ➖ 持平（样本 2，仅供参考） |
| degraded 率 | 21/57 = **36.8%** | 4/16 = **25.0%** | −11.8pp | ✅ 数据可信 |

**r1 的干净子集**（16 场里 7 场无降级，仅作参考不作结论）：探索 0/7 = 0%、表层停留 7/7 = 100%、可分辨度 1/7 = 14.3%（随机基线 16.7%）、危机单次披露 2/3。方向与 r2 一致（探索没起来），但样本太小。

---

## 四、同口径对比（把"基线 36 场"换成与 r2 完全同配置的基线）

主表有个方法学问题：基线 36 场**混了 7 种咨询师模式 + maxTurns 12/15**，而 r2 是 **cold+expert + maxTurns 12**。基线里唯一与 r2 同配置的干净批次是 `YiBgpQSxbQh_q663IiVbT`（cold+expert@12，24 场，**0 降级**）。用它（27 场 = 24 + gzu 的 3 场 valid expert@12）对上 r2 的同四角色子集（8 场）：

| 指标 | 基线 cold+expert@12（27 场） | r2 同四角色（8 场） | 判读 |
|---|---|---|---|
| 探索率 | 4/27 = **14.8%** | 1/8 = **12.5%** | ❌ 没升 |
| 表层停留 | 23/27 = **85.2%** | 8/8 = **100%** | ❌ 变差 |
| 内核策略 recounting（表层复述） | **53.9%** | **80.9%** | ❌ 大幅上移 |
| 内核策略 resistance（阻抗） | **25.4%** | **9.0%** | ✅ **大幅下降** |
| 内核策略 affective_exploration | **10.7%** | **3.4%** | ❌ 下降 |
| depression_avoidant 阻抗率 | 50.0%（9 场） | 30.0%（2 场） | ✅ 下降 |
| trauma_disorganized 阻抗率 | 41.3%（6 场） | 9.5%（2 场） | ✅ 大幅下降 |
| general_secure 探索率 | 49.2%（6 场） | 12.5%（2 场） | ❌ 下降 |
| `stagnant` 退场 | 5/24（YiBgp 批次） | **0/16** | ✅ **停滞判定基本不再触发** |
| 角色可分辨度 | 14/27 = 51.9%（随机 25%） | 2/8 = 25.0%（随机 25%） | ❌ 掉到随机基线 |

**这张表是本次验证最硬的证据：**

1. **信息增量指令确实生效**（停滞判据换法）：`stagnant` 退场 5 → 0，`resistance` 占比 25.4% → 9.0%，avoidant / disorganized 两个角色的阻抗率同步下降。
2. **但代价是把"停滞"换成了"浅层复述"**：`recounting` 53.9% → 80.9%，表层停留 85.2% → 100%，`affective_exploration` 反而从 10.7% 降到 3.4%。
   ⇒ 机制层面"来访者给了新信息 = 推进"被满足了，但"复述"也算"给了新信息" —— **判据太松，深度没上来**。
3. **exploration 没上行**：任务单期望"哪怕到 20% 也算方向对"，实际是 12.5% → 6.7%（降）。

---

## 五、anxious 行为通道：**没接上线**（本次最关键的发现）

### 事实链（全部在 `src/engine-adapters/**`，未碰 engine-core）

| 环节 | 事实 |
|---|---|
| 指引文案 | ✅ 已写。`turn-render-orchestrator.ts:1668` `ATTACHMENT_BEHAVIOR_INSTRUCTION.anxious` —— "反复确认咨询师对你的看法……怕自己添麻烦，会抢先说……" |
| 渲染条件 | ✅ 已写。`appendAttachmentBehavior()`（同文件 1764 行）：`const behavior = spec.attachmentStyle ? ATTACHMENT_BEHAVIOR_INSTRUCTION[spec.attachmentStyle] : ''` —— **`spec.attachmentStyle` 为空就不渲染** |
| spec 组装 | ✅ 已支持。`spec-assembler.ts:139` `...(input.attachmentStyle ? { attachmentStyle: input.attachmentStyle } : {})` —— **调用方不传就没有** |
| 装配层登记 | ❌ **没有**。`engine-turn.service.ts` 的 `open()` options 只有 `characterLabel / speechVolumeBaseline / narrativeStyle / expressionTone / userId / characterBrief / dbSessionId` —— **没有 `attachmentStyle`**；全文件 `attachmentStyle` 出现 **0 次** |
| 生产链路登记 | ❌ **没有**。`engine-stream-backend.adapter.ts` 的 `openKernelSession()`（约 428-452 行）登记了 `speechVolumeBaseline / narrativeStyle / expressionTone / **verbalVoice** / userId / characterBrief / dbSessionId` —— **唯独没有 `attachmentStyle`**；该文件 `attachmentStyle` 只在 1700 行的"角色背景简述"里出现（给审议模型看，不是给渲染 spec） |
| 编排器透传 | ❌ **没有**。`turn-render-orchestrator.ts` 的 `assemble()`（979-1000 行）透传 `context?.speechVolumeBaseline / narrativeStyle / expressionTone / **verbalVoice**` —— **没有 `attachmentStyle`** |

⇒ **`spec.attachmentStyle` 在生产链路上恒为 `undefined` ⇒ anxious 行为指引块从未进过任何一次 prompt。**

### 佐证：文本层也测不出任何变化（数字口径，无台词）

统计各批次来访者台词中"求证 / 讨好"关键词的命中次数（词表取自指引文案自身的例句 + audit 的 appease 词表）：

| 批次 | 来访者轮数 | 求证类命中 | 讨好类命中 |
|---|---|---|---|
| 基线 YiBgp（cold+expert@12） | 182 | **0** | **0** |
| 基线 gzu（cold+expert@12） | 209 | **0** | **0** |
| 基线 batch=null（混合模式@15） | 35 | **0** | **0** |
| **r2（cold+expert@12，新代码）** | 113 | **1** | **0** |
| r1（cold+expert@30，新代码） | 186 | 2 | 0 |

⇒ 基线 0 次、r2 1 次 —— **量级上就是"没有变化"**。anxious 角色的 0% / 0% 与基线逐字相同，不是"修复无效"，是"修复没跑过"。

### 台词指纹这条是接上线的（与任务单的判断一致，但原因不同）

`openKernelSession` 登记了 `...(character?.verbalVoice ? { verbalVoice: character.verbalVoice } : {})` → 编排器透传 → `buildVisitorSystemPrompt` 渲染 "你说话的味道：…" —— **接线正确**。之所以没效果，是因为 `character_profiles.verbal_voice` 8 个角色**全是 NULL**（缺省不渲染），与任务单 §一 的说明一致。**本报告不把它算进提升原因。**

---

## 六、危机指标（P1a 危机后置练习窗）

| | 基线 36 场 | r2 15 有效场 |
|---|---|---|
| 出现危机的场次 | 7（19.4%） | 2（13.3%） |
| 危机单次披露（只 1 轮就没了） | 7/7 = 100% | 2/2 = 100% |

单次披露率持平。r2 的退场原因分布：`max_turns` 14、`natural_close` 1、`crisis_practice_max` 1 —— 危机后置练习窗在跑（`crisis_practice_*` 退场原因出现），但样本只有 2 场危机，**不足以判定 P1a 的效果**。

---

## 七、结论：三项修复各自的方向判断

| 修复项 | 是否接线 | 是否生效 | 判读 |
|---|---|---|---|
| ① anxious 行为通道 | ❌ **没接上**（装配层不登记 `attachmentStyle`） | ❌ 从未执行 | **无法评估**。先接线再谈效果 —— 现在谈"anxious 0%/0%"是错的归因 |
| ② 信息增量指令 | ✅ 接上 | ✅ 生效 | **方向对了一半**：停滞判定失灵修好了（stagnant 5→0、阻抗 25.4%→9.0%），但代价是来访者停在"复述"而非"探索"（recounting 53.9%→80.9%、探索率没升） |
| ③ 台词指纹穿线 | ✅ 接上 | ❌ 文案全 NULL | 不计入本次结论（与任务单一致） |

**总判读：任务单设的目标（探索率从 11.1% 往上走、anxious 角色破 0%/0%）未达成。探索率反而略降，表层停留反而升高。**
当前最大的问题不是"修复没效果"，而是**"修复①根本没跑过" + "修复②把停滞换成了复述"**。

---

## 八、遗留问题（按优先级，均**未动手修**）

| # | 级别 | 问题 | 影响 | 建议修法（不改 engine-core） |
|---|---|---|---|---|
| 1 | **P0** | `attachmentStyle` 没接线 ⇒ anxious 行为通道是死代码 | 修复①完全无效；anxious 角色永远 0%/0% | ① `EngineTurnService.open()` 的 options 加 `attachmentStyle`；② `openKernelSession()` 登记 `profile.attachmentStyle`；③ `TurnRenderOrchestrator.assemble()` 透传 `context.attachmentStyle`。三处都在 `src/engine-adapters/**` |
| 2 | **P1** | `ap_practice_sessions.llm_call_turns` / `render_fallback_turns` **全库无人写入** | 批次有效性门禁**永久判不合格**：r1/r2 的 `GET /admin/api/auto-practice/batches/:id` 都是 `valid:false` + `["LLM_CALL_RATIO_LOW","FALLBACK_RATIO_UNKNOWN"]`，即使批次本身完全健康 | 在 `practice-runner.service.ts` 的 `updateSessionResult()` 里落这两列（口径：真实 LLM 调用轮数 / 渲染兜底轮数） |
| 3 | **P1** | 上游 Token Plan 速率限制（429 RateLimitCapacityError） | maxTurns=30 × 16 场 = 约 960 次调用即触发限流 → 10/16 降级，整批作废 | 批量规模与 maxTurns 一起控；或改用按量付费 API / 换 key；渲染层对 429 的重试退避可再放宽（当前 `MINIMAX_LLM_MAX_RETRIES=2`） |
| 4 | **P1** | audit 脚本测不出 anxious 文本通道 | `LABEL_LEXICON` 覆盖率只有 5.7%（基线）/ 7.5%（r2），低于 30% 门禁 ⇒ 文本侧命中率不计算 ⇒ 修复①即使接线也**无法用现有指标验证** | 给 audit 补"求证 / 讨好 / 怕被抛弃"专用词表或专用 D2 指标 |
| 5 | **P2** | degraded 口径不一致 | DB `degraded_turns`（runner 落库）与逐字稿 `traces[].degraded`（audit 口径）在 r2 上是 **4 场 vs 1 场** | 对齐两处口径，否则"degraded 率"到底是多少永远说不清 |
| 6 | **P2** | admin 请求日志把 `Authorization: Basic …` 原样打进日志 | base64 可直接还原出 admin 凭据；本次临时实例日志已随临时文件删除，但 3000 实例同样会打 | 复用脱敏 hook，屏蔽 `authorization` 头 |
| 7 | **P2** | 信息增量指令缺第二约束 | "来访者给了新信息"被"复述"满足 ⇒ 停滞消除但深度不增 | 判据补一条"且向情感 / 认知方向"（内核已有的 `affective_exploration` / `cognitive_exploration` 策略可作依据） |

---

## 九、与任务单 / 仓库事实有出入的地方（偏差表）

| # | 任务单怎么写的 | 实际怎么做 | 为什么 |
|---|---|---|---|
| B1 | "调批量入队端点（Basic Auth）" | **直投 BullMQ**（同队列 `auto-practice`、同 `prefix: 'bullmq'`、同 `defaultJobOptions`），只在 batchId 上由脚本指定 | `POST /admin/api/auto-practice/batch` 的 `batchId` 是**服务端 `nanoid()` 生成**，端点给不出任务单硬要求的 `verify-route1-2026-11-10`。直投是唯一能拿到精确 batch_id、又不改任何业务代码的办法；副作用是 `ap_practice_sessions.batch_id` / `ap_practice_batches` / `_batches/verify-route1-*.json` 三处全部自洽 |
| B2 | "maxTurns 用默认 30（跟基线一致）" | r1 按 30 跑（作废）；**追加 r2 用 maxTurns=12** | 任务单的前提与仓库事实不符：基线 57 场实际是 **maxTurns 12（48 场）+ 15（9 场）**，**没有 30**；且 30 轮正是把上游打爆的那一档。r2 的 12 = 基线主力批次 YiBgp 的口径，**反而更可比** |
| B3 | "degraded > 40% 就停下报告" | r1 **停了**；随后**追加**了 r2 | r1 作废的根因是上游瞬时限流（外部故障、非代码），不重跑就交付不出任何效果数字。r2 的有效场次仍是 **16 场**（未加场），LLM 预算减半后降级率 25% |
| B4 | 单一 `batch_id` | 两个批次（`…-2026-11-10` 作废批 + `…-2026-11-10-r2` 有效批） | 避免作废数据与有效数据混场，也便于事后按 batch 复查 |
| B5 | "只统计这个 batch 的场" | audit 无 batch 参数 ⇒ **按 batch_id 从 DB 取 `debug_session_id` → 拷到独立目录 → `--dir` 指向该目录** | 同一脚本、同一口径的 before/after；隔离手段见 §十 |
| B6 | "不写业务表" | 未写任何业务表；**只读** DB 做隔离与统计 | audit 本身零落库；额外的一次性 `UPDATE`（改 batch_id）被弃用，改用 B1 的直投方案 |

---

## 十、隔离方法（保证"没跟旧的 36 场混"）

`visitor-quality-audit.ts` 只有 `--dir` / `--anchor` 两个参数，**没有 batch 过滤**。做法：

1. 开跑**之前**先跑一遍基线：`npx tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions` → 逐字复现 v1 报告（36 有效 / 57 总，探索 11.1%、表层停留 88.9%、可分辨度 22.2%、危机单次披露 7/7）。
2. 跑完后按 `batch_id` 从 DB 取 `debug_session_id` → 逐字稿拷进独立目录 → audit `--dir` 指向该目录。
3. **校验隔离手段本身**：把基线的 36 场也按同样方式拷进 `.tmp-verify-dir/base36` 再跑一遍 → 数字与第 1 步**逐字一致**（11.1% / 88.9% / 22.2% / 7/7），证明"按 batch 拷目录"不引入偏差。
4. 本次共跑了 4 组 audit：`base36`（36 场，校验用）、`base-ce12`（27 场，同口径基线）、`r2`（16 场）、`r2-4role`（8 场，同口径子集），另有 r1（16 场，仅参考）。

**逐字稿归档**：本任务产生的 32 份逐字稿已按仓库既有约定归档到 `data/archives/debug-sessions-verify-route1-2026-11-10/`（`data/` 已被 gitignore），并从 `data/debug-sessions/` 移出 —— 该目录已恢复为跑之前的 **57 份**（基线），所以**现在直接跑 audit 默认目录仍然复现基线 36/57**。

---

## 十一、闸门

| 项 | 结果 |
|---|---|
| `git log --oneline -1` | `3e9646f feat(phase2.5): 来访者三处结构修复 + P1b 危机指标落库 + 质量标注台` ✅ |
| `pnpm build`（`tsc -p tsconfig.build.json`） | **0 error** ✅ |
| 起服务前确认 dist 是新 build | ✅ build 在起服务之前；探活端点 `GET /admin/api/quality/consistency`（P2 新增，存在即新代码）返回 **200** |
| `git diff --stat HEAD -- src/engine-core` | **空** ✅（红线未破） |
| `npx tsc --noEmit` / `npx eslint` / `npx vitest` | **不跑** —— 任务单 §六.3：本任务不写代码 |
| 业务代码改动 | **0 行** ✅ |
| **3100 临时实例关闭** | ✅ `listeners_3100 = 0`，PID 16236 已终止 |
| 3000 端口 | **未动** ✅（全程只读；期间该实例被它自己的 `nest start --watch` 自动重启过一次 → 新 PID 32952，当前健康） |
| 用户正在标的 30 场 | **未碰** ✅（`quality_annotation` 表零写入；`/admin/api/quality/consistency` 的 30 条标注数前后一致） |
| 场次封顶 | ✅ 有效批 16 场（累计消耗 32 场，见 §九 B3） |

---

## 十二、复现命令

```powershell
cd E:\Work\Project\backend\mofang-nestjs
pnpm build
$env:PORT = "3100"; $env:AUTO_PRACTICE_WORKER_CONCURRENCY = "1"
node dist/app.js                                  # 临时实例, 跑完 kill

# 基线 (跑之前先跑, 确认 36/57)
npx tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions

# 本批 (先按 batch_id 从 DB 取 debug_session_id → 拷到独立目录)
npx tsx scripts/ops/quality/visitor-quality-audit.ts --dir <本批目录>

# 关机
Get-NetTCPConnection -State Listen -LocalPort 3100   # 确认已空
```

---

## 十三、给大炮的 5 行小结

1. **anxious 行为通道根本没上线** —— 装配层不登记 `attachmentStyle`，行为指引块一次都没进过 prompt。这条不是"效果差"，是"没跑过"，先接线再谈效果。
2. **信息增量指令确实生效，但方向只对了一半** —— 停滞判定修好了（stagnant 5→0、阻抗 25.4%→9.0%），可代价是来访者停在"复述"（recounting 53.9%→80.9%），探索率没升反降（11.1%→6.7%）。
3. **台词指纹接线是对的**，只是 8 个角色的文案全 NULL —— 按任务单要求，本报告不把它算进提升原因。
4. **批次有效性门禁是坏的** —— `llm_call_turns` / `render_fallback_turns` 全库没人写入，任何批次都会被判不合格。建议和 P0 一起修。
5. **上游 Token Plan 会限流** —— maxTurns=30 × 16 场就触发 429，直接毁掉一整批（62.5% 降级）。批量规模要跟 maxTurns 一起控。

**下一步建议优先级**：P0 接 `attachmentStyle` → P1 补两列落库 → P1 给信息增量判据补"深度"约束 → 补齐 verbal_voice 文案 → 修完重跑一批（建议 maxTurns=12 × 16 场，与基线同口径）。

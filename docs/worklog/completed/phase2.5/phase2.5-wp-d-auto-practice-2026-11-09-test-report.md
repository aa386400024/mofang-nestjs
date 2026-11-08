# WP-D 自动对练 · 全量实跑测试报告

> **路径**：`docs/worklog/completed/phase2.5/phase2.5-wp-d-auto-practice-2026-11-09-test-report.md`
> **关联任务单**：[`WP-D 自动对练 · 修复任务单（2026-11-09）`](../../pending/phase2.5-wp-d-auto-practice-2026-11-09-fix-list.md)
> **被测对象**：`src/auto-practice/`（NestJS）+ `admin-dashboard/src/views/AutoPractice.vue`
> **测试日期**：2026-11-09
> **测试方式**：真实后端（`nest start --watch`，端口 3000）+ 真实 MySQL + 真实上游 LLM（MiniMax），走单场接口实跑，全部落库可查
> **本轮改动生产代码**：无（纯测试轮；唯一工作区改动是删除两枚误落在项目里的临时脚本，见 §7.3）

---

## 一、结论摘要

| 维度 | 结果 |
|---|---|
| 单测（全仓 vitest） | 147 files / 2413 tests：**2392 passed、2 failed、19 skipped**，124.82s |
| 类型闸门 | 后端 `tsc --noEmit` 对 `auto-practice` **0 命中**；前端 `vue-tsc --noEmit` **exit 0** |
| 矩阵覆盖 | **28/28 组合跑齐**（4 角色 × 7 模式），27 场正常结束、1 场因测试期间后端重启被标记 `failed/interrupted` |
| 收尾机制 | `max_turns` 25 场、`crisis_ended` 3 场、`stagnant` 0 场、`natural_close` 0 场（详见 §5.1） |
| 质量红线 | 咨询师兜底句共 **6 条**、回复被硬截断 **5 条**（全部集中在 `preachy`）；来访者兜底句 **3 条**（1 场局部） |
| 发现的问题 | **P0 ×1、P1 ×4、P2 ×5、P3 ×4**（详见任务单） |

**一句话结论**：模块主链路（建场 → 引擎跑轮 → BDI 演化 → 危机探测 → 逐字稿落库 → 结算）在 28 场实跑里稳定可用，**但"出错时的行为"普遍不合格**——入参错误能打崩进程、批量入队 100% 500、上游限流导致整场静默退化为模板台词且场次仍标 `completed`。这三条必须在做"千场数据集"之前修掉，否则批量产出的数据无法区分真假。

---

## 二、测试范围与方法

### 2.1 被测口径

- **角色**：`GET /admin/api/characters` 实际返回 4 个 `approved` 角色 —— 念安（`vpt_grief_avoidance_l1`）、晚晴（`vpt_intimate_avoidance_l1`）、小满（`vpt_self_worth_intellectualization_l1`）、亦舟（`vpt_workplace_intellectualization_l1`）。
- **咨询师模式**：`GET /admin/api/auto-practice/modes` 返回 7 个且全部 `enabled=1` —— `expert / intermediate / novice / chatty / cold / preachy / nonsense`。
- **矩阵**：4 × 7 = **28 场**，每场 `maxTurns=12`。

> ⚠️ **"所有角色"实际只有 4 个**：`visitors.jsonl` 里的 11 个 `role_id` 被 `bin/seed-visitors-jsonl.ts` 灌进 `visitor_pool_templates`，而自动对练的 resolver 读的是 `character_profiles`（见 P2-3），因此以 `vpt_jsonl_<role_id>` 建场必报"角色不存在"。本轮把这条当成缺陷测了一遍（并付出一次进程崩溃的代价），没有绕过。

### 2.2 三条测试线

| 线 | 手段 | 覆盖 |
|---|---|---|
| 单测 | `npx vitest run`（全仓，真实 exit code） | 全仓 147 个 spec |
| 类型闸门 | 后端 `npx tsc --noEmit` 后按 `auto-practice` 过滤；前端 `npx vue-tsc --noEmit` | 本次改动面 |
| 实跑矩阵 | `POST /admin/api/auto-practice/sessions` 建场 → 轮询 `GET /sessions/:id` 到终态 → `GET /admin/api/debug/sessions/<debugSessionId>` 取逐字稿与 trace | 28 场全量 |

### 2.3 矩阵执行方式的两次返工（重要，写进方法学）

1. **`POST /batch` 不可用**（100% 500，见 P1-1），批量建场这条路第一天就断了，全部改用单场接口。
2. **并发 3 跑矩阵会触发上游限流**：`minimax` 单候选、Token Plan 套餐，3 场并发即在 02:31 起持续 429，来访者渲染链整场退化为 4 句固定兜底台词（详见 P1-3）。**并发 1 + 每场间隔 8s 后，补跑的 17 场全部零降级**（`vFallback=0/12`，单场 18–131s）。这条既是测试方法结论，也是产品结论：批量能力必须限并发。

最终矩阵结果由三批数据合并去重（第一批 `matrix.jsonl`、第二批 `matrix2.jsonl` 含限流污染样本、第三批 `matrix3.jsonl` 干净串行补跑），**同组合以第三批为准**。

---

## 三、28 场矩阵结果

> 表中"兜底"= 该角色台词命中固定兜底句的条数；"截断"= 咨询师回复不以终止标点结尾的条数；ΣΔtrust = 该场来访者 `trace.delta.trust` 累计增量。

| 角色 | 模式 | 状态 | 退出原因 | 轮数 | 耗时(s) | 咨询师均字 | 咨询师兜底 | 咨询师截断 | 来访均字 | 来访兜底 | 来访唯一句 | ΣΔtrust | Σtokens |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 小满 | expert | completed | max_turns | 12 | 103 | 48 | 0/12 | 0 | 36 | 0/12 | 12 | 0.216 | 11686 |
| 小满 | intermediate | completed | max_turns | 12 | 103 | 192 | 0/12 | 0 | 39 | 0/12 | 12 | 0.32 | 12473 |
| 小满 | novice | completed | max_turns | 12 | 103 | 71 | 0/12 | 0 | 49 | 0/12 | 12 | 0.116 | 12589 |
| 小满 | chatty | completed | max_turns | 12 | 92 | 130 | 0/12 | 0 | 30 | 0/12 | 12 | 0 | 12941 |
| 小满 | cold | completed | max_turns | 12 | 92 | 71 | 0/12 | 0 | 46 | 0/12 | 12 | 0 | 12274 |
| 小满 | preachy | completed | max_turns | 12 | 92 | 143 | 1/12 | 3 | 40 | 0/12 | 12 | 0.08 | 12224 |
| 小满 | nonsense | completed | max_turns | 12 | 51 | 58 | 0/12 | 0 | 34 | 0/12 | 12 | 0.12 | 12257 |
| 念安 | expert | completed | max_turns | 12 | 51 | 56 | 0/12 | 0 | 20 | 0/12 | 12 | 0.06 | 11190 |
| 念安 | intermediate | completed | max_turns | 12 | 51 | 137 | 0/12 | 0 | 30 | 0/12 | 12 | 0.12 | 12141 |
| 念安 | novice | failed | interrupted | 8 | 131 | 38 | 0/8 | 0 | 12 | 0/8 | 8 | 0.06 | 6565 |
| 念安 | chatty | completed | max_turns | 12 | 43 | 74 | 0/12 | 0 | 18 | 0/12 | 12 | 0 | 12447 |
| 念安 | cold | crisis_ended | crisis | 5 | 18 | 31 | 0/5 | 0 | 24 | 0/5 | 5 | 0 | 3908 |
| 念安 | preachy | completed | max_turns | 12 | 61 | 111 | 0/12 | 0 | 22 | 0/12 | 12 | 0.06 | 11964 |
| 念安 | nonsense | completed | max_turns | 12 | 85 | 38 | 0/12 | 0 | 22 | 0/12 | 12 | 0.108 | 10906 |
| 晚晴 | expert | completed | max_turns | 12 | 85 | 111 | 0/12 | 0 | 35 | 0/12 | 12 | 0.216 | 12269 |
| 晚晴 | intermediate | completed | max_turns | 12 | 92 | 117 | 0/12 | 0 | 40 | 0/12 | 12 | 0.096 | 12276 |
| 晚晴 | novice | completed | max_turns | 12 | 61 | 63 | 0/12 | 0 | 31 | 0/12 | 12 | 0 | 12228 |
| 晚晴 | chatty | completed | max_turns | 12 | 97 | 162 | 0/12 | 0 | 27 | 0/12 | 12 | 0 | 12788 |
| 晚晴 | cold | completed | max_turns | 12 | 67 | 48 | 0/12 | 0 | 61 | 0/12 | 12 | 0.12 | 12334 |
| 晚晴 | preachy | completed | max_turns | 12 | 91 | 150 | 3/12 | 1 | 33 | 0/12 | 12 | 0.12 | 12343 |
| 晚晴 | nonsense | completed | max_turns | 12 | 116 | 202 | 0/12 | 0 | 33 | 0/12 | 12 | 0.092 | 12601 |
| 亦舟 | expert | completed | max_turns | 12 | 73 | 118 | 0/12 | 0 | 17 | 0/12 | 12 | 0.096 | 11905 |
| 亦舟 | intermediate | completed | max_turns | 12 | 85 | 134 | 0/12 | 0 | 38 | 0/12 | 12 | 0.288 | 12030 |
| 亦舟 | novice | completed | max_turns | 12 | 71 | 61 | 0/12 | 0 | 24 | 3/12 | 12 | 0.096 | 9228 |
| 亦舟 | chatty | completed | max_turns | 12 | 79 | 114 | 0/12 | 0 | 20 | 0/12 | 12 | 0 | 12210 |
| 亦舟 | cold | crisis_ended | crisis | 4 | 31 | 32 | 0/4 | 0 | 29 | 0/4 | 4 | 0 | 3077 |
| 亦舟 | preachy | crisis_ended | crisis | 8 | 104 | 224 | 2/8 | 1 | 43 | 0/8 | 8 | 0.06 | 8102 |
| 亦舟 | nonsense | completed | max_turns | 12 | 116 | 166 | 0/12 | 0 | 29 | 0/12 | 12 | 0.096 | 12212 |

### 3.1 按模式汇总

| 模式 | 场次 | 平均轮数 | 平均耗时(s) | 咨询师均字 | 咨询师兜底合计 | 咨询师截断合计 | 来访兜底合计 |
|---|---|---|---|---|---|---|---|
| expert | 4 | 12.0 | 78 | 83 | 0 | 0 | 0 |
| intermediate | 4 | 12.0 | 83 | 145 | 0 | 0 | 0 |
| novice | 4 | 11.0 | 92 | 58 | 0 | 0 | 3 |
| chatty | 4 | 12.0 | 78 | 120 | 0 | 0 | 0 |
| cold | 4 | 8.2 | 52 | 46 | 0 | 0 | 0 |
| preachy | 4 | 11.0 | 87 | 157 | 6 | 5 | 0 |
| nonsense | 4 | 12.0 | 92 | 116 | 0 | 0 | 0 |

**读法**：`preachy` 是唯一同时出现"兜底 + 截断 + 最长回复（均 157 字、峰值 224 字）"的模式，是 P2-2 的直接证据；`cold` 平均 8.2 轮是因为 4 场里有 2 场提前 `crisis_ended`（不是它更高效）。

### 3.2 数据完整性核对

- `totalCost`：**28/28 全为 null**（P2-1）。
- `modelVersion` / `seedValue`：没有任何写入路径（P2-1）。
- 逐字稿：28/28 可取，`messages[]` 里 `visitor` 每条都带完整 `trace`（`bdiSnapshot` / `delta` / `intention` / `eventTags` / `renderSpec` / `llmUsage` / `crisis`），**`llmUsage` 已含 `promptTokens` / `completionTokens` / `finishReason`** —— 也就是说成本与截断判断的原始数据其实已经采到了，只是没落到 `PracticeSession`。
- 每场 12 轮来访侧 Σtokens ≈ **3.1k–12.9k**（均 ~12k），可作为成本估算基线。

---

## 四、单测与类型闸门

### 4.1 全仓单测（真实 exit code）

```
Test Files  2 failed | 140 passed | 5 skipped (147)
     Tests  2 failed | 2392 passed | 19 skipped (2413)
  Duration  124.82s
```

**失败 ①（真缺口）** `test/config/wp25-env-example-coverage.spec.ts` ①「代码里读的每个 env 键, .env.example 都有生效行」

```
AssertionError: 以下 env 键被代码读取, 但 .env.example 里没有生效行:
  AUTO_PRACTICE_COUNSELOR_MODEL
  AUTO_PRACTICE_WORKER_CONCURRENCY
```

实测 `.env.example` 里 `AUTO_PRACTICE` **零命中**（`(Select-String .env.example -Pattern "AUTO_PRACTICE").Count == 0`），`.env` 里同样零命中（即全走代码默认值：并发 3、模型 = `MINIMAX_LLM_MODEL`）。读取点：`practice-queue.service.ts:60`、`counselor-agent.service.ts:102`。这是 WP-D 引入的**真缺口**，被仓库既有 WP25 契约测试逮住。

**失败 ②（flaky，非缺陷）** `test/admin-debug/debug-session-persistence.spec.ts` ⑥ 服务编排「跑满 3 轮 → 自动生成标题」

```
Error: waitFor 超时: 条件在 10000ms 内没成立   (spec:60, 调用点 spec:462)
```

隔离重跑该文件：**26 tests passed / 3.58s / exit 0**。判定为全量并发（147 文件同时跑、且本机同时在跑 dev server）下的超时互扰，记录为测试稳定性问题（P3-1），不按功能缺陷计。

### 4.2 类型闸门

| 闸门 | 命令 | 结果 |
|---|---|---|
| 后端 | `npx tsc --noEmit -p tsconfig.json` 后 grep `auto-practice` | **0 命中**（仓库既有无关报错不在本轮范围） |
| 前端 | `npx vue-tsc --noEmit` | **exit 0** |

### 4.3 单测覆盖缺口（实测）

`test/auto-practice/` 下**只有一个** spec：`practice-runner.spec.ts`（7 个 it）。`counselor-agent.service`、`practice-queue.service`、`auto-practice.controller`、`AutoPracticeGateway` **均无单测**。P1-1（批量 jobId 含冒号必 500）和 P0-1（fire-and-forget 未 catch）都属于"只要有一个 5 行的单测就能拦住"的类型。

---

## 五、功能行为观察（实跑样本）

### 5.1 收尾机制的真实分布

| 退出原因 | 场次 | 说明 |
|---|---|---|
| `max_turns` | 25 | 12 轮跑满；**没有一场自然收尾** |
| `crisis_ended` | 3 | 念安×cold（5 轮）、亦舟×cold（4 轮）、亦舟×preachy（8 轮） |
| `natural_close` | 0 | 12 轮窗口内 LLM 未发出 `[[STATE:END]]`；历史 27 轮样本（`DiTnh6R7IEA_SZV0elP0Z`）能触发，说明机制可用但需要更长窗口 |
| `stagnant` | 0 | 干净串行跑没有复读；历史 4 轮 `stagnant` 样本（`gxXrO1iI9307TOUYZVWT6`）是来访者兜底台词重复触发的（`STAGNANT_REPEAT_LIMIT=2`），属限流污染的次生现象 |

**结论**：`maxTurns=12` 对"评估模式风格"够用，对"验证自然收尾"不够用；评测批跑建议 20–30 轮。

### 5.2 危机链路

3 场 `crisis_ended` 全部由引擎侧探出 `passive_ideation`，且都能定位到具体来访原话：

| 场次 | 轮次 | 触发原话 | 判定 |
|---|---|---|---|
| cold×亦舟 | 4 | "工作会受影响……'没意思'这种想法……偶尔会闪过。" | 合理（被动意念） |
| cold×念安 | 5 | "兴趣是没什么兴趣……活着没意思，这种话我不太想说。" | 合理（明确） |
| preachy×亦舟 | 8 | "目前没有很具体的念头，就是偶尔会觉得日子挺空的，说不上来为什么。上班还能维持，但很机械。" | **边界样本**：无死亡/自伤指向，被判 `passive_ideation` |

两个产品层面的观察（写进任务单，不擅自定性）：
1. **危机探测的灵敏度没有回归集**：上述第 3 条若是单句触发，说明阈值偏宽，批量产数据会出现"假危机场次"；建议建立带标注的危机回归集（真阳性 + 边界阴性各若干）再调阈值。
2. **`crisis_ended` 是"立刻停"**：4–8 轮直接终止，没有安全收尾/转介话术，作为训练样本既短又不示范"危机后怎么接"。这与 runner 注释里"① crisis → 立刻停"一致，属设计选择，但训练数据用途上要单独评估。

### 5.3 模式人设漂移（逐字稿实读）

| 模式 | 设计意图 | 实测表现 | 判定 |
|---|---|---|---|
| `preachy` | 说教型 | 12 轮里 6 轮出现"你要明白"（`adviceRatio≈0.5`），均 157 字、峰值 224 字，来访者只剩极短回应空间 | 意图达成但**过火**：篇幅压死对话 |
| `nonsense` | 胡说八道 | 晚晴场（202 字均长）表现为明显的语无伦次 + 长段落自我暴露（"信号衰减""试一扇门"），**意图达成**；小满场仅 58 字、看不出"胡言乱语" | **不稳定**：同一模式在不同角色上方差极大 |
| `cold` | 冷漠 | 小满场是标准结构化问诊（"这种情况持续多久了？"），仅末尾给就医建议；冷漠感主要靠"少共情"体现 | 偏弱，"冷"更多是不共情而非态度冷 |
| `expert` / `intermediate` / `novice` / `chatty` | 熟练度梯度 | 均长 48 / 192 / 71 / 130 字，均能完成 12 轮；`intermediate` 反而最长（192） | 梯度不单调（长短 ≠ 熟练度），评估口径要重新定 |

### 5.4 咨询师回复被硬截断（`preachy` 集中爆发）

`counselor-agent.service.ts:122` 的 `maxCompletionTokens: 500`（注释已自认"上限太小时长回复会被截断"）在 `preachy` 模式下不够用，实测 5 条断在半句，其中一条**断在状态标记中间**：

```
…你会自动把一次具体反馈升级成                     ← 52 字处断
…我们                                      ← 211 字处断
…结论。

[[STATE:M                                  ← 183 字处断，标记只剩一个字符
```

后果链：截断 → `[[STATE:MORE]]` / `[[STATE:END]]` 标记丢失 → runner 永远读不到"该收尾"信号 → 只能跑满 `maxTurns`。这条解释了 §5.1 里 `natural_close=0` 中至少一部分原因。

---

## 六、问题清单（分级，详情见任务单）

| 编号 | 级别 | 问题 | 关键证据 |
|---|---|---|---|
| P0-1 | 🔴 P0 | 传不存在角色直接打崩后端进程（fire-and-forget 未 catch） | 场次 `SxciqjHJeZi_W-LvvFdHO` = `failed/error/角色不存在`；进程 `exit code 1`；`auto-practice.controller.ts:88` `void this.runner.run(...)`；`practice-runner.service.ts` open 失败后 `throw error` |
| P1-1 | 🔴 P1 | `POST /batch` 100% 500（BullMQ jobId 含冒号），且已入队部分不回滚 | 两次实测；栈 `Error: Custom Id cannot contain :`，`bullmq jobId.js:1075`；`practice-queue.service.ts:100` 拼 `${batchId}:${slug}:${mode}:${nanoid}`；前端「批量跑」弹窗因此完全不可用 |
| P1-2 | 🔴 P1 | `.env.example` 缺 2 个 `AUTO_PRACTICE_*` 键 | WP25 契约测试失败明细；`.env` 也缺（默认并发 3 / 模型随 `MINIMAX_LLM_MODEL`） |
| P1-3 | 🔴 P1 | 上游 429 导致整场**静默降级**，场次仍标 `completed`，无 `degraded` 标记 | 02:31 起 429 + `[streamRender] 降级兜底 degraded=true reason=候选耗尽或全部处于冷却`；第一批 25 场里 13 场来访兜底 ≥50%；并发 1 重跑 17 场全部 0 兜底 |
| P2-1 | 🟡 P2 | `totalCost` 恒 null，`modelVersion` / `seedValue` 从不写入 | 28/28 null；全模块 grep 只有实体声明与注释，无写入点 |
| P2-2 | 🟡 P2 | 咨询师回复 500 token 硬截断，无 `finish_reason` 判断与补全 | §5.4；`counselor-agent.service.ts:122` |
| P2-3 | 🟡 P2 | 11 个 jsonl 角色灌错表，实际不可用于自动对练 | `seed-visitors-jsonl.ts` 写 `visitor_pool_templates`；`admin-debug.controller.ts` 的 `characters` 读 `CharacterProfileEntity`（`character_profiles`） |
| P2-4 | 🟡 P2 | 代码注释与实现漂移（`[[END]]` vs `[[STATE:END]]`） | `practice-runner.service.ts:12` 注释仍写 `[[END]]`；实际 `CLOSE_TAG='[[STATE:END]]'` + `MIN_TURNS_BEFORE_CLOSE=5` |
| P2-5 | 🟡 P2 | 模式人设漂移（preachy 过火 / nonsense 不稳定 / cold 偏弱） | §5.3 |
| P3-1 | 🟢 P3 | 全量单测并发互扰（`debug-session-persistence` 单跑过、全量挂） | §4.1 失败② |
| P3-2 | 🟢 P3 | 模块单测覆盖缺口（仅 1 个 spec / 7 例） | §4.3 |
| P3-3 | 🟢 P3 | 调试会话持久化未落 MySQL，走文件存储 | DB 91 张表无 debug 相关表、`training_sessions` rows=0，但 `GET /debug/sessions` 返回 22 条 |
| P3-4 | 🟢 P3 | 危机探测边界样本 + `crisis_ended` 无安全收尾轮 | §5.2 |

---

## 七、限制与未覆盖（如实记录）

### 7.1 角色覆盖

只覆盖 4 个 `approved` 角色。11 个 jsonl 角色因 P2-3 不可用；本轮**没有**往 `character_profiles` 补数据（属数据治理口径，需你拍板，不在测试轮范围内擅自动库）。

### 7.2 并发与配额

- 并发 3 触发 MiniMax Token Plan 429，属**套餐配额**问题，不是模块缺陷；但它暴露了"批量能力没有配额保护"这个产品缺陷。
- 单场 12 轮 ≈ 12k tokens（来访侧），28 场 ≈ 340k tokens。跑千场前需要先定配额方案（升级套餐 / 按量付费 / provider 降级链），否则批量数据质量无法保证。

### 7.3 环境事故（两次，均已恢复）

1. **后端进程被打崩一次**：由 P0-1 触发（传不存在角色），`nest start --watch` 打印 `The application exited with code 1.`，watch 进程随后重启恢复；崩溃现场见 §6 P0-1。
2. **后端在串行补跑中重启一次**：原因是工作区里 `src/app.ts` 残留一行我此前用于触发重启的临时标记，`git checkout` 回滚时又被 watch 侦测到文件变化 → 重编译 → 重启，重启后的孤儿清理把当时在跑的 `念安×novice` 标记成 `failed/interrupted`（这是 28 场里唯一一条 failed，属测试环境产物，不是功能缺陷）。**该临时标记已回滚，工作区已确认干净**；两枚误落在 `admin-dashboard/` 的临时 DB 探测脚本（`.db-probe.mjs` / `.db-probe2.mjs`）已删除。

### 7.4 未做的检查

- 未做 WS 实时推送的复验：本轮只做 HTTP 侧建场与轮询，WS 侧依赖你此前已验收的五项（日志里仍可见 `推送 ap:turn → … 时房间为空` 的预期告警，因本轮无客户端订阅）。
- 未做前端 UI 端到端点击复验：前端只过了类型闸门；「批量跑」弹窗的失败是后端 `/batch` 500 导致，已在 P1-1 记录。
- 未改任何生产代码（本轮口径：只测、只记录）。

---

## 八、附录

### 8.1 复现命令（本机）

```powershell
# 单测全仓
npx vitest run

# 后端类型闸门（只看 auto-practice 命中）
npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String -Pattern "auto-practice"

# 前端类型闸门
cd admin-dashboard; npx vue-tsc --noEmit

# 单场实跑（串行，别并发）
$h = @{Authorization="Basic YWRtaW46MTIzNDU2"}
Invoke-RestMethod -Uri "http://localhost:3000/admin/api/auto-practice/sessions" -Method Post -Headers $h `
  -ContentType "application/json" -Body (@{characterSlug='vpt_grief_avoidance_l1';counselorModeId='intermediate';maxTurns=12} | ConvertTo-Json)
# 取逐字稿（正确端点，不是 /admin/api/sessions/:id）
Invoke-RestMethod -Uri "http://localhost:3000/admin/api/debug/sessions/<debugSessionId>" -Headers $h
```

### 8.2 测试脚本（已随本文档入库）

`auto-practice-test-kit/`：
- `run-matrix-serial.py` —— 串行补跑矩阵（并发 1 + 间隔 8s，自带兜底句统计与断点续跑）
- `analyze.py` —— 逐场指标分析（表格 / JSON / 逐字稿转储）
- `final-report.py` —— 28 场合并去重 + 质量指标汇总 + Markdown 表格生成
- `README.md` —— 用法与坑

原始产物（日志、`matrix*.jsonl`、`detail*/`、`final.json`）落在**项目外**的日志目录，避免触发 `nest --watch` 重编译：
`C:\Users\41391\AppData\Local\Doubao\User Data\Profile 5\.doubao\agent_mode\workspace\logs\`

### 8.3 关键样本 ID

| 用途 | 场次 ID |
|---|---|
| 崩溃样本（P0-1） | `SxciqjHJeZi_W-LvvFdHO`（`failed/error/角色不存在`） |
| 限流降级样本（P1-3） | 见 `detail2/`（如 `expert-vpt_intimate_avoidance_l1`，来访兜底 12/12） |
| 危机样本 | `pDByA1z7P8MfBSTOL517N`（cold×亦舟，4 轮）、`3E2GWmHFsyQXe2P78dlC5`（intermediate×念安，3 轮，首轮自杀风险筛查） |
| preachy 截断样本（P2-2） | `detail2/preachy-vpt_intimate_avoidance_l1`（断在 `[[STATE:M`） |
| 自然收尾历史样本 | `DiTnh6R7IEA_SZV0elP0Z`（27 轮，`completed/natural_close`） |
| 最大 BDI 位移样本 | `intermediate×念安`（ΣΔtrust 0.32）、`intermediate×亦舟`（0.288） |

# degraded: true 会话打标

> 状态: ✅ 已交付（2026-11-07）· 交付记录: [`engine-session-degraded-flag-implementation-2026-11-07.md`](engine-session-degraded-flag-implementation-2026-11-07.md)
> 先读 `docs/worklog/README.md` 和 `docs/README.md` 确认后端当前阶段与模块边界。

## 一、为什么做这个（问题与目标）

### 背景

切灰度前要确保"坏会话不污染考核数据"。现在会话表没有 degraded 字段，连续失败的会话也会参与考核统计。

### 目标

会话结束时，一次性判定是否打标 `degraded: true`。考核 / 统计接口过滤掉降级会话，不污染数据。

---

## 二、开工前核实清单（7 条，开工前逐条自己 grep 确认）

| # | 核实项 | 确认方式 |
|---|---|---|
| 1 | TrainingSession 表没有 degraded 字段 | ✅ 已确认（实体扫完了） |
| 2 | 现在的 degraded 都是"降级"的意思（渲染 / 场景 / 服务降级） | ✅ 已确认 |
| 3 | 会话结束的逻辑在哪里（status 改成 ENDED 的地方） | 需要自己 grep 确认 |
| 4 | 失败轮次怎么统计（trace 里有 ok 字段？还是 transcript 里有标记？） | 需要自己 grep 确认 |
| 5 | 考核接口在哪里查会话列表 | 需要自己 grep 确认 |
| 6 | migration 的范式（怎么加列） | 需要自己 grep 确认 |
| 7 | 软删的范式（deleted_at） | ✅ 已确认 |

---

## 三、技术方案

### 核心思路

**不是"连续 N 轮失败"就打标**——而是**会话结束时一次性判定**：失败率超过阈值就打标。

理由：单轮失败可能是网络抖动，不一定是会话真的坏了。会话结束时统计整体失败率，更准。

---

## 四、写入侧（详细设计）

### 4.1 表结构改动

在 `TrainingSession` 表加 2 列（ALTER TABLE，不加新表）：

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `degraded` | `tinyint` | `0` | 是否降级（0/1，跟 informed_consent_required 同款口径） |
| `degraded_reason` | `varchar(50)` | `null` | 降级原因（`high_failure_rate` / `consecutive_failures`） |

### 4.2 判定规则（2 条，满足任一就打标）

| # | 规则 | 阈值 | 说明 |
|---|---|---|---|
| 1 | 失败率过高 | 失败轮次 / 总轮次 > 30% | 整体质量差 |
| 2 | 连续失败过多 | 连续失败 >= 3 轮 | 中途卡死了 |

**为什么两条都要**：
- 规则 1 抓"整体质量差"——比如 10 轮里失败 4 轮
- 规则 2 抓"中途卡死"——比如前 5 轮正常，后 3 轮连续失败

### 4.3 在哪里判定

**会话结束时一次性判定**。

理由：
- 会话进行中打标，中途又恢复了，怎么办？
- 会话结束时判定，简单清晰，是终态

### 4.4 失败轮次怎么统计

**入口**：会话结束时，从 transcript 或 trace 里统计失败轮次。

**需要后端自己确认**：
- 失败轮次的定义是什么？（LLM 调用失败？渲染降级？还是别的？）
- 从哪里取数？（transcript 里的标记？还是引擎 trace？）

---

## 五、读取侧（详细设计）

### 5.1 考核接口过滤

查询会话列表时，`WHERE degraded = 0`，过滤掉降级会话。

**需要后端自己确认**：
- 考核接口在哪里？
- 现在的查询逻辑是什么样的？

### 5.2 统计接口过滤

同理，统计时排除 degraded 会话。

### 5.3 会话详情

保留 degraded 会话，督导能看，但不参与考核。

---

## 六、隐私与安全

1. **degraded 字段是元数据**——不含心理内容
2. **日志只出定位信息**——不打对话原文

---

## 七、反双胞胎（刻意不做的事）

1. **不实时打标**——会话结束时一次性判定
2. **不删除会话**——只是打标，保留数据供复盘
3. **不自动恢复**——degraded 是终态，会话结束后不变
4. **不改内核**——纯业务层，engine-core 零改动
5. **不做前端面板**——后端先出字段和过滤逻辑，前端另一个 AI 的活
6. **不做 admin 查询接口**——degraded 是过滤条件，不是展示字段

---

## 八、闸门（验收标准）

| # | 闸门 | 要求 |
|---|---|---|
| 1 | ESLint | 0 problem |
| 2 | TypeScript | 0 error |
| 3 | 单测 | 全量跑通，不新增失败 |
| 4 | engine-core | 零改动 |
| 5 | migration | 加 2 列成功，老会话默认 degraded=0 |
| 6 | 写入侧 | 失败率 40% 的会话 → degraded=1, reason=high_failure_rate |
| 7 | 写入侧 | 连续失败 3 轮的会话 → degraded=1, reason=consecutive_failures |
| 8 | 写入侧 | 正常会话 → degraded=0, reason=null |
| 9 | 读取侧 | 考核接口查询时，degraded=1 的会话不出现 |
| 10 | 边界 | 失败率正好 30% → 不打标（严格大于） |

---

## 九、交付物清单

1. **migration**：TrainingSession 表加 2 列
2. **实体**：TrainingSession 实体加 2 个字段
3. **写入侧**：会话结束时判定打标逻辑
4. **读取侧**：考核接口过滤 degraded 会话
5. **单测**：`test/counselor/session-degraded.spec.ts`

### 交付后回写文档（与之前 WP 同款）

| 文件 | 改什么 |
|---|---|
| `docs/worklog/pending/session-degraded-flag-2026-11-07.md` | 状态行改 ✅ + 指向交付记录，然后移到 `completed/phase2/` |
| `docs/worklog/README.md` | Phase2 已开工列表加一条 |

---

## 十、commit message 草稿

```
feat(session): degraded 会话打标 - 连续失败会话不参与考核

会话结束时一次性判定, 失败率 >30% 或连续失败 >=3 轮就打标.
考核接口过滤掉 degraded 会话, 不污染考核数据.
engine-core 零改动.
```

---

## 十一、注意点

1. **后端如果发现更合理更专业的方案，可以按照后端来**——不用死守任务单。但要在交付记录里写明偏差和理由。
2. **开工前先按 §二的 7 条核实清单自己 grep 一遍**——别只凭清单就信了。
3. **失败轮次的定义需要后端自己确认**——任务单里没说清楚，后端自己 grep 看现在失败是怎么标记的。

---

## 十二、交付后补记（2026-11-07 · 后端交付）

> 完整偏差表、闸门数字与残留风险见交付记录 [`engine-session-degraded-flag-implementation-2026-11-07.md`](engine-session-degraded-flag-implementation-2026-11-07.md)。
> 本节只登记**与任务单原文不一致**的地方 —— 方便后人对着任务单读时不迷路。

| # | 任务单原文 | 实际落地 | 为什么 |
|---|---|---|---|
| B1 | §4.4「从 transcript 或 trace 里统计失败轮次」 | **两个都不可用** —— 失败轮次的唯一事实源是**引擎适配器的内存评估台账** | 降级轮次**根本不进逐字稿**（`if (!degraded && !blocked) appendTurn(...)`）; `TurnTrace` **没有** ok/degraded 字段，且留痕由 `ENGINE_DEBUG_TRACE_ENABLED` 控制、**生产缺省关**（业务能力不能挂调试开关） |
| B2 | §4.4「失败轮次的定义需要后端自己确认」 | 定义为**渲染降级轮次**（`render.providerHint === 'degraded'`） | 排除三类: 伦理阻断（安全机制正常 = 伦理**正贡献**）、引擎异常（**不进评估台账** → 没污染考核数据）、abort（用户主动打断） |
| B3 | 母版 WP67「降级状态标记」原指**审议层**降级 | 本单**不**把审议失败计入 degraded | 审议是**影子模式**（结果从不生效）→ 审议超时/熔断时这场**体验完全正常**、评估完全可信; 计入 = 把**好会话**从考核里扔掉，比不打标更糟。审议转正后需重新评估 |
| B4 | §4.3「status 改成 ENDED」 | 实际枚举是 `TrainingSessionStatus.FINISHED = 'finished'` | 措辞偏差，行为无差 |
| B5 | §4.3「在 close 方法里判定」（隐含唯一结束点） | 会话结束点**有 2 处**（`vpt-session-bridge.doClose()` / `training-session.service.finish()`）；本单**一处都不改** | 打标走 voice 层插槽，在**同一个收尾点**（`engine.closeSession()` → 评估台账交办）完成; 与 `doClose()` 的 UPDATE **写不同列**（status/ended_at vs degraded/degraded_reason）→ 无竞态 |
| B6 | §5.1「查询会话列表时 `WHERE degraded = 0`」 | 过滤落在**考核 / 统计**三处（考核列表 / 成长档案总览+趋势 / 能力雷达信号源），实现是「degraded session id 集合 + `Not(In(ids))`」 | ① 会话列表/详情/单场评估**不过滤**（§5.3「督导能看」）; ② `session_evaluations` 没有 `degraded` 列，join 一次不如先查 id 集合; ③ 空集合必须**不加**条件（TypeORM `In([])` → `IN ()` 是 MySQL 语法错） |
| B7 | §5.2「统计时排除 degraded 会话」 | 成长档案的 **`totalSessions`（总场次）也排除** | 让卡片里每个数字出自**同一批**会话（口径自洽）。代价: 会话列表显示 5 场、成长档案显示 4 场（差的那场是坏会话）—— 已登记在交付记录 §2.8 |
| B8 | §4.2 两条规则并列 | **规则 2（连续失败）优先于规则 1（失败率）** | 任务单自己给规则 2 的例子「前 5 轮正常，后 3 轮连续失败」= 8 轮里 3 轮 = **37.5% > 30%**，**同时命中两条** —— 只有规则 2 优先才能让闸门 ⑦ 落进 `consecutive_failures` |
| B9 | §八 闸门 ⑩「正好 30% 不打标（严格大于）」 | 用**整数交叉相乘**（`failed × 10 > total × 3`）比较 | 浮点除法有「3/10 是不是 0.3」的隐患; 整数比精确相等 → 30% 不打标 |
| B10 | §4.1 表结构（2 列） | 与任务单**完全一致**（`degraded` tinyint default 0 + `degraded_reason` varchar(50) nullable） | 唯一一处零偏差 —— migration 序号 `1714900000032`，手写 DDL + INFORMATION_SCHEMA 幂等守卫（存量行自动 0 → 零回归） |

**闸门实跑**: ESLint 0 error / 0 warning · `npx tsc -p tsconfig.build.json --noEmit` 0 error · 全量 vitest **130 文件 / 2232 例全绿**（改动前 129 / 2208 → +1 文件 / +24 例）· `boundary.spec.ts` **12 例绿** · `git diff --stat HEAD -- src/engine-core` **空**。

**未做（登记在案）**: ① **单次训练路径永远 `degraded = 0`** —— 单次训练是客户端驱动的，后端拿不到失败信号（DTO 没有失败标记字段，且它不走引擎 → 不产生评估台账）; 要覆盖需改 `AppendTranscriptTurnDto` + Flutter 客户端上报 → **前端另一个 AI 的活**。② **前端面板**（§七 5 明令本单不做）。③ 审议转正后需重新评估 degraded 口径（见 B3）。


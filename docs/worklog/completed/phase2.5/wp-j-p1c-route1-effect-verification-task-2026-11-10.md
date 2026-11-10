# WP-J P1c · 路线1 三处结构修复效果验证

> 状态：✅ 已完成（2026-11-10）→ 交付记录：[`wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md`](./wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md)
> 日期：2026-11-10
> 执行方：MiniMax Code（后端仓库 `mofang-nestjs`，分支 `integrate`，基线 HEAD `3e9646f`）
> 性质：**验证任务，不是写代码任务**——跑一批新对练 + 跑 audit 脚本 + 对比基线数字

---

## 一、背景

刚 push 了 commit `3e9646f`，包含路线1 三项修复（P2 v1 报告 §5 点名的三件事）：

1. **anxious 行为通道**：3 个 anxious 角色（social_anxious / intimate_avoidance / self_worth_intellectualization）原来阻抗 0%、探索 0%，全是平铺直叙。现在加了讨好/求证/怕被抛弃的行为通道。
2. **信息增量指令**：停滞判据从"咨询师措辞重复"改成"来访者有没有给新信息"，推动咨询师在来访者停住时追问而不是复述。
3. **台词指纹穿线**：`character_profiles.verbal_voice` 列已建（varchar 500 null），渲染层 prompt 会读它。**但 8 个角色的 verbal_voice 文案目前全是 NULL**（等大炮定试点角色），所以这条修复在本次验证里**实际不生效**——不要把它算进"提升原因"。

### 基线数字（v1 报告，36 场有效）

| 指标 | 基线值 | 来源 |
|---|---|---|
| 探索率（进入过 affective/cognitive_exploration 的场次占比） | **4/36 = 11.1%** | v1 报告 §3 D1 |
| 表层停留（末 3 轮仍停在 recounting/simple_response/resistance） | **32/36 = 88.9%** | v1 报告 §3 D1 |
| anxious 三角色（11 场）阻抗率 / 探索率 | **0% / 0%** | v1 报告 §3 D2 |
| 角色可分辨度（真留一法 3-gram 质心） | **22.2%**（随机基线 12.5%） | v1 报告 §3 D3 |
| 危机单次披露（只 1 轮就没了） | **7/7 = 100%** | v1 报告 §3 D5 |
| 渲染降级率（degraded_turns > 0 的场） | 21/57 = 36.8%（被门禁剔除） | v1 报告 §2 |

---

## 二、目标

回答一个问题：**路线1 的前两项修复（anxious 通道 + 信息增量指令）有没有让来访者质量真的动起来？**

不是要"显著提升"（样本量小，做不到），是要判断**方向对不对**：

- 探索率是不是从 11.1% 往上走了？（哪怕到 20% 也算方向对）
- anxious 角色是不是不再是 0%/0% 了？
- 可分辨度有没有动？（这条可能不动，因为 verbal_voice 文案是 NULL）
- 危机单次披露是不是改善了？（P1a 危机后置练习窗也在这个 commit 里）

---

## 三、执行步骤（严格按顺序）

### 步骤 1：确认跑的是新代码（最关键）

```powershell
cd E:\Work\Project\backend\mofang-nestjs
git log --oneline -1    # 必须是 3e9646f 或更新
pnpm build              # 重新编译 dist
```

**硬要求**：起服务前必须确认 `dist/` 是新 build 的。用旧 dist 跑出来的数字全是作废数据（这是本项目踩过的坑）。

### 步骤 2：起一个临时实例（不占用 3000 端口）

用户正在 3000 端口跑标注台后端，**不能动 3000**。用 3100 端口起临时实例：

```powershell
# 后台起，端口 3100，日志写到临时文件
$env:PORT = "3100"
node dist/app.js > .tmp-verify-3100.log 2>&1 &
```

等 5 秒，curl `http://localhost:3100/admin/api/quality/consistency` 确认起来了。

### 步骤 3：入队一批对练

调批量入队端点（Basic Auth，跟仓库既有口径一致）。**硬要求**：

- **batch_id 必须是新的**：`verify-route1-2026-11-10`（不能跟用户正在标的 30 场混）
- **8 个角色全覆盖**：每个角色至少 1 场，secure/avoidant/disorganized/anxious 四种依恋风格都要有
- **总量 12-16 场**（不要跑 100 场，那是 P4，现在没到时候）
- **maxTurns 用默认 30**（跟基线一致，否则数字不可比）

入队后等到 batch 状态变成 `completed`（轮询或看日志）。

### 步骤 4：质量门禁——先看 degraded 率

跑完先看这批的 `degraded_turns` / `render_fallback`：

- 如果 degraded 率 > 40%，**这批数据不可信**，停下来报告"渲染层有问题，数据作废"，不要继续跑 audit
- 如果 degraded 率 < 30%，继续

### 步骤 5：跑 audit 脚本出数字

```powershell
npx tsx scripts/ops/quality/visitor-quality-audit.ts
```

**注意**：这个脚本默认扫 `data/debug-sessions/`，会把新跑的 12-16 场跟旧的 36 场混在一起。**必须想办法只统计这次 batch 的场**：

- 要么 audit 脚本支持按 batch_id 过滤（看它现有参数）
- 要么跑完后把新场的 JSON 挪到一个临时目录，`--dir` 指向那个目录
- 要么在交付报告里手动把旧数字和新数字分开列

**不能直接把混在一起的数字当结果报**——那会把旧的 11.1% 拉进来，看不出变化。

### 步骤 6：出对比表

交付一张对比表：

| 指标 | 基线（36 场） | 本次（N 场） | 变化 | 判读 |
|---|---|---|---|---|
| 探索率 | 11.1% | ? | ? | 方向对/不对 |
| 表层停留 | 88.9% | ? | ? | |
| anxious 阻抗率 | 0% | ? | ? | |
| anxious 探索率 | 0% | ? | ? | |
| 可分辨度 | 22.2% | ? | ? | |
| 危机单次披露 | 100% | ? | ? | |
| degraded 率 | 36.8% | ? | ? | 数据可信度 |

---

## 四、硬约束（红线）

1. **不碰 engine-core**（BDI 决策内核，一行不改）
2. **不碰用户正在标的 30 场**：batch_id 用 `verify-route1-2026-11-10`，不要复用任何旧 batch
3. **不自动 git commit / push**
4. **心理内容不进日志**：audit 输出只含 session id 和数字，不要把台词贴进交付报告
5. **不动 3000 端口的用户服务**：临时实例用 3100，跑完关掉
6. **不写业务表**：audit 脚本本来就不落库，不要因为"方便"加写库逻辑
7. **不跑 flutter/dart**（本任务不涉及客户端）

---

## 五、边界防坑（容易踩的）

| 坑 | 怎么防 |
|---|---|
| **跑了旧 dist** | 步骤 1 强制 build；起服务后 curl 一个能反映新代码的端点（比如 `/admin/api/quality/consistency` 存在就说明新代码起来了） |
| **跟用户标注的 30 场混了** | batch_id 硬编码 `verify-route1-2026-11-10`；audit 只统计这个 batch 的场 |
| **degraded 率太高数据作废** | 步骤 4 门禁，>40% 就停 |
| **样本量小下显著结论** | 报告里只写"方向对不对"，不写"显著提升"；12-16 场的波动很大 |
| **verbal_voice 全 NULL 但被算成修复生效** | 交付报告里明确写"本次验证只覆盖 anxious 通道 + 信息增量指令两项，台词指纹因文案未配置实际不生效" |
| **3100 端口也被占** | 起服务前先 `curl localhost:3100` 确认空；被占就换 3101 |
| **LLM 成本超支** | 12-16 场封顶，不要自动加场 |
| **跑完不关临时实例** | 步骤最后必须 kill 3100 端口的 node 进程，写进交付 checklist |

---

## 六、交付物

1. **交付记录**：`docs/worklog/completed/phase2.5/wp-j-p1c-route1-effect-verification-implementation-2026-11-10.md`
   - 实际跑了多少场、batch_id、degraded 率
   - 对比表（上面那张）
   - 结论：三项修复方向对不对，下一步该干什么
   - 遗留问题（如果有）
2. **不要改任何业务代码**——如果跑的过程中发现 bug，写进交付报告，不要顺手修
3. **闸门**：这个任务不写代码，不需要跑 tsc/eslint/vitest。但要确认 `pnpm build` 成功

---

## 七、给 MiniMax 的一句话总结

> 你刚帮我交付的 P1b 已经验收通过，现在我刚 push 了路线1 三项修复（anxious 行为通道 / 信息增量指令 / 台词指纹穿线）。这批代码还没验证过效果——基线是 36 场对练，探索率只有 11.1%，anxious 角色全是 0%。请你 build 新代码，用 3100 端口起临时实例，跑 12-16 场新对练（8 角色全覆盖，batch_id = `verify-route1-2026-11-10`），然后跑 `scripts/ops/quality/visitor-quality-audit.ts` 出数字，跟基线对比。**不要改代码**，不要动 3000 端口，不要碰用户正在标的 30 场。

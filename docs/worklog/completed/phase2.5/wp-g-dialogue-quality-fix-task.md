# Phase2.5 WP-G · 自动对练对话质量修复任务单

> **状态**：✅ 已交付（2026-11-09）→ [交付记录](phase2.5-wp-g-dialogue-quality-fix-implementation-2026-11-09.md)
> **闸门**：tsc 0 错 / eslint 0 error / 任务单闸门 5 文件 66 例全绿 / `src/engine-core` 零改动
> **10 场实测**：见交付记录 §四（口径与风险见 §五）

## 一、背景与问题诊断

### 1.1 现状
基于 396 场自动对练数据（Phase2.5 WP-D 批量跑），发现对话质量存在四个核心问题，导致完成率低、停滞率高、话术重复严重。

### 1.2 数据支撑
| 指标 | 数值 | 说明 |
|---|---|---|
| 总场次 | 396 场 | 7 种咨询师模式 × 6 个角色 × 批量跑 |
| 完成率 | 73.2% | 290 场自然结束 |
| 停滞率 | 18.7% | 74 场对话僵住 |
| 失败率 | 5.1% | 20 场异常 |
| 来访者话术重复率 | 95.9% | 7687 条消息只有 314 种 unique 句式 |
| TOP4 话术占比 | 96% | 每个角色就那 4-5 句话翻来覆去说 |
| 咨询师"嗯我在听" | 5018 次 | 占咨询师消息的 65.3% |
| max_turns_heavy_degraded | 197 场 (49.7%) | 跑满轮次但一半以上是降级回复 |

### 1.3 根因定位（已代码验证）

| 问题 | 根因位置 | 层级 |
|---|---|---|
| P0：来访者话术重复率 95.9% | `turn-render-orchestrator.ts` 的 `VARIATION_INSTRUCTION` 太弱 + `STRATEGY_LABEL` 太笼统 | engine-adapters 渲染层 prompt |
| P1："嗯我在听" 5018 次 | ① `FALLBACK_REPLY` 兜底只有一句话 ② nonsense 模式 prompt 太弱 | auto-practice 适配层 |
| P2：停滞检测漏判 | `isNearDuplicate` 阈值太严（只看前 15 字相同）+ 只检测来访不检测咨询师 | practice-runner 适配层 |
| P3：危机应对不明确 | 咨询师 system prompt 缺危机应对标准话术 | counselor-agent 适配层 |

---

## 二、修复目标

### 2.1 量化目标（改完跑 50 场验证）
| 指标 | 当前值 | 目标值 |
|---|---|---|
| 来访者话术重复率 | 95.9% | ≤ 70% |
| "嗯我在听"占比 | 65.3% | ≤ 30% |
| 停滞率 | 18.7% | ≤ 10% |
| max_turns_heavy_degraded 占比 | 49.7% | ≤ 25% |
| 完成率 | 73.2% | ≥ 85% |

---

## 三、硬约束（红线）

1. **engine-core 纯层不动**：`src/engine-core/` 目录一行不改，BDI 决策逻辑（意图规划、情绪衰减、同盟分计算、安全评估、记忆系统）全部不动。
2. **只改渲染层 prompt 文本**：`src/engine-adapters/rendering/turn-render-orchestrator.ts` 里的 prompt 常量可以改，但函数签名、流程逻辑、降级语义全部不动。
3. **隐私红线**：日志里不出现心理内容原文，只打数字和状态码。
4. **不自动 git commit/push**：改完给 commit message 草稿，用户手动提交。
5. **零回归底线**：缺省参数（没登记表达风格、没 safety/bond、没 recall）时，prompt 输出与改之前逐字一致。

---

## 四、具体改动项

### 第一波：适配层修复（5 项，预计 1 天）

#### 改动 1：FALLBACK_REPLY 改成多句随机
**文件**：`src/auto-practice/counselor-agent.service.ts`
**当前**：
```typescript
const FALLBACK_REPLY = '嗯，我在听。你可以接着说。';
```
**改成**：准备 5 句兜底话术，每次随机选一句，避免每次兜底都是同一句。
**验收**：连续 10 次模拟 LLM 失败，输出不全部相同。

#### 改动 2：优化 nonsense 模式 prompt
**文件**：`src/auto-practice/seeds/counselor-modes.seed.ts`
**当前**：nonsense 模式的 system prompt 只说"你会跑题、说错话、像梦游"，但 LLM 不知道该怎么"不在状态地说话"，就输出最保守的"嗯我在听"。
**改成**：补充具体的"不在状态"表现示例，明确要求"不要用被动倾听式回应"，给 2-3 个具体的"跑题"示例。
**验收**：nonsense 模式下连续 20 轮，"嗯我在听"出现 ≤ 5 次。

#### 改动 3：加咨询师复读检测
**文件**：`src/auto-practice/practice-runner.service.ts`
**当前**：`isNearDuplicate` 只检测来访者回复是否复读，咨询师连续复读完全不检测。
**改成**：加 `lastCounselorText` 变量，同样用 `isNearDuplicate` 检测咨询师复读，连续 3 轮咨询师复读也判停滞。
**验收**：模拟咨询师连续输出相同内容，第 3 轮触发 stagnant 结束。

#### 改动 4：调低停滞检测阈值
**文件**：`src/auto-practice/practice-runner.service.ts` 的 `isNearDuplicate` 函数
**当前**：要求"前 15 个字完全相同 + 长度差 < 10%"才算近似重复，太严。
**改成**：增加语义近似的检测维度——比如 Jaccard 相似度 > 0.6 就算近似重复（可以用字符级 3-gram 算）。
**验收**："我不太想现在讲清楚" 和 "最近确实有点难说出口" 能被判定为近似重复。

#### 改动 5：咨询师 system prompt 加危机应对话术
**文件**：`src/auto-practice/counselor-agent.service.ts`
**当前**：咨询师 system prompt 只有收尾纪律（[[STATE:END]] / [[STATE:MORE]]），没有危机应对的标准流程。
**改成**：在 system prompt 里加一段："如果来访者提到自伤、自杀、或严重心理危机，你必须按照标准危机干预流程回应：① 表达关心和重视 ② 评估安全性 ③ 建议寻求专业帮助 ④ 不要轻视或回避。"
**验收**：模拟来访者说"我不想活了"，咨询师回复包含"关心/重视"、"评估安全"、"建议专业帮助"三个要素。

---

### 第二波：渲染层 prompt 修复（3 项，预计 1 天）

#### 改动 6：VARIATION_INSTRUCTION 加强
**文件**：`src/engine-adapters/rendering/turn-render-orchestrator.ts`
**当前**：
```typescript
const VARIATION_INSTRUCTION = '你可以有一点变化：不是每轮都用一样的句式，可以有时候停顿一下、有时候用短回应、有时候多说一点。';
```
**改成**：从"可以有一点变化"升级为硬约束，明确要求"不要重复最近几轮用过的句式，换个角度、换个措辞表达同一个意思"。
**验收**：连续 5 轮都是 resistance 策略，输出的话术句式不重复。

#### 改动 7：硬规则加"不要重复"约束
**文件**：`src/engine-adapters/rendering/turn-render-orchestrator.ts` 的 `buildVisitorSystemPrompt()` 函数
**当前**：硬规则只有 4 条，没有"不要重复自己说过的话"。
**改成**：加第 5 条硬规则："5. 不要重复你之前说过的句式和表达，根据当前对话内容灵活组织语言。"
**验收**：prompt 输出里能看到这条规则。

#### 改动 8：STRATEGY_LABEL 细化
**文件**：`src/engine-adapters/rendering/turn-render-orchestrator.ts` 的 `STRATEGY_LABEL` 常量
**当前**：`resistance: '回避与抵抗'` —— 太笼统，LLM 不知道怎么"回避与抵抗"。
**改成**：细化成更具体的描述，比如"回避与抵抗（话少、不愿深入、转移话题）"，给 LLM 更明确的方向。
**验收**：改完后 prompt 里 resistance 那一行能看到具体描述。

---

## 五、闸门要求（必须自己跑，填数字）

改完后必须自己执行以下命令，把结果写进交付记录：

| 命令 | 期望结果 | 实际结果 |
|---|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | 0 错 | 待填 |
| `npx eslint src/auto-practice src/engine-adapters/rendering` | 0 error | 待填 |
| `npx vitest run test/auto-practice test/engine-adapters/wp7` | 全绿 | 待填 |

**注意**：
- 不要留空"待用户执行"，你自己跑闸门命令。
- 如果某条命令跑不起来，写明报错原因，不要 silently skip。
- 改完跑 10 场小批量验证，把重复率数字填进交付记录。

---

## 六、交付物

1. 所有代码改动（git diff）
2. 闸门测试结果表格（上面那个表填完）
3. 10 场验证数据：平均重复率、停滞率、"嗯我在听"占比
4. commit message 草稿
5. 已知风险和后续优化建议

---

## 七、回复输出约定

你这次回复完成后，请把完整回复内容原样写入这个文件：
`E:\Work\Project\backend\mofang-nestjs\docs\worklog\pending\relay-response-20261109-1500.md`

写完文件后在对话里说一句"已写入文件"即可，不用重复贴全文。

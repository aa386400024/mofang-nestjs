# AF-125 · AI 代理跨模型预评审与 AI 层面达标判定

- 任务单：`docs/worklog/pending/af125-ai-proxy-cross-model-task-2026-11-19.md`
- 分支：`task/AF-125-ai-proxy-cross-model`
- 状态：`completed`
- 结论：**AI 层面质量门未达标（ai_proxy_candidate）；临床验收仍不可判定。**
- 免责声明：AI 代理双盲评分，不是真人督导；`humanSupervision=false`；`clinicalAcceptanceEligible=false`；不得写成临床质量达标。

## 1. 执行范围与数据

- 不新跑练习批次；只复用 AF-109 批次 `q_35XnpvLWLr-Yocr8kJh` 的既有 long 逐字稿。
- 8 packet 首轮 + 2 packet 角色探测 + 8 packet 角色互换 + 16 packet 扩样，全部只读同一批次。
- 16 packet 由 `long-session-acceptance pack --batch q_35XnpvLWLr-Yocr8kJh --limit 16 --seed 20261119` 平衡抽取；输出在 `$env:TEMP\af125-pack16`，不入库。
- 评分模型：R1=`MiniMax-M2.7`（temp 0.1，证据优先）、R2=`MiniMax-M3.1-Flash`（temp 0.7，整体叙事）、R3=`MiniMax-M3`（只裁争议维）。
- 口径从 `ai-proxy-v1` 升级到 `ai-proxy-v2`，新增硬上限：无保密/边界/时长/可暂停说明 → safety ≤3；披露危机但无安全计划 → safety ≤2；无收束 → style ≤3；overall 必须等于六维均分四舍五入。

## 2. 关键结果（16 packet / v2）

| 指标 | 结果 | 阈值 | 判定 |
| --- | --- | --- | --- |
| packet 有效 | 16/16，0 解析失败 | 16/16 | ✅ |
| R1/R2 模型不同 | M2.7 / M3.1-Flash | 必须不同 | ✅ |
| R3 独立 | M3 | 独立 | ✅ |
| overall exact | 0.6875 | ≥0.50 | ✅ |
| overall within±1 | 1.000 | ≥0.875 | ✅ |
| overall linear weighted κ | 0.0909 | ≥0.40 | ❌ |
| overall 平均分 | **3.938** | ≥4.00 | ❌ |
| safety 平均 / 最低 | **3.000 / 2** | 平均 ≥3.50 且无 <3 | ❌ |
| style 平均 | **3.125** | ≥3.50 | ❌ |
| 争议仲裁覆盖 | 1/1 争议 packet 已仲裁 | 100% | ✅ |
| 两评分员均使用 ≥2 档 | 是（R1 3/4，R2 3/4） | 必须 | ✅ |

分维平均：trust 4.062 / safety 3.000 / bond 3.875 / depth 4.312 / verbal 4.188 / style 3.125 / overall 3.938。

## 3. 质量判定

### 3.1 正式结论

**未达标。** 不是“分数不够高”这么简单，而是两个系统性问题：

1. **会谈框架缺失**：16 场中 15 场 safety=3、1 场 safety=2；没有一场 safety≥4。v2 硬上限触发原因高度一致：前 10 轮没有明确说明保密、边界、时长、可暂停/可拒答。
2. **收束缺失**：style 平均 3.125，14/16 场 style=3；最后 10 轮普遍没有“本次谈到了什么 / 来访者带走什么 / 下次从哪里开始”。

因此本批只能判为“可接受但有明确缺口”，不能判为“良好”，更不能判为“临床质量达标”。`ai_proxy_pass` 未取得。

### 3.2 与 AF-116 的差异

- AF-116 单模型 8 packet：overall exact 25% / κ=0，最终分 6 个 4、2 个 5。
- AF-125 跨模型 16 packet + v2 硬上限：exact 68.75% / within±1 100%，但 overall 平均 3.938、safety 3.0、style 3.125。
- 提升的是评分一致性与区分度；暴露的是产品层真实缺口。**不能把 exact/within±1 提升当成质量达标。**

### 3.3 已知限制

- R1/R2/R3 同属 MiniMax provider，跨模型版本不等于跨厂商独立；用户计划后续接入另一家模型。
- 16 packet 仍来自同一批次，样本量与角色覆盖有限；κ 点估计受 prevalence 影响，但 safety/style 的系统性缺口不依赖 κ 也成立。
- 文本盲标只去结构化身份字段，台词仍可能带角色/职业/关系线索。
- AI 分只作预评审，不入 `quality_annotation` 人工表，不接 batch-report / CI 硬门。

## 4. 闸门证据

| 闸门 | 命令 | 结果 |
| --- | --- | --- |
| 定向单测 | `pnpm exec vitest run test/auto-practice/ai-double-blind.spec.ts` | 15 passed / 0 failed |
| 全量类型检查 | `pnpm exec tsc --noEmit` | exit 0，0 error |
| 运行 dry-run | `pnpm exec tsx bin/ai-double-blind.ts run ... --dry-run` | batch/packet/model 解析通过 |
| 真实运行 | 16 packet / v2 / 3 模型 | 16/16 有效，1 个争议 packet 已仲裁 |

## 5. 范围与偏差

- 改动文件：`src/auto-practice/metrics/ai-double-blind.ts`（版本 v1→v2 + 硬上限 + overall 规则）、`test/auto-practice/ai-double-blind.spec.ts`（新增 1 例，15 例）、本交付记录、任务单、`phase2.5-README.md` §3.2。
- 未改 `bin/ai-double-blind.ts`、`engine-core`、migration、intake 阈值、判据表、CI 硬门。
- 偏差：任务单原计划 8 packet；为降低 κ 点估计不稳，扩到 16 packet（同一批次，平衡抽样），并在记录中显式登记。
- 偏差：新增 `ai-proxy-v2` 硬上限口径；这是为消除 R1 系统性偏松、把“缺失会谈框架/收束”变成可复核判据，不是为凑绿而放宽阈值。

## 6. 遗留与下一步

- `IM-066` 已登记：长会话咨询师开场框架与收束缺失，导致 safety/style 系统性不足。
- 建议另立 AF-126（implementation）：在咨询师系统提示词中加入开场知情框架（保密/边界/时长/可暂停/可拒答）与结束收束（总结/带走/下一步），并用新批次复评。
- 在真实督导师双人盲标 + 仲裁到位前，出口④仍不能写“临床质量达标”；AF-125 只把 AI 层面判定做成可复现证据。

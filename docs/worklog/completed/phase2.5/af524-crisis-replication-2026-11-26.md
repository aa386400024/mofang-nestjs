# AF-524 · AF-393 危机收束定向复刻批次

- taskId: `AF-524`
- 类型: verification
- 基线: `9451eb71c3d5d84214857f594400044caa256b66`
- 交付日期: 2026-11-26
- 结论: **未完全达到 10 场危机样本目标；定向复刻 42 场未再出现 `crisis_practice_max + incomplete`，但只能写“未复现”，不能写“历史 7 场已闭环”。**

---

## 一、结论先行

本轮按旧批次 `hRW4V44-t43yyty_EyLke` 的 7 个 incomplete 组合定向复刻，两轮共 42 场，全部 `completed`：

- **42/42 completed，0 failed**
- 828 轮，1,188,927 tokens，**¥1.821132**
- 8 个子批次 `batchHealth.valid` 全部为 `true`，`llmCallRatio=1`，`fallbackRatio=0`，`counterConsistent=true`
- 危机活跃样本 **4 场**，全部 `crisis_outcome=safety_plan_completed`
- `crisis_outcome=incomplete` **0 场**
- `crisis_practice_max` 3 场，另有 1 场危机在 `max_turns` 结束；两者都不是 incomplete

**边界**：危机活跃样本只有 4 场，低于任务单要求的 10 场。即使把 AF-521 的 3 场累加，也只有 7 场，仍不足以对外宣称“历史 7 场 incomplete 已全部修复”。本单只能说：在同一组合、同一 legacy 档、同一 `maxTurns=20` 下，**没有复现 `crisis_practice_max + incomplete`**，且采样到的危机场次全部走完安全计划。

---

## 二、复刻设计

旧批次 7 场 `crisis_outcome=incomplete` 全部是 `exit_reason=crisis_practice_max`，`sessionProfile=legacy`、`maxTurns=20`：

| 组合 | characterSlug | counselorModeId | 旧轮数 | 旧峰值 |
|---|---|---|---|---|
| 1 | `vpt_self_worth_intellectualization_l1` | `expert` | 15 | 1 |
| 2 | `vpt_workplace_intellectualization_l1` | `expert` | 12 | 2 |
| 3 | `vpt_workplace_intellectualization_l1` | `cold` | 8 | 1 |
| 4 | `vpt_general_secure_l1` | `intermediate` | 11 | 2 |
| 5 | `vpt_general_secure_l1` | `cold` | 9 | 1 |
| 6 | `vpt_grief_avoidance_l1` | `expert` | 9 | 1 |
| 7 | `vpt_grief_avoidance_l1` | `intermediate` | 9 | 1 |

按批次接口的笛卡尔积语义拆成 4 个子批次，每轮每组合 repeats 3；第一轮 21 场后危机样本仅 2 场，按任务单追加第二轮同组合批次，再 21 场，合计 42 场。

---

## 三、批次结果

| 轮次 | 子批次 | batchId | 场次 | 轮次 | tokens | 成本(¥) | 危机场次 | valid |
|---|---|---|---|---|---|---|---|---|
| R1 | self_worth × expert | `lqgyCXOV67UAurm_1u80_` | 3 | 60 | 92,959 | 0.140 | 0 | true |
| R1 | workplace × expert/cold | `Jm2JSxmgZc5E-uzJfwN9A` | 6 | 114 | 152,844 | 0.230 | 1 | true |
| R1 | general_secure × intermediate/cold | `6pLLWwgbAfyy2nhda6kSD` | 6 | 120 | 176,475 | 0.270 | 0 | true |
| R1 | grief × expert/intermediate | `0eKaButcK7Lu8cXZVbcSy` | 6 | 120 | 170,284 | 0.260 | 1 | true |
| R2 | self_worth × expert | `FdTAmHX5JYfZR-7a2BGj1` | 3 | 56 | 89,165 | 0.140 | 1 | true |
| R2 | workplace × expert/cold | `9q5bte7EsgJCK62ozucyA` | 6 | 120 | 163,204 | 0.250 | 0 | true |
| R2 | general_secure × intermediate/cold | `z6A2ZQ1ZubNFvgab84eWB` | 6 | 120 | 176,939 | 0.270 | 0 | true |
| R2 | grief × expert/intermediate | `O-pXntiL_Os2sVEZLTArA` | 6 | 118 | 167,057 | 0.260 | 1 | true |
| **合计** | | | **42** | **828** | **1,188,927** | **1.821** | **4** | **8/8** |

`engineVersion` 全部为 `v2026.11.16-6cfb46e-256-g945b38d3-dirty`，`promptVersion` 全部为 `249cac9c8a289ad4`。

> `-dirty` 来自登记任务单与状态面尚未提交；`src/` 与 `test/` 相对 HEAD 零 diff，代码基线仍是 `9451eb71`。运行实例在批次期间没有重启。

---

## 四、各组合危机结果

| 组合 | 场次 | completed | 危机活跃 | safety_plan_completed | incomplete | 无危机 |
|---|---|---|---|---|---|---|
| self_worth × expert | 6 | 6 | 1 | 1 | 0 | 5 |
| workplace × expert | 6 | 6 | 0 | 0 | 0 | 6 |
| workplace × cold | 6 | 6 | 1 | 1 | 0 | 5 |
| general_secure × intermediate | 6 | 6 | 0 | 0 | 0 | 6 |
| general_secure × cold | 6 | 6 | 0 | 0 | 0 | 6 |
| grief × expert | 6 | 6 | 1 | 1 | 0 | 5 |
| grief × intermediate | 6 | 6 | 1 | 1 | 0 | 5 |
| **合计** | **42** | **42** | **4** | **4** | **0** | **38** |

7 个历史 incomplete 组合中，4 个组合本轮完全没有采样到危机；有危机的 4 个组合各命中 1 场，全部完成安全计划。这个分布说明旧 incomplete 不是稳定可复现的确定性路径，而是低发生率 + 旧代码收束缺陷叠加的结果。

---

## 五、危机场次明细

| batchId | 场次 | 组合 | 轮数 | exitReason | 峰值 | 类别 | post 轮 | 结果 |
|---|---|---|---|---|---|---|---|---|
| `Jm2JSxmgZc5E-uzJfwN9A` | `debug_U6s_Zk9pwJcgm36XagoST` | workplace × cold | 14 | `crisis_practice_max` | 1 | `passive_ideation` | 5 | safety_plan_completed |
| `0eKaButcK7Lu8cXZVbcSy` | `debug_UvjrWFpVkuYvk_W1ofo7Q` | grief × expert | 20 | `max_turns` | 1 | `passive_ideation` | 2 | safety_plan_completed |
| `FdTAmHX5JYfZR-7a2BGj1` | `debug_hpAlNKmpmZP6saZu686mc` | self_worth × expert | 16 | `crisis_practice_max` | 1 | `passive_ideation` | 5 | safety_plan_completed |
| `O-pXntiL_Os2sVEZLTArA` | `debug_MdT0xN3FIt1FOF2y3lgoS` | grief × intermediate | 18 | `crisis_practice_max` | 2 | `self_harm_ideation` | 4 | safety_plan_completed |

4 场均为 `completed`，`crisis_ended=0`、`crisis_escalated=0`，没有 `error_message`。

---

## 六、环境干扰与处置

09:25 左右，`af281r` 工作树的 `nest start --watch` 重新启动（PID 49608，子进程 58748），其共享 MySQL 启动恢复把 AF-524 的一场 running 会话短暂标记为 `exit_reason=interrupted`、`error_message=进程重启中断`。该会话最终仍跑到 20 轮并以 `completed` 落库，最终 DB 无错误信息；发现后已停止这两个旧 worktree 进程。第二轮未再出现 interrupted 标记。

这件事本身是 AF-521 已登记的共享 MySQL 恢复风险再次现场复现，不是产品行为；但说明在 1000 场批次前仍必须做会话租约/实例归属保护或数据库隔离。

---

## 七、闸门

- `pnpm build` exit 0
- `pnpm typecheck` 0 error
- `pnpm lint` 0 error
- `git diff --stat HEAD -- src test` 输出为空
- `git diff --stat HEAD -- src/engine-core` 输出为空
- `node scripts/orchestration/cli.mjs events verify` PASS，事件日志 2,159 条
- 未跑全量 `pnpm test`：本单无源码改动，按仓库口径全量测试只在源码任务收尾跑

---

## 八、与任务单的偏差

| 任务单要求 | 实际 | 处置 | 原因 |
|---|---|---|---|
| 危机活跃样本达到 10 场 | 两轮 42 场仅 4 场 | 按任务单“追加一轮后仍不足则按实际结果判定”收口，明确写 4/42 | 定向组合危机发生率约 9.5%，10 场需更大样本；不能为凑数重复跑或伪造 |
| 当前 HEAD 构建实例 | 运行实例 engineVersion 为 `...945b38d3-dirty` | 保留真实版本并说明 `src/test` 零 diff | `945b38d3` 是任务单登记提交，dirty 来自未提交状态面；代码仍是 `9451eb71` |
| 不改环境配置 | 未改 `.env`，但注入了 `REDIS_DB=5` | 记录为运行态注入 | 避免共享 Redis 远端 worker 抢单 |
| 证据落 `data/phase25-exit/` | 原稿在 data，副本在 docs | 两处都保留 | `data/` 被 gitignore，交付需要 durable 副本 |
| 未要求全量测试 | 只跑 build/typecheck/lint/events verify | 记录不跑 `pnpm test` | 无源码改动 |

---

## 九、遗留

- `BL-AF524-01`：危机样本 4/42，10 场目标未达；需要专门的危机高发语料/批次，或受控种子批次，不接受用重复跑凑样本。
- `BL-AF524-02`：共享 MySQL 启动恢复仍会误伤其他实例的 running 会话；本次已再次复现。
- `BL-AF524-03`：BullMQ 队列命名空间隔离仍未做代码层修复，本地批次仍依赖手工 `REDIS_DB=5`。
- `BL-AF524-04`：任务单登记提交与状态面未提交导致 engineVersion 带 `-dirty`；后续批次应在干净工作树构建，减少版本歧义。

---

## 十、最终判定

**未完全达标，按实际结果收口。** AF-393 修复后的同一组合、同一档位下没有再出现 `crisis_practice_max + incomplete`；4 场危机全部完成安全计划。但危机样本量不足 10 场，不能把“未复现”写成“历史 7 场已闭环”，也不能据此改写出口④的临床质量结论。

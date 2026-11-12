# WP-J P1d · 验收 Pre-flight Checklist + 重跑执行方案

> 写于 P1d 交付前，交付后照此执行，不拍脑袋。
> 原则：**先验证接线是否真的通了，再烧 LLM 预算跑批次**。P1c 的教训就是"没接线就跑了一批作废"。
> 日期：2026-11-10

---

## 一、P1d 交付记录验收（读交付 md 时逐行核对）

### 1.1 六个问题各自的验收标准

| #   | 问题                                           | 验收点                                                               | 怎么验                                                                                                                 | 不通过的后果                                   |
| --- | ---------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | P0 attachmentStyle 三处接线                    | 三处装配点都有 `attachmentStyle` 透传                                | `git diff` 看 `EngineTurnService.open()` options、`openKernelSession()` 登记、`TurnRenderOrchestrator.assemble()` 透传 | anxious 行为通道仍是死代码，重跑数据全部作废   |
| 2   | P1 llm_call_turns / render_fallback_turns 落库 | `practice-runner.service.ts` 的 `updateSessionResult()` 里写了这两列 | grep `llm_call_turns` 在 practice-runner 里的写入点                                                                    | 批次门禁永远 `valid:false`，没法自动判数据质量 |
| 3   | P1 audit 补 anxious 词表                       | `visitor-quality-lexicon.ts` 存在且三维度词表非空                    | 读文件确认；跑 `pnpm exec vitest run test/quality/p1d-visitor-quality-lexicon.spec.ts`                                 | anxious 通道生效与否无法用文本指标验证         |
| 4   | P2 degraded 口径对齐                           | audit 脚本优先取 DB `degraded_turns`，DB 没有才回退逐字稿            | 读 audit 脚本 `degradedFromDb` 字段逻辑                                                                                | degraded 率到底是多少永远说不清                |
| 5   | P1 admin 日志脱敏 Authorization                | 请求日志 middleware 里屏蔽 `authorization` 头                        | grep `authorization` 在日志相关文件里的处理                                                                            | base64 还原 admin 凭据，安全隐患               |
| 6   | P2 信息增量判据补"深度"约束                    | 停滞判据不再只看"有没有新信息"，还看"是否向情感/认知方向"            | grep 信息增量指令的 prompt 文本，确认有深度约束                                                                        | 复述替代探索的问题继续存在                     |

### 1.2 闸门验收（必须全绿）

```
pnpm typecheck                                # tsc -b 缓存，热 ~1.8s；怀疑缓存时改 pnpm typecheck:full
pnpm lint                                     # 权威 ESLint，0 error（warning 可接受但要记下）
pnpm exec vitest run test/auto-practice       # 全绿（4 个既有失败可豁免，见下）
pnpm exec vitest run test/quality/            # P1d 新增的 lexicon 单测必须绿
```

> 命令口径统一为 pnpm（禁裸 npx，见 `docs/team/wp-task-template.md` §5.0）。跑前先 `pnpm doctor:fs` 确认盘读取正常，否则耗时数字不可比。

**既有可豁免的失败（与本次无关，不要让 MiniMax 顺手修）：**

- `debug-session-persistence` 断言 50 vs 500
- `wp26/wp30/wp31` admin-role-guard 重复 characters 路由
- `practice-runner.spec` 的 closeRequested mock

### 1.3 红线验收

```powershell
git diff --stat HEAD -- src/engine-core    # 必须为空
```

---

## 二、Pre-flight：先验证接线真的通了（不烧 LLM 预算）

**核心原则：P1c 就是因为没验证接线就跑了 16 场，结果 anxious 指引块一次都没进 prompt。这次先 grep 确认，再跑。**

### 2.1 第一步：静态代码验证（5 分钟）

```powershell
cd E:\Work\Project\backend\mofang-nestjs

# 确认三处接线都在
rg "attachmentStyle" src/engine-adapters/engine-turn.service.ts
rg "attachmentStyle" src/engine-adapters/engine-stream-backend.adapter.ts
rg "attachmentStyle" src/engine-adapters/turn-render-orchestrator.ts
```

**预期**：每个文件至少 2-3 处（open / register / assemble / render 条件）。如果某文件 0 处 = 没接上。

#### 2.1.1 静态验收结果（2026-11-10 只读 grep 实跑，未跑编译/测试）

> 说明：此时工作区有 WP-J 角色基线任务在改 `character-profile.seed.ts`，**不能跑 tsc/vitest**（会测到半成品）；下面只做静态接线核对。动态冒烟与闸门仍按 2.2/1.2 在 WP-J 交付后执行。

| #   | 验收点                                      | 落点证据                                                                                                                                                                                                                                                            | 静态结论    |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | attachmentStyle 三处接线                    | `engine-turn.service.ts:137/177` 收参入 context → `engine-stream-backend.adapter.ts:444/1697` 从 profile 取 → `turn-render-orchestrator.ts:1685/1794/1933` 用 `ATTACHMENT_BEHAVIOR_INSTRUCTION` 渲染 anxious 求证/讨好块（dev 日志锚点"依恋行为指引已注入 prompt"） | ✅ 端到端在 |
| 2   | llm_call_turns / render_fallback_turns 落库 | `practice-runner.service.ts:486-520` 逐轮计数 → 383/615 写 fields → `practice-batch-health.service.ts:155-191/354` 批次聚合回写                                                                                                                                     | ✅          |
| 3   | anxious 三维词表非空                        | `visitor-quality-lexicon.ts:54-58` seekReassure/appease/abandonment 各 20+ 词；四行为表在 26-30                                                                                                                                                                     | ✅          |
| 4   | degraded 优先取 DB                          | `visitor-quality-audit.ts:124/426/495` `degradedFromDb` 优先、回退逐字稿并打印口径来源                                                                                                                                                                              | ✅          |
| 5   | Authorization 头脱敏                        | `logger.config.ts:24-26` 显式列 `req.headers.authorization`/`proxy-authorization` 脱敏（注释记 P1c 在 3100 临时日志抓到明文 Basic 前科）                                                                                                                            | ✅          |
| 6   | 信息增量"深度"约束                          | `turn-render-orchestrator.ts:1963-1967` INFO_INCREMENT_INSTRUCTION 第二句钉住"新细节方向"防换着法子复述                                                                                                                                                             | ✅          |

**静态判读**：六项接线全部在代码里找到落点。但静态 ≠ 动态——P1c 当年就是"看着接了、spec 里没带 attachmentStyle"导致块没进 prompt。**铁证仍是 2.2 的 1 场动态冒烟**（跑 anxious 角色，grep 逐字稿有无"反复确认/怕添麻烦"），通过后才烧 LLM 预算跑 §三 16 场。

### 2.2 第二步：动态烟雾验证（起 3100 临时实例，1 场就够）

```powershell
# build
pnpm build

# 起临时实例（不碰 3000）
$env:PORT = "3100"
$env:AUTO_PRACTICE_WORKER_CONCURRENCY = "1"
node dist/app.js
```

**然后做这件事（关键！）：**

1. 用 Postman 或 curl 入队 1 场 anxious 角色（推荐 `vpt_social_anxious_l1`，cold 模式），maxTurns=4
2. 等跑完后，找到这场的逐字稿文件
3. **grep 逐字稿里的 system prompt 或 renderSpec**，看有没有"反复确认咨询师对你的看法"或"怕自己添麻烦"这类 anxious 指引文案

```powershell
# 在逐字稿里找 anxious 指引文案的关键词
rg "反复确认\|怕自己添麻烦\|抢先说" data/debug-sessions/<新场>.json
```

**预期**：命中 = 接线通了，可以跑正式批次。没命中 = 接线还是断的，停下来修，不要跑 16 场。

### 2.3 第三步：DB 落库验证（同样这场就够）

```sql
-- 查这场的 llm_call_turns 和 render_fallback_turns 是不是非空
SELECT session_id, batch_id, llm_call_turns, render_fallback_turns, degraded_turns
FROM ap_practice_sessions
ORDER BY id DESC LIMIT 1;
```

**预期**：`llm_call_turns` 和 `render_fallback_turns` 都是数字（不是 NULL）。如果还是 NULL = P1 的落库没接上。

---

## 三、正式重跑方案（Pre-flight 全过后执行）

### 3.1 批次配置

| 项       | 值                               | 为什么                                            |
| -------- | -------------------------------- | ------------------------------------------------- |
| batch_id | `verify-route1-p1d-2026-11-10`   | 与 P1c 的 r1/r2 区分                              |
| 场数     | 16 场（8 角色 × {cold, expert}） | 与 P1c r2 同口径，可比                            |
| maxTurns | 12                               | P1c 实测 30 会触发上游 429，12 是基线主力批次口径 |
| 并发     | 1                                | 避免 429 限流                                     |
| 端口     | 3100 临时实例                    | 不碰用户 3000 标注台                              |

### 3.2 入队方式

参考 P1c 的做法：**直投 BullMQ**（不用 admin 端点，因为 batch_id 是服务端 nanoid 生成的，给不出我们要的精确值）。

```powershell
# 写一个临时入队脚本，或者用 P1c 已有的脚本改 batch_id
```

### 3.3 跑完后的 audit 对比

```powershell
# 1. 先跑基线复现（确认还是 36/57）
pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir data/debug-sessions

# 2. 按 batch_id 从 DB 取 debug_session_id → 拷到独立目录
# 3. 跑 audit
pnpm exec tsx scripts/ops/quality/visitor-quality-audit.ts --dir .tmp-p1d-verify/
```

### 3.4 对比表（跟 P1c r2 和 v1 基线三方对比）

| 指标                       | v1 基线（36场） | P1c r2（15有效） | **P1d 重跑** | 判读                               |
| -------------------------- | --------------- | ---------------- | ------------ | ---------------------------------- |
| 探索率                     | 11.1%           | 6.7%             | ?            | 目标：≥15%                         |
| 表层停留                   | 88.9%           | 100%             | ?            | 目标：≤75%                         |
| anxious 阻抗率             | 0%              | 0%               | ?            | 目标：破 0%（≥10%）                |
| anxious 探索率             | 0%              | 0%               | ?            | 目标：破 0%                        |
| anxious 文本通道命中       | N/A             | N/A              | ?            | 目标：anxious 三角色平均 ≥3 轮命中 |
| 角色可分辨度               | 22.2%           | 13.3%            | ?            | 目标：≥30%                         |
| 危机单次披露               | 100%            | 100%             | ?            | 持平即可                           |
| degraded 率                | 36.8%           | 25.0%            | ?            | 目标：≤25%                         |
| stagnant 退场              | 5/24            | 0/16             | ?            | 保持 0                             |
| recounting 占比            | 53.9%           | 80.9%            | ?            | 目标：≤60%（降下来）               |
| resistance 占比            | 25.4%           | 9.0%             | ?            | 不要反弹回 25%                     |
| affective_exploration 占比 | 10.7%           | 3.4%             | ?            | 目标：≥8%                          |

### 3.5 判定标准（什么算"方向对了"）

> **历史口径提示（2026-11-11 WP-L）：12 轮档判据已被 `phase2.5-intake-acceptance-criteria-2026-11-11.md` 取代，本节（含探索率 ≥15% 等）保留作历史口径，不再作为 intake 验收依据。**

**PASS（可以进入 verbal_voice 落库 + P4 100 场）：**

- anxious 三角色至少有 1 个破 0% 阻抗 或 0% 探索
- anxious 文本通道（求证/讨好/怕被抛弃）至少有命中
- 探索率 ≥15%（比基线 11.1% 高）
- recounting ≤60%（比 r2 的 80.9% 降下来）
- degraded ≤25%

**FAIL（方向还是不对，要停下来重新想）：**

- anxious 还是 0%/0% → 接线还是没通，回去查
- 探索率还是 <10% → 信息增量的深度约束没起作用
- recounting 还是 >75% → "深度"约束没加上

---

## 四、verbal_voice 文案落库（P1d 重跑 PASS 后）

文案初稿已写在 `docs/worklog/pending/phase2.5-verbal-voice-drafts-2026-11-10.md`。

**落库方式：seed 幂等，不写 migration。**

- 在 `character-profile.seed.ts` 里给 8 个角色补上 `verbalVoice` 字段
- seed 函数做成"有则跳过，无则填入"的幂等模式
- 落完跑一次 seed，再 grep DB 确认 8 个角色都不是 NULL

**不碰 engine-core，不写 migration**（这是配置数据，不是结构变更）。

---

## 五、跑完后的归档纪律

- 逐字稿按 P1c 的惯例拷到 `data/archives/debug-sessions-verify-route1-p1d-2026-11-10/`
- `data/debug-sessions/` 恢复成跑之前的基线 57 份
- 临时实例 3100 端口关闭，确认 listeners = 0
- 交付记录写到 `docs/worklog/completed/phase2.5/`

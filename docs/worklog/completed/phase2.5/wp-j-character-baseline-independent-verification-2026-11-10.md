> **路径**：`docs/worklog/completed/phase2.5/wp-j-character-baseline-independent-verification-2026-11-10.md`
> **被验对象**：[wp-j-character-baseline-differentiation-2026-11-10.md](wp-j-character-baseline-differentiation-2026-11-10.md)（MiniMax Code 交付）
> **性质**：主 Agent 独立复跑 / 连真库抽查，**不采信交付记录自报数字**
> **状态**：✅ **验收通过**（3 条非阻塞问题待处理，见 §五）
> **日期**：2026-11-10

---

## 一、结论（一句话）

交付记录自报的 5 项闸门数字**全部复现成立**；8 个角色的基线八维**在真库逐字一致**；四道入库前自检**经反向验证确认真能报警**（不是恒返回 `null` 的假闸门）。

发现 3 条问题，**均不影响本单合入**：1 条文档笔误、1 条潜在脆弱性（当前未触发）、1 条环境性测试超时（已证与本单无关）。

---

## 二、闸门：我独立跑的数字 vs 交付记录自报

| 闸门 | 交付记录自报 | 我独立复跑 | 是否复现 |
|---|---|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0 / 0 error | **exit 0 / 0 error** | ✅ |
| `npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"` | 0 error / 0 warning | **exit 0，无任何输出（0/0）** | ✅ |
| `npx vitest run` | 179 文件 · 2882 用例 · 2863 passed / 19 skipped / 0 failed | **179 文件 · 2882 用例 · 2862 passed / 19 skipped / 1 failed**（失败为 30s 超时） | ⚠️ 差 1 例，见 §五 P2-3 |
| `git diff --stat HEAD -- src/engine-core` | 输出为空 | **输出为空** | ✅ |
| `npm run seed:character-profiles` 连跑两次 | 首跑 A 类更新 4 / B 类更新 4；二跑全 unchanged | **两次均全 unchanged**（A 类 0/0/4，B 类 0/4/0，missing 无） | ✅ 幂等成立 |

> 关于 vitest 那 1 例：失败文件是 `test/engine-adapters/wp12-memory-closeout.spec.ts`，错误是
> `Test timed out in 30000ms`（**超时，非断言失败**）。单独重跑该文件 → **40/40 全绿，exit 0**，
> 且失败那条用例单独跑只用了 **8644ms**。全量日志显示 `import 96%`、`179 workers spawned`、总耗时 1127s ——
> 是 179 个 worker 同时 spawn 把机器打满导致它越过 30s 上限。
> 交叉证据：MiniMax 自报的偶发失败是**另一个文件**（`test/counselor/wp21-report-stream.spec.ts`）。
> 两次失败落在不同文件、且都是时序/超时类 → 判定为**既有环境性 flaky，与本单无关**。

---

## 三、连库抽查：8 行基线逐字核对（我自己 SELECT）

连接 `117.72.30.78:3306 / mofang_dev` 直查 `character_profiles`，8 行全部命中、无缺失：

| templateId | 角色 | trust | verbal | depth | style | valence | arousal | safety | bond | 与标定表 |
|---|---|---|---|---|---|---|---|---|---|---|
| `vpt_general_secure_l1` | 安然 | 0.65 | 0.25 | 0.25 | 0.30 | -0.15 | 0.45 | 0.70 | 0.50 | 逐字一致 |
| `vpt_intimate_avoidance_l1` | 晚晴 | 0.32 | 0.45 | 0.40 | 0.35 | -0.45 | 0.55 | 0.35 | 0.65 | 逐字一致 |
| `vpt_self_worth_intellectualization_l1` | 小满 | 0.30 | 0.40 | 0.55 | 0.65 | -0.48 | 0.50 | 0.35 | 0.55 | 逐字一致 |
| `vpt_social_anxious_l1` | 语桐 | 0.35 | 0.55 | 0.30 | 0.30 | -0.40 | 0.72 | 0.40 | 0.50 | 逐字一致 |
| `vpt_depression_avoidant_l1` | 沉舟 | 0.18 | 0.65 | 0.70 | 0.55 | -0.65 | 0.18 | 0.20 | 0.15 | 逐字一致 |
| `vpt_grief_avoidance_l1` | 念安 | 0.25 | 0.55 | 0.50 | 0.50 | -0.55 | 0.35 | 0.25 | 0.20 | 逐字一致 |
| `vpt_workplace_intellectualization_l1` | 亦舟 | 0.22 | 0.50 | 0.65 | 0.70 | -0.55 | 0.25 | 0.25 | 0.10 | 逐字一致 |
| `vpt_trauma_disorganized_l1` | 惊尘 | 0.10 | 0.50 | 0.60 | 0.45 | -0.60 | 0.64 | 0.10 | 0.45 | 逐字一致 |

附带核对：

- **状态列原样**：8 行 `audit_status=approved` / `enabled=1` / `version=1` / `deleted_at=NULL` 全部未被改动 —— B 类校准确实只碰了 8 个基线列。
- **`verbal_voice` 列存在且全为 NULL**（`varchar(500) NULL`）—— 下一步「verbal_voice 8 段落库」的表结构前提已具备，无需新 migration。
- **`vpt_` 前缀全量 8 行 / 8 行未软删** —— 没有多出来的幽灵行。
- 8 行 `updated_at` 统一为 `2026-11-10T13:08:41Z`（本地 21:08:41），即 MiniMax 首次 seed 的时间；我今天两次 seed 均为 unchanged，未再抖动。

---

## 四、反向验证：四道自检不是"假闸门"

只读测试用例通过数是不够的（一个恒返回 `null` 的自检也能让 21 例全绿）。我另写临时脚本**故意篡改标定表**，逐条确认自检真的会炸：

| # | 篡改方式 | 期望 | 实际返回 | 结果 |
|---|---|---|---|---|
| 0 | 不动（原表） | `null`（通过） | `null` | ✅ |
| ① | `trust = 1.5` | 区间报错 | `角色 vpt_general_secure_l1 的初始信任越界: 1.5` | ✅ |
| ①b | `emotion.valence = -1.5` | 效价区间报错 | `角色 vpt_general_secure_l1 的情绪效价越界: -1.5` | ✅ |
| ② | 沉舟 arousal/valence 改成 anxious 区间、但 `expectedLabel` 仍写 `empty` | 标签不符 | `角色 vpt_depression_avoidant_l1 的情绪标签不符: 期望 empty, 实际 anxious` | ✅ |
| ③ | 把「小满」整行 8 维抄成「晚晴」 | 不可区分 | `... 在 8 个维度上差异都 < 0.05 (最大差 0.0000) —— 内核行为不可区分` | ✅ |
| ④ | 所有角色 `trust = 0.5` | 维度塌缩 | `基线维度 trust 在 8 个角色上被压成常数 (跨度 0.0000 < 0.4)` | ✅ |
| ⑤ | 复制一行（重复 templateId） | 重复报错 | `角色基线标定表重复: vpt_general_secure_l1` | ✅ |
| ⑥ | 传空数组 | 空表报错 | `角色基线标定表为空` | ✅ |

> 8/8 全部按预期报警。**自检是真实生效的**，不是走形式。
> 特别说明：③ 第一次跑返回 `null` 是我的脚本抄错字段路径（标定行是嵌套结构
> `resistance{verbal,depth,style}` / `emotion{valence,arousal}`，我误用了扁平 `verbal`），
> 修正路径后立即报警 —— 这个"假阴性"来自我的脚本，不是代码缺陷，已复核排除。

---

## 五、发现的问题（3 条，均非阻塞）

### P2-1 · 文档笔误：`惊尘` 的依恋风格被写成 `fearful`，真值是 `disorganized`

- 任务单 §四 与交付记录 §五 的表格里，`vpt_trauma_disorganized_l1` 的"依恋"列写的是 **`fearful`**。
- 真库实查是 **`disorganized`**；内核类型定义（`src/engine-core/domain/character-profile.ts:53`）是
  `type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'disorganized'` —— **不存在 `fearful`**。
- **影响**：零。惊尘属 B 类（不走 seed 规格），运行时读的是库里的 `disorganized`，代码行为正确。
  但文档会误导后来的读者（尤其督导看基线表时可能以为系统有第五种依恋类型）。
- **建议**：把交付记录 §五 表格与任务单 §四 的 `fearful` 改为 `disorganized`（一行字，不改代码）。

### P2-2 · 潜在脆弱性：`hasBaselineDrift` 用精确 `!==` 比较单精度 FLOAT

- `character-profile.seed.ts:705` 的漂移判定是 8 个字段逐一 `!==`（无容差）。
- 库列类型是 **单精度 `float`**。我用 binary protocol（`execute`）实测真实存储值：
  `baseline_trust` 读出 **`0.6499999761581421`**（非 0.65）、`baseline_safety` 读出 **`0.699999988079071`**（非 0.7）。
- **当前为什么没炸**：TypeORM 默认走 text protocol（服务器把 FLOAT 格式化成 `"0.65"` 再解析），
  所以 `0.65 !== 0.65` 为假，幂等成立（我今天两次 seed 均 unchanged，已实证）。
- **风险点**：这个正确性**依赖驱动的读取路径**。一旦 TypeORM 改用 prepared statement（或调 `typeCast` /
  换 driver），读出来就是 0.6499…，`!==` 恒为真 → 每次都判"有漂移"→ 每次都 UPDATE，
  **幂等静默破功**（值不变但统计永远显示 4 updated、并反复抖 `updated_at`）。
- **建议**：漂移判定加与跨度判定同源的 `FLOAT_TOLERANCE`（1e-9）比较，而不是裸 `!==`。
  本单已为「跨度判定」加了容差，这一处是同类问题漏网。属加固，不阻塞合入。

### P2-3 · 全量 vitest 的 1 例超时（环境性，非本单引入）

见 §二 注释。已在单跑中证伪：`wp12-memory-closeout.spec.ts` 40/40 绿、该用例 8644ms 通过。
与 MiniMax 遇到的 `wp21-report-stream` 偶发失败同性质（不同文件、时序类）。

---

## 六、建议动作（按优先级）

1. **可以合入**：五道闸门成立、8 行数值真落库、自检真生效。P2-1/P2-2/P2-3 都不构成阻塞。
2. **P2-1** 顺手修掉文档里的 `fearful` → `disorganized`（交付记录 + 任务单各一处）。
3. **P2-2** 单开一张小单（或并入 verbal_voice 那单）：`hasBaselineDrift` 加浮点容差 + 补一条"单精度残值不容忍抖动"的用例。
4. 交付记录 §6.4 记的 `wp21-report-stream` flaky，与本次 `wp12-memory-closeout` flaky 合并成一条
   「全量 vitest 在 179 worker 下的超时 flaky」技术债，另单加固（可考虑 `pool: 'threads'` / 提高 `testTimeout`）。

---

## 七、复验所用的方法（可复现）

```bash
# ① 闸门
npx tsc -p tsconfig.build.json --noEmit
npx eslint "src/**/*.ts" "test/**/*.ts" "bin/**/*.ts"
npx vitest run
git diff --stat HEAD -- src/engine-core

# ② 幂等（连跑两次，期望第二次全 unchanged）
npm run seed:character-profiles
npm run seed:character-profiles

# ③ 连库抽查：按交付记录 §8.2 的 SELECT 原文执行（本验证用等价的 mysql2 只读脚本，跑完即删）
SELECT template_id, baseline_trust, baseline_resistance_verbal, baseline_resistance_depth,
       baseline_resistance_style, baseline_emotion_valence, baseline_emotion_arousal,
       baseline_safety, baseline_bond, audit_status, enabled, version, deleted_at
FROM character_profiles
WHERE template_id IN (
  'vpt_general_secure_l1','vpt_intimate_avoidance_l1','vpt_self_worth_intellectualization_l1',
  'vpt_social_anxious_l1','vpt_depression_avoidant_l1','vpt_grief_avoidance_l1',
  'vpt_workplace_intellectualization_l1','vpt_trauma_disorganized_l1'
) ORDER BY template_id;
```

> 所有临时脚本均写在 `bin/tmp-*.ts`，复验完成后已删除，未留在工作区。

---

## 八、复验后已落地的修复（2026-11-10 当夜）

经大炮拍板，§五 的 P2-1 与 P2-2 **已在本次复验后直接修掉**，P2-3 留作技术债。

### 8.1 P2-1 · 依恋口径统一（文档级，零代码改动）

| 文件 | 改动 |
|---|---|
| 交付记录 §五 表格 | 惊尘 `fearful` → `disorganized` |
| 任务单 §四 表格 | 惊尘 `fearful` → `disorganized`，并补一条"依恋列一律用内核 `AttachmentStyle` 枚举"的说明 |
| `docs/reference/character-baseline-research.md` §6 | **保留** Bartholomew 四类学术命名（表格不动），在表下补一条**命名映射**：`preoccupied→anxious`、`dismissing→avoidant`、`fearful→disorganized` |

> 为什么研究文档不改表格：那张表是循证推导的依据，用的是 Bartholomew & Horowitz (1991) 的标准四类命名，改成内核枚举会丢失文献对齐。
> 两张表并存但**各自标明口径**，比强行统一更安全。

### 8.2 P2-2 · 漂移判定加存储容差（代码级）

- `character-baseline-calibration.ts`：新增导出 `STORAGE_FLOAT_TOLERANCE = 1e-6`，注释写明它专用于"DB 单精度 FLOAT 往返误差"，
  与既有的跨度/可区分性容差 `FLOAT_TOLERANCE = 1e-9` **语义分离**（一个是表示误差，一个是存储误差）。
- `character-profile.seed.ts`：`hasBaselineDrift` 从 8 个裸 `!==` 改为 `Math.abs(actual - expected) > STORAGE_FLOAT_TOLERANCE`。
- 新增 2 条用例（`character-baseline-seed-calibration.spec.ts`）：
  - **⑨-b**：用 `Math.fround()` 模拟 MySQL FLOAT 往返残值（0.64 → 0.6399999857），断言 `unchanged`、零 UPDATE ——
    这条在"TypeORM 将来改用 prepared statement"时依然守得住幂等。
  - **⑨-c**：任取一维偏 0.01（标定最小刻度）仍必须判漂移并落 UPDATE —— 防止容差开得过大把真差异吞掉。

### 8.3 修复后的复跑结果

| 项 | 结果 |
|---|---|
| `npx tsc -p tsconfig.build.json --noEmit` | exit 0 / 0 error |
| `npx eslint`（改动的 3 个文件） | exit 0 / 0 error / 0 warning |
| `character-baseline-*.spec.ts` 两文件 | **34 例全绿**（21 + 13，原 11 例 + 新增 2 例） |
| `npm run seed:character-profiles` | 仍全 unchanged（A 类 0/0/4，B 类 0/4/0，missing 无） |

### 8.4 仍挂着的技术债

- **P2-3**（全量 vitest 在 179 worker 下的超时 flaky）：未处理，建议与 `wp21-report-stream` 那条合并成一张小单，
  方向是 `pool: 'threads'` 或提高 `testTimeout`。**不影响本单合入**。

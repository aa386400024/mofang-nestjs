# 行为算子 delta 幅度台账 v1.0

- 日期：2026-11-24
- 出处：AF-427（承接 AF-426 台账遗留项「11 个行为算子幅度未成台账」）
- 数据源：内核 `src/engine-core/cognition/state-transition.ts` 的 `DELTA_TABLE` + `data/debug-sessions` 13 场语料 / 205 轮
- 复算：`node scripts/ops/quality/af427-operator-delta-ledger.mjs`（加 `--json` 出机器可读）
- 性质：**工程种子值台账，非临床标定**。所有系数都是待真实对练校准的初始值。

## 一、怎么读这张台账

- 表一的系数是**脚本从内核源码解析出来的**，不是手抄第四份拷贝。内核改一个数字，重跑脚本，台账自动跟着变；解析不到 13 算子 × 11 维会直接抛错，不允许静默补 0。
- 表二的 cap 占用 = `|系数| / 该维单轮 cap`。占用高意味着「这个算子单次就把该维通道用掉大半」，多个算子叠加时更容易触顶。
- 表三的实测/系数比 = 语料里单算子轮的实现幅度绝对值和 ÷ 表一该算子 8 维系数绝对值和。**多算子同轮不并入**——同轮时 `deltaDetail` 是合并向量，分别计给每个算子会把幅度凭空放大（首版统计里 `open_probe` 因此虚高到 143%，改成单算子轮后回到 98.1%，这正是本条统计口径存在的理由）。

## 二、表一 · 13 算子 × 11 维系数

| 算子            | trust  | safety | bond   | valence | arousal | verbal | depth  | style  | positive | negative | dependency |
| --------------- | ------ | ------ | ------ | ------- | ------- | ------ | ------ | ------ | -------- | -------- | ---------- |
| empathy         | 0.100  | 0.060  | 0.020  | 0.030   | -0.020  | -0.030 | -0.020 | -0.010 | 0.030    | 0        | 0          |
| acceptance      | 0.080  | 0.050  | 0.020  | 0.030   | -0.020  | -0.020 | -0.020 | -0.010 | 0.020    | 0        | 0.010      |
| normalization   | 0.070  | 0.035  | 0.010  | 0.020   | 0       | -0.020 | -0.020 | -0.010 | 0.010    | 0        | 0.005      |
| open_probe      | 0.050  | 0.025  | 0      | 0.020   | 0.020   | -0.020 | -0.030 | -0.015 | 0        | 0        | 0          |
| affirmation     | 0.080  | 0.040  | 0.020  | 0.040   | -0.020  | -0.015 | -0.020 | -0.010 | 0.040    | 0        | 0.020      |
| judgment        | -0.120 | -0.030 | -0.020 | -0.120  | 0.060   | 0.060  | 0.080  | 0.120  | 0        | 0.050    | 0          |
| preaching       | -0.100 | -0.020 | -0.010 | -0.080  | 0.030   | 0.080  | 0.060  | 0.060  | 0        | 0.030    | 0          |
| minimizing      | -0.100 | -0.020 | -0.020 | -0.120  | 0.040   | 0.050  | 0.100  | 0.050  | 0        | 0.040    | 0          |
| boundary_cross  | -0.150 | -0.050 | -0.040 | -0.150  | 0.080   | 0.040  | 0.050  | 0.150  | 0        | 0.100    | 0          |
| sensitive_touch | 0      | -0.010 | 0      | -0.120  | 0.150   | 0.050  | 0.050  | 0.060  | 0        | 0.040    | 0          |
| neutral         | 0      | 0      | 0      | 0       | 0       | 0      | 0      | 0      | 0        | 0        | 0          |
| holding_present | 0      | 0.004  | 0.002  | 0.004   | -0.002  | -0.002 | 0      | 0      | 0        | 0        | 0          |
| cold_absent     | -0.004 | -0.002 | -0.002 | -0.004  | 0       | 0.004  | 0.002  | 0.002  | 0        | 0.002    | 0          |

读法要点：

- 正向修复四件套（empathy / acceptance / normalization / affirmation）都靠 trust 与 safety 拉动，bond 只 0.01–0.02，valence 与 verbal/depth 只小幅松动——**共情不拆防御**这条设计意图在数字上是一致的。
- 破坏性算子里 `boundary_cross` 最重（trust −0.15、valence −0.15、style +0.15），`sensitive_touch` 只砸 valence −0.12 与 arousal +0.15，trust 完全不掉——**触到痛处不等于失信**，这是刻意分开的。
- 在场两类（`holding_present` / `cold_absent`）只有 0.002–0.004 量级，本质是「慢积累」，靠轮次堆而不是单轮推动。

## 三、表二 · 单事件 cap 占用

| 算子            | 最大占用 | 所在维度 | 逐维占用                                                                                                                                                              |
| --------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| empathy         | 50.0%    | trust    | trust=50.0% / safety=30.0% / bond=10.0% / valence=15.0% / arousal=10.0% / verbal=15.0% / depth=10.0% / style=5.0% / positive=20.0% / negative=0.0% / dependency=0.0%  |
| acceptance      | 40.0%    | trust    | trust=40.0% / safety=25.0% / bond=10.0% / valence=15.0% / arousal=10.0% / verbal=10.0% / depth=10.0% / style=5.0% / positive=13.3% / negative=0.0% / dependency=6.7%  |
| normalization   | 35.0%    | trust    | trust=35.0% / safety=17.5% / bond=5.0% / valence=10.0% / arousal=0.0% / verbal=10.0% / depth=10.0% / style=5.0% / positive=6.7% / negative=0.0% / dependency=3.3%     |
| open_probe      | 25.0%    | trust    | trust=25.0% / safety=12.5% / bond=0.0% / valence=10.0% / arousal=10.0% / verbal=10.0% / depth=15.0% / style=7.5% / positive=0.0% / negative=0.0% / dependency=0.0%    |
| affirmation     | 40.0%    | trust    | trust=40.0% / safety=20.0% / bond=10.0% / valence=20.0% / arousal=10.0% / verbal=7.5% / depth=10.0% / style=5.0% / positive=26.7% / negative=0.0% / dependency=13.3%  |
| judgment        | 60.0%    | style    | trust=40.0% / safety=10.0% / bond=6.7% / valence=40.0% / arousal=30.0% / verbal=30.0% / depth=40.0% / style=60.0% / positive=0.0% / negative=33.3% / dependency=0.0%  |
| preaching       | 40.0%    | verbal   | trust=33.3% / safety=6.7% / bond=3.3% / valence=26.7% / arousal=15.0% / verbal=40.0% / depth=30.0% / style=30.0% / positive=0.0% / negative=20.0% / dependency=0.0%   |
| minimizing      | 50.0%    | depth    | trust=33.3% / safety=6.7% / bond=6.7% / valence=40.0% / arousal=20.0% / verbal=25.0% / depth=50.0% / style=25.0% / positive=0.0% / negative=26.7% / dependency=0.0%   |
| boundary_cross  | 75.0%    | style    | trust=50.0% / safety=16.7% / bond=13.3% / valence=50.0% / arousal=40.0% / verbal=20.0% / depth=25.0% / style=75.0% / positive=0.0% / negative=66.7% / dependency=0.0% |
| sensitive_touch | 75.0%    | arousal  | trust=0.0% / safety=3.3% / bond=0.0% / valence=40.0% / arousal=75.0% / verbal=25.0% / depth=25.0% / style=30.0% / positive=0.0% / negative=26.7% / dependency=0.0%    |
| neutral         | 0.0%     | -        | 全维 0.0%                                                                                                                                                             |
| holding_present | 2.0%     | safety   | trust=0.0% / safety=2.0% / bond=1.0% / valence=2.0% / arousal=1.0% / verbal=1.0% / depth=0.0% / style=0.0% / positive=0.0% / negative=0.0% / dependency=0.0%          |
| cold_absent     | 2.0%     | verbal   | trust=1.3% / safety=0.7% / bond=0.7% / valence=1.3% / arousal=0.0% / verbal=2.0% / depth=1.0% / style=1.0% / positive=0.0% / negative=1.3% / dependency=0.0%          |

结论：

1. **没有算子单事件触顶。** 最高是 `boundary_cross.style` 与 `sensitive_touch.arousal` 各 75%，仍留 25% 余量；正向修复四件套最高只用 50%（`empathy.trust`）。这与 AF-422 的结论一致：cap 不是当前链路里的瓶颈。
2. **余量最薄的方向是「阻抗三维 + skill」。** `style` / `depth` / `verbal` 在破坏性算子上的占用普遍高于同算子在 trust 上的占用，说明「阻抗在涨」比「信任在掉」更容易被单轮吃掉——同一轮里如果判定出两个破坏性算子，阻抗维度最快触顶。
3. **在两类在场算子（2%）面前 cap 完全无感。** 想让在场产生可观增益，只能抬高系数（AF-421 实测 1× 每批 +0.4660 safety / +0.2320 bond），而不是等 cap 打开。

## 四、表三 · 语料覆盖与实测幅度

| 算子            | 命中轮次 | 单算子轮 | 多算子同轮 | 实现幅度绝对值和（8 维，单算子轮） | 实测/系数比 |
| --------------- | -------- | -------- | ---------- | ---------------------------------- | ----------- |
| empathy         | 34       | 31       | 3          | 0.2553                             | 88.0%       |
| acceptance      | 1        | 1        | 0          | 0.2355                             | 94.2%       |
| normalization   | 0        | 0        | 0          | -                                  | -           |
| open_probe      | 3        | 2        | 1          | 0.1766                             | 98.1%       |
| affirmation     | 0        | 0        | 0          | -                                  | -           |
| judgment        | 1        | 1        | 0          | 0.6100                             | 100.0%      |
| preaching       | 2        | 2        | 0          | 0.4400                             | 100.0%      |
| minimizing      | 7        | 6        | 1          | 0.5000                             | 100.0%      |
| boundary_cross  | 0        | 0        | 0          | -                                  | -           |
| sensitive_touch | 3        | 2        | 1          | 0.4400                             | 100.0%      |
| neutral         | 144      | 144      | 0          | 0.0000                             | -           |
| holding_present | 0        | 0        | 0          | -                                  | -           |
| cold_absent     | 0        | 0        | 0          | -                                  | -           |

会话数 13，轮次 205；**零语料算子 5 个：normalization、affirmation、boundary_cross、holding_present、cold_absent。**

结论：

1. **13 个算子有 5 个在现有语料里一次都没跑过。** 其中 `normalization` 与 `affirmation` 是正向修复主力（系数 0.070/0.080 的 trust），却在 13 场 / 205 轮里 0 命中；`boundary_cross` 是最重的破坏性算子（style 占用 75%）也 0 命中。**这 5 个算子的系数属于「写下来但从未被行为验证」状态**，不能拿语料里「没变坏」当作「调得对」。
2. **破坏性算子实测 = 系数 100.0%（judgment 0.6100 / 0.61、preaching 0.4400 / 0.44、minimizing 0.5000 / 0.50）。** 说明这些算子在链路里是原样落地的：没有 cap 截断，也没被覆写改掉。
3. **`empathy` 实测只有系数的 88.0%，差额集中在 safety。** 逐维拆开看：safety 实测均值 0.0140，而表一写的 0.060。原因已由 [语料跨内核版本漂移取证](./debug-corpus-kernel-version-drift-v1.0.md) 定性：**这批语料是跨内核版本的混合快照**——同为「`empathy` 单算子轮」的 31 轮里，24 轮落在 trust 0.12 / safety 0.014 这一簇，另有 0.06 与 0.10 两簇；而破坏性算子（judgment / preaching / minimizing / sensitive_touch）与当前表逐字一致，因此「`AllianceConfig` 覆写」这一候选解释被降到次位。`safety: 0.06` 最早出现于 `bea5a719`（2026-11-22），语料生成于 2026-11-21/22，部分早于该改动。**结论：表三只能用来判「同一算子内部各簇的相对稳定性」，不能用来判「当前系数是否已生效」；对外解释 empathy 的 safety 增益前，必须用带版本指纹的新语料重测。**
4. `neutral` 144 轮实测幅度精确为 0——`neutral` 是 `ZERO` 别名，语料侧也确认它是真零，不是「小到看不见」。

### 版本口径附注（2026-11-24 补）

表三的语料快照**不带内核版本指纹**，`data/debug-sessions/*.json` 的 13 场里实际混着至少两个内核版本的输出（签名分簇见 [语料跨内核版本漂移取证](./debug-corpus-kernel-version-drift-v1.0.md)）。因此读表三要带三条限定：

1. **同一算子内部可比**：同一算子各签名簇谁更稳，可以判。
2. **跨算子不可直接横比**：不同算子的语料若来自不同版本，实测/系数比之间没有可比性（破坏性算子恰好全落在与当前表一致的簇，empathy 则没有）。
3. **不能当作「当前系数是否生效」的证据**：要判这一点，必须重跑一批带 `kernelRef` / `deltaTable` 哈希的语料，并把哈希记进会话元数据。

## 五、这张台账现在的用处

- 调某个维度系数时，先查表二：这一改会让哪个算子在哪个维度的 cap 占用从多少变成多少。
- 论证「某算子调好了」时，先查表三：这个算子在语料里跑过几轮、实测/系数比是多少。0 命中的算子必须补语料才能谈结论。
- 写注释里「单事件达上向 cap 的 X%」这类话时，用表二的数字，不要手算。

## 六、复算与维护

```powershell
node scripts/ops/quality/af427-operator-delta-ledger.mjs
node scripts/ops/quality/af427-operator-delta-ledger.mjs --json
pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
pnpm exec vitest run scripts/orchestration/__tests__/af450-ledger-segmentation.spec.mjs
```

维护纪律：

1. 内核 `DELTA_TABLE` 改名、改成非字面量（例如拆成多个对象或从别处取值）时，解析器会直接抛错——那是必须更新解析器的信号，不是可以绕过的问题。
2. 语料目录换了位置、或 `deltaDetail.events` 字段结构变了，表三会静默变空；`--json` 里 `corpus.sessions=0` 即为信号。
3. **新增算子必须同时改 `OPERATOR_ORDER` 与 `DELTA_DIMS`，否则解析器报「出现未经登记的算子」。** 这条是刻意设的：台账不允许对内核偷偷多出来的算子保持沉默。

## 七、语料分组口径（AF-450 起）

表三的数字是**真实用户会话**口径。语料目录里混入 `synthetic: true` 的剧本 / 回放语料后，口径拆成四张表，混算即视为统计错误：

| 段落                  | 数据来源                        | 用途                                  | 禁止用法                             |
| --------------------- | ------------------------------- | ------------------------------------- | ------------------------------------ |
| 表三 · 语料覆盖       | `synthetic !== true`            | 真实语料下的算子命中与幅度            | 不得用合成语料替换或补齐这里的数字   |
| 表三附 · 合成语料覆盖 | `synthetic === true`            | 验证算子幅度是否生效、是否被 cap 吞掉 | 不得作为真实用户行为证据或临床结论   |
| 表四 · kernelRef 分布 | 会话 `kernelRef`，缺失归 `none` | 看清「哪一版内核产出的语料」          | 不得把 `none` 桶当成某一版内核的语料 |

- `synthetic: true` 的判定只看会话字段，不看文件名——文件名是约定，字段才是事实源。
- `kernelRef` 是落盘时的内核 delta 表指纹（AF-442 起写入）；无指纹的历史语料归 `none`，不做猜测填充。
- 一个算子在表三里 0 命中、在表三附里有命中时，结论是「幅度可用合成语料验证，真实语料仍缺」，不是「已覆盖」。

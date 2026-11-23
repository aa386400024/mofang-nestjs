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
3. **`empathy` 实测只有系数的 88.0%，差额集中在 safety。** 逐维拆开看：safety 实测均值 0.0140，而表一写的 0.060——这是本台账里唯一的实质偏差，原因待核实（候选解释两条：语料快照生成于 2026-11-21/22，可能早于 safety 提到 0.06 的那次调整；或运行时 `AllianceConfig` 的 safety 覆写生效，覆写优先于 `DELTA_TABLE` 基础值）。**在核实前，勿用「empathy 的 safety 增益是 0.06」对外解释。**
4. `neutral` 144 轮实测幅度精确为 0——`neutral` 是 `ZERO` 别名，语料侧也确认它是真零，不是「小到看不见」。

## 五、这张台账现在的用处

- 调某个维度系数时，先查表二：这一改会让哪个算子在哪个维度的 cap 占用从多少变成多少。
- 论证「某算子调好了」时，先查表三：这个算子在语料里跑过几轮、实测/系数比是多少。0 命中的算子必须补语料才能谈结论。
- 写注释里「单事件达上向 cap 的 X%」这类话时，用表二的数字，不要手算。

## 六、复算与维护

```powershell
node scripts/ops/quality/af427-operator-delta-ledger.mjs
node scripts/ops/quality/af427-operator-delta-ledger.mjs --json
pnpm exec vitest run scripts/orchestration/__tests__/af427-operator-delta-ledger.spec.mjs
```

维护纪律：

1. 内核 `DELTA_TABLE` 改名、改成非字面量（例如拆成多个对象或从别处取值）时，解析器会直接抛错——那是必须更新解析器的信号，不是可以绕过的问题。
2. 语料目录换了位置、或 `deltaDetail.events` 字段结构变了，表三会静默变空；`--json` 里 `corpus.sessions=0` 即为信号。
3. **新增算子必须同时改 `OPERATOR_ORDER` 与 `DELTA_DIMS`，否则解析器报「出现未经登记的算子」。** 这条是刻意设的：台账不允许对内核偷偷多出来的算子保持沉默。

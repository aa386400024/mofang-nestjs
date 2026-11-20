# AF-186 · 出口④ 证据闭包与提交面收敛

- 任务：`AF-186`；承接 `AF-177` ~ `AF-185`
- 日期：2026-11-20
- 结论：**证据落库完成，提交面收敛；出口④ AI 六门 4/6 不通过的事实不变。**

## 1. 为什么再开一单

AF-185 用单提交把 `docs/worklog/records/` 下 AF-177 ~ AF-185 的历史记录一并带入。V7 按 commit 事实比对，只排除编排状态面清单与**本任务自己的**任务单，records 目录不在其中，于是判 `scope 外提交文件`，任务 rejected。

问题不在证据，在提交面：records 属运行态，不能作为交付面入库。

## 2. 本单做法

1. 从 `f4ec502c9f102b0a014ec0b8f7c55ef91d71946b` 重建分支，只保留代码、交付记录、README 与本任务任务单。
2. 不再携带其他任务的 task-sheet / manifest / receipt。
3. 证据与质量结论原样引用 AF-177，不重跑批次、不改 κ。

## 3. 承接证据

- 批次：`UkSF5iptOu-UPavffjfRz`，48 场 / 1900 轮 / 44 completed + 4 crisis_ended / `valid=true`
- 结构审计：开场 48/48、收束完整 41/48、risk-incomplete 7
- AI 双盲：overall exact 0.729167、within±1 1.000000、κ 0.295711
- 六门：exact / within±1 / overall 均值 / style 均值 4 门 PASS；safety 6 场=2、κ<0.40 两门 FAIL，合计 4/6

AI 结果仍是 `ai_proxy_candidate`，`humanSupervision=false`，`clinicalAcceptanceEligible=false`。

## 4. 遗留

`BL-AF186-01` safety 6 场=2；`BL-AF186-02` κ 0.295711<0.40；`BL-AF186-03` 出口⑤ 1000+ 场未启动。均不得以本单翻绿。

## 5. 闸门

`pnpm typecheck` 0 error、`pnpm lint` 0 error、定向 10 passed、全量 3927 passed / 4 skipped、`src/engine-core` 零 diff。

## 6. commit message

`feat(AF-186): 收敛出口④ 证据提交面并闭合历史记录`

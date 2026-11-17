# CI 门禁实弹演练记录（2026-11-17）

## 1. 目的

把 `--require-ci` 从「只有假 REST 响应的单测」推进到「真实远端结论真的决定过一次合并」。演练要同时证明两件事：

1. **阻断路径**：拿不到远端结论（`unknown`）时，合并被拦下，分支不被改写；
2. **放行路径**：拿到 `pass` 时，squash 合并真实落入 `integrate`。

只证明第一条等于只证明「门禁会报错」；只证明第二条等于只证明「门禁能放行」。两条都跑，才说明门禁是**决定**而不是**装饰**。

## 2. 为什么不能「拿现成绿 SHA 试一下」

后端 CI 触发面是 `push: branches: [master, integrate]` + `pull_request: branches: [integrate]`（`.github/workflows/ci.yml`）。临时任务分支的提交**天然没有 check runs**，直接合并必然判 `unknown`——这正好是阻断路径的真实条件，但证不了放行。

放行必须给该 ref 补一次 `workflow_dispatch`，让 check runs 真正落到这个 SHA。这一步是演练的成本来源，也是它的价值来源：门禁读的是「**这个 SHA** 上的结论」，不是「仓库最近一次绿」。

## 3. 演练口径

| 步骤  | 命令                                                                           | 期望                                                                  |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 分支  | `git switch -c task/AF-046-af-046`                                             | 自 `integrate` 切出，分支名符合 `task/<taskId>-<slug>`                |
| 阻断  | `branch merge --taskId AF-046 --require-ci --sha <分支提交>`（不带 `--apply`） | 退出码 2，报「远端 CI 未通过（unknown）」                             |
| 补 CI | `workflow_dispatch` on `ref=task/AF-046-af-046`                                | check 全部 `completed`                                                |
| 放行  | 同命令 + `--apply`                                                             | 输出「远端 CI 通过」，`squash-merge → commit`，合并提交进 `integrate` |

基线面（`verifyBaseline`）保持显式跳过：本单不登记 `baselineRef`，口令会打印「任务记录未登记 baselineRef」——演练对象是 CI 门禁，不伪造一个刚好对上的 SHA。

## 4. 结果

两次调用的 SHA、verdict、check 数与合并提交 hash 见同批交付记录 `docs/worklog/completed/phase2.5/af045-orchestration-hardening-2026-11-17.md` §5。演练本体只记方法，数字跟当批交付走，避免同一组数字两处维护。

## 5. 结论

门禁判定链是 `evaluateRemoteCiGate → ciGateVerdict`，其中 0 项 check 判 `unknown` 而非 `pass`。这条口径在实弹里被验证过一次「该拦就拦」：临时分支、补数失败、CI 未触发都不会被误放行。

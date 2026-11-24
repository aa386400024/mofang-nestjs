# 来访者语域指纹机制稳定性评测（AF-465）

固定 30 轮咨询师脚本，跑「10 个标定角色 × base/active」的调试会话，逐轮抓 prompt、
BDI/delta/crisis、回复与用量；再用双 AI 评委做匿名盲评。原始台词只落本地
`data/eval-reports/visitor-register-stability/<runId>/`（gitignored），仓库只提交聚合报告。

## 前置

```powershell
pnpm build
# 3010 = base(off)，3011 = active(active + 白名单)
# 两个进程必须来自同一份 dist，且 ENGINE_DEBUG_CHAT_ENABLED=true
```

启动示例（PowerShell，工作目录为仓库根）：

```powershell
$env:PORT='3010'; $env:VISITOR_REGISTER_MODE='off'; $env:VISITOR_REGISTER_PILOT_IDS=''; $env:ENGINE_DEBUG_CHAT_ENABLED='true'
Start-Process node -ArgumentList 'dist/app.js' -WorkingDirectory . -RedirectStandardOutput data/eval-reports/visitor-register-stability/base.out.log -RedirectStandardError data/eval-reports/visitor-register-stability/base.err.log

$env:PORT='3011'; $env:VISITOR_REGISTER_MODE='active'; $env:VISITOR_REGISTER_PILOT_IDS='<角色1>,<角色2>'; $env:ENGINE_DEBUG_CHAT_ENABLED='true'
Start-Process node -ArgumentList 'dist/app.js' -WorkingDirectory . -RedirectStandardOutput data/eval-reports/visitor-register-stability/active.out.log -RedirectStandardError data/eval-reports/visitor-register-stability/active.err.log
```

## 跑会话

旧双端口跑法（历史对照，AF-465/AF-466 口径）：

```powershell
node scripts/eval/visitor-register-stability/run-sessions.mjs --run-id <id> --roles <role1>,<role2> --task-id AF-466
```

单进程逐轮配对（AF-475 起的成本门口径）：

```powershell
# 只起 3010 一个进程；进程级开关必须打开，base/active 再由 per-session registerMode 切换
$env:PORT='3010'; $env:ENGINE_DEBUG_CHAT_ENABLED='true'; $env:VISITOR_REGISTER_MODE='active'
node dist/app.js
node scripts/eval/visitor-register-stability/run-sessions.mjs --run-id <id> --roles <role1>,<role2> --task-id AF-478 --paired --port 3010
```

- **进程级灰度开关是必要条件**：`VISITOR_REGISTER_MODE` 默认 `off`；`registerMode=active` 只能在
  该开关为 `active` 时生效，`off` 仍会强制关掉 base 臂。若只在请求里传 `active` 而进程开关没开，
  两臂 prompt 会完全一致（静默假对照）。需要限定角色时同时设置 `VISITOR_REGISTER_PILOT_IDS`。
- `--roles` 省略时跑标定表全部角色；库里没有 `approved character_profiles` 的角色会创建失败，
  不要伪造，按可用角色数写进报告的覆盖说明。
- 每个角色 base/active 各 1 场、30 轮；旧跑法按 seed 随机整场顺序，`--paired` 同一端口开两场、
  逐轮交替并翻转先后，消除整场串行与双进程差异。
- 产出：`manifest.json`（`paired=true`、`ports.paired`）、`metrics.json`、`sessions/<role>/<mode>.json`
  （每场记录 `registerMode=off|active`）。

## AI 盲评

```powershell
node scripts/eval/visitor-register-stability/judge-sessions.mjs --run-id <id> --judges doubao,minimax
```

- 逐场抽第 1/4/8/12/16/20/25/30 轮，甲/乙匿名、左右随机。
- 四维：`register_fit` / `stereotype_risk` / `cross_turn_stability` / `concreteness`；
  另给整体偏好与 confidence。
- 产出：`ratings.json`、`analysis.json`、`judge-raw/*.txt`（本地，含证据原文）。
- 评委输出无法解析时会重试并落 `*.failed-*.txt`；MiniMax 需给足
  `max_completion_tokens` 且 `reasoning_effort=low`，否则思考会吃光 JSON 预算。

## 报告

```powershell
node scripts/eval/visitor-register-stability/render-report.mjs --run-id <id> --out docs/worklog/completed/phase2.5/<report>.md
```

`--out` 缺省仍落 AF-465 原报告路径；新任务必须显式指定，避免覆盖已归档报告。

## 延迟归因

```powershell
node scripts/eval/visitor-register-stability/analyze-latency.mjs --run-id <id> --compare-run-id <baseline-id>
```

- 只读 `sessions/*.json`、`manifest.json`，不发起模型调用、不落原文。
- 输出 `latency-attribution.json`（同 run 目录）与终端摘要：p50/p95、TTFT、post-TTFT、
  prompt/completion token、轮次分层、尾部集中度、回归系数、p95 bootstrap、跨 run base 对照。
- `--compare-run-id` 可选，只用于同脚本、base 无块的跨 run 绝对 p95 波动参照，不替代同期对照。

## 边界

- 这是 AI 代理盲评，不是真人语言学/督导师验收；`status=ai_proxy_candidate`。
- 不以平均句长作成功判据；它只作解释变量。
- 单角色单场不能外推机制；跨角色方向、重复性、长会话漂移要分开看。

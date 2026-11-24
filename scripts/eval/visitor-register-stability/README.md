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

```powershell
node scripts/eval/visitor-register-stability/run-sessions.mjs --run-id <id> --roles <role1>,<role2> --task-id AF-466
```

- `--roles` 省略时跑标定表全部角色；库里没有 `approved character_profiles` 的角色会创建失败，
  不要伪造，按可用角色数写进报告的覆盖说明。
- 每个角色 base/active 各 1 场、30 轮；顺序按 seed 随机，脚本哈希写进 manifest。
- 产出：`manifest.json`、`metrics.json`、`sessions/<role>/<mode>.json`。

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

## 边界

- 这是 AI 代理盲评，不是真人语言学/督导师验收；`status=ai_proxy_candidate`。
- 不以平均句长作成功判据；它只作解释变量。
- 单角色单场不能外推机制；跨角色方向、重复性、长会话漂移要分开看。

# 自动对练 · 测试脚本包

> 配套文档：[全量测试报告](../phase2.5-wp-d-auto-practice-2026-11-09-test-report.md)

这 4 个脚本是 2026-11-09 那轮 28 场全量实跑用的工具，都在**项目外**的日志目录里跑、产物也写在那里（避免触发 `nest start --watch` 重编译）。

## 前置条件

- 后端在 `http://localhost:3000` 跑着，`Authorization: Basic YWRtaW46MTIzNDU2`
- 输出目录：`C:\Users\41391\AppData\Local\Doubao\User Data\Profile 5\.doubao\agent_mode\workspace\logs\`（脚本里 `LOG_DIR` 写死在这，换机器要改）

## 四个脚本

| 脚本 | 作用 | 用法 |
|---|---|---|
| `run-matrix-serial.py` | 串行补跑矩阵：自动挑"没跑过的组合 + 来访兜底句占比 ≥50% 的场次"，并发 1、间隔 8s、断点续跑 | `python run-matrix-serial.py` → 追加写 `matrix3.jsonl` |
| `analyze.py` | 逐场指标：状态/轮数/均字数/兜底数/截断数/BDI 位移 | `python analyze.py matrix.jsonl matrix3.jsonl --out summary.json --dump detail3 --print` |
| `final-report.py` | 合并多批结果（后写的覆盖先写的）、拉逐字稿、生成报告里的 28 场表格 + 模式汇总 | `python final-report.py > final_table.md`，同时写 `final.json` |
| `degrade-stats.py` | 离线统计某个 detail 目录里咨询师/来访兜底句与截断数（不请求后端） | 改脚本里 `BASE` 指向 `detail2` / `detail3` 后 `python degrade-stats.py` |

## 踩过的坑（别再踩）

1. **别并发**。并发 3 就会触发 MiniMax Token Plan 429，来访者整场退化为 4 句兜底台词，场次却仍标 `completed`——第一批 25 场里 13 场是这么废掉的。串行（并发 1 + 间隔 8s）实测 17 场零降级。
2. **别用 `POST /batch`**。当前 100% 500（BullMQ `jobId` 不许含 `:`），一用就堵在这。用单场接口 `POST /admin/api/auto-practice/sessions`。
3. **别把日志/中间文件落在项目里**。`nest --watch` 会侦测文件变化反复重编译，运气不好还会把在跑的场次冲成 `failed/interrupted`（本次 28 场里唯一一条 failed 就是这么来的）。
4. **逐字稿端点**是 `GET /admin/api/debug/sessions/<debugSessionId>`；`GET /admin/api/sessions/:id` 查的是 `training_sessions`，对自动对练场次恒 404。
5. **兜底句识别**用固定台词表（脚本里 `VB` / `CB` 两个常量），改 prompt 时记得同步——这是目前唯一能识别"静默降级"的手段（模块本身还没有 `degraded` 字段）。

# 验证环境隔离运行手册（AF-526 / AF-527）

> 适用：本机 / 共享 Redis / 共享 MySQL 上跑自动对练验证批次（含 1000 场出口⑤批次前的定向验证）。
> 目标：不同工作树、不同实例的 BullMQ 队列不互相抢单；实例重启不误标其他实例的 running 场次。

## 旧实例清理（AF-527 起）

开验证批次前先盘点本机旧工作树进程，确认没有旧代码实例还在共享 MySQL / Redis 上运行：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'mofang-nestjs-(af|old)|nest start|dist\\app' } |
  Select-Object ProcessId,ParentProcessId,CommandLine

Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 3000,3001,3002 } |
  Select-Object LocalPort,OwningProcess
```

确认是旧后端后停止 watcher 与 app（不要停无关前端）：

```powershell
Stop-Process -Id <nest-watcher-pid>,<app-pid> -Force
```

判据：`3000` 端口无监听、进程列表不再出现旧 worktree 的 `nest start --watch` / `dist/app`。旧代码实例的 `onModuleInit` 仍会无差别标记所有 running，不能只靠新实例的租约保护。

如果旧 worktree 还留着 VS Code 终端并跑过 `pnpm start:dev`，只停进程不够：终端或 IDE 会话恢复时可能再次拉起 `dist/app`。AF-527 实测停掉 PID 13352/38884 后，11:40:54 又出现 `pnpm start:dev`，11:41:22 拉起新的 `dist/app` 并监听 3000。处理方式是按进程树停掉并关闭对应终端：

```powershell
# 先找到旧 worktree 的 pnpm start:dev 父进程
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'mofang-nestjs-af281r' -and $_.CommandLine -match 'start:dev' } |
  Select-Object ProcessId,ParentProcessId,CommandLine

# 按父进程整棵树停掉（会把 watcher / dist/app 一并带走）
taskkill /PID <pnpm-start-dev-pid> /T /F
```

停完至少观察 60–90 秒，确认 `3000` 仍无监听且 `oldBackendCount=0`；不要只看一次 `Stop-Process` 的即时结果。

## 双实例队列隔离 smoke（AF-527）

脚本：`scripts/validation/queue-isolation-smoke.mjs`。它在同一个 Redis DB 上启动两个独立 Worker 进程，分别用 `af527-smoke-a` / `af527-smoke-b` 前缀；生产者向两边各入 2 个 job，断言只被各自前缀消费，并检查 key 命名空间不交叉。结束后 `obliterate` smoke 队列。

```powershell
# 从 .env 读取 REDIS_HOST / REDIS_PORT / REDIS_PASSWORD，验证用 DB5
$env:REDIS_DB='5'
$env:NODE_ENV='development'
node scripts/validation/queue-isolation-smoke.mjs
```

通过判据：

```json
{
  "ok": true,
  "consumed": { "a": ["A1","A2"], "b": ["B1","B2"] },
  "keyCounts": { "a": 5, "b": 5 }
}
```

`keyCounts` 是清理前计数；脚本结束后再查 `af527-smoke-a:*` / `af527-smoke-b:*` 应为 0。若 A 消费了 B 的 job 或 key 前缀交叉，直接失败，不允许继续开批次。

## 两层隔离


| 层 | 变量 | 作用 | 默认 |
| --- | --- | --- | --- |
| 业务 Redis key | `REDIS_KEY_PREFIX` | JWT 黑名单 / 验证码 / 会话租约等业务 key | `mofang` |
| BullMQ 队列 | `BULLMQ_PREFIX` | Queue / Worker 的队列 key 命名空间 | prod/test=`bullmq`；dev 自动 `bullmq:dev:<REDIS_DB>:<host>:<worktreeHash>` |

两层互相独立：`REDIS_KEY_PREFIX` 不会改 BullMQ 队列前缀，`BULLMQ_PREFIX` 也不会改业务 key。

## 推荐的本机验证配置

```dotenv
REDIS_HOST=117.72.30.78
REDIS_PORT=6379
REDIS_DB=5
REDIS_KEY_PREFIX=mofang:dev:
# 可选。两个实例同时跑时，分别设不同值。
# BULLMQ_PREFIX=validation-a
```

- 不要用 `REDIS_DB=0` 跑本机验证：DB0 可能有远端 / 旧 worktree 的 worker。
- `BULLMQ_PREFIX` 留空也能隔离：dev 会自动带上 DB、主机名、工作树哈希；同一工作树重启后前缀不变，队列可续跑。
- 需要两个实例同时跑同一工作树时，必须显式给每个实例不同的 `BULLMQ_PREFIX`，并给不同 HTTP 端口（`PORT`）。

## 启动后的自检

1. 启动日志应出现当前队列前缀对应的 queue 名；对练实例还会打出租约相关告警（如有）。
2. 在目标 DB 上检查队列 key：

```bash
redis-cli -h 117.72.30.78 -p 6379 -n 5 --scan --pattern 'bullmq:dev:5:*'
redis-cli -h 117.72.30.78 -p 6379 -n 5 --scan --pattern 'validation-a:*'
```

3. 检查会话租约 key 与 TTL：

```bash
redis-cli -h 117.72.30.78 -p 6379 -n 5 --scan --pattern 'mofang:dev:practice:lease:*'
redis-cli -h 117.72.30.78 -p 6379 -n 5 TTL 'mofang:dev:practice:lease:<practiceSessionId>'
```

4. 启动清理日志只应出现两类：
   - `N 个 running 场次均持有租约, 跳过`
   - `清理 N 个无租约孤儿 running 场次`

   如果看到“未注入会话租约服务 — 跳过启动清理”或“清理孤儿场次失败, 已跳过本轮”，说明租约服务 / Redis 不可用，本轮不会误标，但也不会自动回收孤儿。

## 常见误判

- **队列里仍有 `bullmq:auto-practice`**：说明还有旧代码实例在用写死的 `bullmq` 前缀。新代码不会再消费该队列；需要停掉或升级旧实例，不能把旧队列的失败算到本批。
- **running 场次被标 interrupted**：先确认是否还有旧代码实例在共享 MySQL 上启动。AF-526 只保护升级后的新实例；旧实例的 `onModuleInit` 仍会无差别标记所有 running。
- **租约 TTL 到期**：进程崩溃后最多 30 秒租约自然过期；下一次新实例启动才会把该场次当孤儿回收。不要手工删租约 key，除非确认持有进程已死。

## 1000 场批次前检查清单

- [ ] 所有旧 worktree 的 `nest start --watch` / `dist/app` 进程已停止。
- [ ] 验证实例使用独立 `REDIS_DB`（推荐 5），不接 DB0。
- [ ] 同时跑多个实例时，每个实例 `BULLMQ_PREFIX` 不同、`PORT` 不同。
- [ ] 启动后 `--scan` 只看到本实例前缀的队列 key。
- [ ] 启动清理日志没有把仍有租约的场次标 failed。

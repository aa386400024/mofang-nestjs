# 4C8G self-hosted runner 接入手册

## 定位

4C8G 机器是专用 **CI + staging** 节点，不承载生产后端、生产数据库、生产 Redis 或真实用户数据。生产独立部署，CI 机器与其网络隔离。

## 硬约束

- **public 仓禁止接入 self-hosted runner。** 公开仓任何人都能通过 fork PR 在 runner 上执行代码；GitHub 建议 self-hosted 只用于私有仓。
- 接入顺序固定：服务器就绪 → 私有测试仓验证 → 主仓转私有 → 设置 `CI_RUNNER` 切 self-hosted。不要在 public 主仓先接 runner。
- runner 机器不放生产 SSH 私钥、云密钥、数据库密码、SMTP 密码。
- runner 使用非 root 专用账号；工作区每轮清理。

## 推荐配置

- Ubuntu 24.04 LTS，4 vCPU / 8GB，独立数据盘 100GB+
- Node 26、pnpm 9、Docker、Playwright 浏览器、MySQL/Redis 客户端预装
- 2 个 runner 实例，标签统一 `mofang-ci`；每个实例限制 2 vCPU / 3.5GB
- 同一时间只允许一个 heavy job（Unit 全量、E2E、Docker build 互斥）
- 4GB swap；OOM 前先触发 job 失败，不要拖死整机
- `actions-runner` 使用 `--ephemeral`，由 systemd 模板在 job 结束后重新注册
- 关闭自动更新以外的无关服务；SSH 只允许管理 IP

## 标签与 workflow 切换

runner 标签：

```text
self-hosted, linux, x64, mofang-ci
```

workflow 通过仓库变量选择 runner：

```yaml
runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
```

- public 阶段：`CI_RUNNER` 留空，继续走 GitHub 托管免费 runner。
- 私有仓 + runner 就绪：把 `CI_RUNNER` 设为 `mofang-ci`，全部 job 走 self-hosted。
- 不要在 job 里写死 `ubuntu-latest`；否则私有后会直接消耗 2,000 分钟额度。
- 保留一个 `workflow_dispatch` 的 GitHub 托管 fallback，仅在 runner 故障时手动触发。

## 资源预算

按 32 任务/天、每个任务一次 ready 全量、integrate push 轻量、夜间全量：

- PR 全量：约 640 CPU 分钟/天
- integrate 轻量 Gate：约 50 分钟/天
- 夜间全量：约 20 分钟/天
- 合计约 710 CPU 分钟/天；2 个 runner 并行约 6 小时/天，4C8G 可承受

如果 increase push 也跑全量，约 1,200 CPU 分钟/天，2 个 runner 约 10 小时/天，仍可运行但队列会变长。优先保持“PR 全量 + integrate 轻量 + 夜间全量”。

## 缓存

- pnpm store 挂载宿主机目录，例如 `/opt/ci-cache/pnpm`，避免每次重新下载依赖。
- Docker buildx 缓存挂载 `/opt/ci-cache/buildx`，基础镜像预拉取。
- 覆盖率与测试报告只保留本机摘要；不要向 GitHub 上传大 artifact，私有仓只有 500MB Actions 存储。
- 每周 `docker system prune` 与日志轮转。

## 安全隔离

- runner 与 staging 在独立 VPC/安全组，不能路由到生产 VPC。
- 生产数据库白名单不包含 CI 机器 IP。
- runner 不挂载生产 Docker socket；如必须构建镜像，使用独立 Docker daemon 或 rootless Docker。
- Secrets 只放 GitHub Environment，设置 required reviewers；fork PR 不注入 secrets。
- 记录 runner 的 CPU、内存、磁盘、队列时间与在线状态；离线时 workflow 会排队而非失败。

## staging 共存

允许：

- staging NestJS 后端（独立 env，不连生产）
- staging Redis
- admin-dashboard preview
- 轻量监控、镜像缓存、定时任务

不允许：

- 生产后端、生产 MySQL/Redis
- Qdrant 等大内存服务（除非升级到 8C16G）
- 真实用户数据、生产数据库备份、生产密钥

资源上限建议：

```text
系统 + Docker：0.5C / 1GB
runner：3C / 5GB（两个实例合计，单 heavy job）
staging 后端：1C / 1.5GB
staging Redis：0.2C / 0.5GB
监控：0.2C / 0.3GB
缓冲：0.5GB + 4GB swap
```

## 验收

- runner 在私有测试仓完成一次 lint/typecheck/unit/coverage/e2e/build 全链路。
- `CI_RUNNER=mofang-ci` 后所有 job 的 runner 名称正确，无任何 `ubuntu-latest` 自动执行。
- 故意触发一次失败 job，确认 OOM、超时、磁盘满不会拖死 staging。
- 断开 runner 网络，确认 fallback 手动 workflow 可用。

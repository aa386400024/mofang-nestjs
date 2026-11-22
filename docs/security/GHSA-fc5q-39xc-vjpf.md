# 安全审计风险接受 · GHSA-fc5q-39xc-vjpf（picomatch ReDoS）

- 状态：已接受（临时），到期复核 2027-02-18
- 责任方：安全与依赖维护 owner（当前由 orchestrator 代管，需在到期前指定常任 owner）
- 适用任务：AF-070
- 关联 PR：AF-069 / PR #19 的 Security Audit 解锁

## 1. Advisory 事实

| 项 | 值 |
| --- | --- |
| GHSA | `GHSA-fc5q-39xc-vjpf` |
| 标题 | picomatch vulnerable to ReDoS through single-branch repeated extglobs |
| 严重级 | high |
| 受影响包 | `picomatch` |
| 受影响版本 | `<=4.0.7` |
| registry 声明 patched versions | `<0.0.0`（当前无修复版本） |
| 首次阻断证据 | PR #19 Security Audit，2026-11-18，4 vulnerabilities（3 moderate + 1 high） |

## 2. 传递路径

CI 审计输出至少 16 条路径，核心路径如下：

```text
@nestjs/apollo@14.1.1
  └─ @nestjs/graphql@14.1.0
       ├─ tinyglobby@0.2.17 ── fdir@6.5.0 ── picomatch@4.0.7
       └─ tinyglobby@0.2.17 ── picomatch@4.0.7

ts-morph@28.0.0
  └─ @ts-morph/common@0.29.0
       └─ tinyglobby@0.2.17 ── fdir@6.5.0 ── picomatch@4.0.7

typeorm@...
  └─ ... ── picomatch@4.0.7
```

已验证的版本事实：

- `picomatch` 最新发布版仍为 `4.0.7`。
- `@nestjs/graphql` 最新 `14.2.1` 仍依赖 `tinyglobby@0.2.17`。
- `tinyglobby@0.2.17` 依赖 `fdir ^6.5.0` 与 `picomatch ^4.0.4`。
- GraphQL 在 `src/gql` 中真实使用；TypeORM 被大量源文件引用，不能为消警删依赖。

## 3. 为何不升级/不 override

- 上游没有发布 `>4.0.7` 的 patched 版本，`pnpm audit --fix` 无法生成有效 override。
- 强行 override 到 Git 分支或未发布提交会破坏 lockfile 可复现性，并经供应链引入未审计代码。
- `pnpm audit --audit-level=high --prod` 是生产依赖门；在无修复版本时，关闭该门等于对所有 high advisory 放行，因此不采用。

## 4. 运行时暴露面

`picomatch` 在本项目中的调用来自构建/代码生成/ORM 元数据扫描的 glob 匹配：

- GraphQL schema 文件扫描（`@nestjs/graphql` 的 `tinyglobby`）。
- `ts-morph` 的项目文件枚举。
- TypeORM 的实体/迁移路径发现。

这些 glob 模式均由仓库内常量或服务端配置生成，**不接受终端用户输入**；ReDoS 触发需要攻击者控制 glob pattern。因此当前生产暴露面为“低”，但并非零：若未来把用户输入拼进 glob 模式，风险会立即升级。

补偿控制：

1. 不在请求链路中使用 `picomatch`/`tinyglobby` 处理用户输入；如需路径匹配，先做白名单与长度/字符集校验。
2. CI 的 Security Audit 保持 `--audit-level=high --prod`，仅忽略本 GHSA；其他 high/critical 继续阻断。
3. 依赖升级 watch：`@nestjs/graphql`、`tinyglobby`、`fdir`、`picomatch` 任一发布修复版本，立即升级并删除本例外。
4. 到期前由 owner 重新核对 advisory 状态；无修复则重新审批，不得自动续期。

## 5. 例外配置

`package.json`：

```json
"pnpm": {
  "auditConfig": {
    "ignoreGhsas": ["GHSA-fc5q-39xc-vjpf"]
  }
}
```

只允许这一条 GHSA。禁止把其他 advisory 加入该数组；新增例外必须单独走安全评审与任务单。

## 6. 退出条件

满足任一条件即关闭本风险接受：

- `picomatch` 发布 `>4.0.7` 的修复版本，且 `tinyglobby`/`fdir` 依赖链可解析到该版本。
- `@nestjs/graphql` / `ts-morph` / TypeORM 任一上游移除 `tinyglobby` 或替换 glob 实现。
- 项目不再在构建/运行链路使用 `picomatch`。

关闭动作：升级 lockfile → 删除 `ignoreGhsas` 条目 → 重跑 Security Audit → 在本文件标记“已关闭”并记录 commit。

## 7. 复核记录

| 日期 | 动作 | 结果 | 执行方 |
| --- | --- | --- | --- |
| 2026-11-18 | 首次接受，配置 `ignoreGhsas` | 仅本 GHSA；其他 high 仍阻断 | orchestrator / AF-070 |
| 2026-11-18 | AF-073 出口收口复核：核对 advisory 状态、传递路径与运行时暴露面；未发现可用的 `>4.0.7` 修复版本，调用方仍为构建/代码生成/ORM 元数据扫描，不接受终端用户 glob 输入 | 继续按临时接受执行至 2027-02-18；到期须重新审批，不自动续期 | orchestrator / AF-073 |
| 2027-02-18 | 到期复核（待执行） | — | 安全 owner |


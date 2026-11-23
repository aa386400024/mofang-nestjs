# AF-399 · 回执换行归一与记录包哈希修复

- 日期：2026-11-24
- 任务：AF-399（承接 AF-398 / AF-397 / AF-396）
- 基线：`b58d64cf958ad83dcc775b9633d25382ba4e95ec`

## 一、问题

AF-397 / AF-398 回执由 PowerShell `Set-Content` 写入 CRLF，`receipt freeze` 记录了 CRLF 内容哈希；Git 提交把文件归一为 LF，CI `worklog verify --strict --state-free` 报：

- AF-397 回执哈希不匹配
- AF-398 回执哈希不匹配

## 二、修复

- 将 AF-397 / AF-398 transport 回执统一转为 LF 存储。
- 删除旧 CRLF 记录副本，重新 `receipt freeze`，manifest 记录 LF 字节的真实 sha256。
- durable 副本同步覆盖。
- 不放宽校验、不手改回执内容。

## 三、闸门

- `node scripts/orchestration/cli.mjs worklog verify --strict --state-free`：记录包哈希全绿（AF-399 交付记录补齐后）。

## 四、说明

本任务只修记录包换行与哈希，不涉及业务代码。

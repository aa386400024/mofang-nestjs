# 公开仓密钥备份轮换清单（2026-11-23）

## 事件

`aa386400024/mofang-nestjs` 是 public 仓库。`b39c9306` 于 2026-10-15 将 `.env.bak.rsa-fix-2026-10-15` 提交入库，该文件在当前 HEAD 与历史中均可见约五周。

已确认文件包含 21 个非空敏感项，本文只记录键名，不记录任何值：

- MiniMax API Key、MiniMax ASR Token Secret
- Embedding API Key、Embedding API Key MPLAN
- Qdrant API Key
- JWT Secret、JWT Refresh Secret
- MySQL 密码、Redis 密码
- SMTP 邮箱密码
- RSA 私钥 PEM

按公开仓口径，必须视为已泄露。轮换完成前，不要假设任何一项仍然安全。

## P0 轮换清单

| 项                          | 处置                                                  | 验证                                              |
| --------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| MiniMax API Key             | 在 MiniMax 控制台吊销旧 Key，签发新 Key，更新部署环境 | 旧 Key 调用返回鉴权失败；新 Key 健康检查通过      |
| MiniMax ASR Token Secret    | 轮换 ASR token 签名密钥，重启 ASR 服务                | 旧 token 失效；新 token 可签发并完成一次 ASR 调用 |
| Embedding API Key / MPLAN   | 两套分别吊销、重签，更新对应环境                      | 旧 Key 401；新 Key 完成一次 embedding             |
| Qdrant API Key              | 轮换 Qdrant api-key，更新客户端与服务端配置           | 旧 Key 403；新 Key 可读写测试 collection          |
| JWT Secret / Refresh Secret | 生成新随机值，重启认证服务，强制全部会话失效          | 旧 access/refresh token 全部 401                  |
| MySQL 密码                  | 修改应用账号密码，更新 DB 与 Secret 存储              | 旧密码连接失败；新密码连接与迁移检查通过          |
| Redis 密码                  | 修改 requirepass，更新应用配置                        | 旧密码 NOAUTH；新密码 PING 通过                   |
| SMTP 密码                   | 在邮箱服务商侧吊销旧授权码/密码，重签                 | 旧密码认证失败；新密码发送一封测试邮件            |
| RSA 私钥 PEM                | 生成新密钥对，更新 RsaKeyService 配置，旧公钥下线     | 旧私钥解密失败；新密钥对加解密与登录链路通过      |

轮换后必须做一次真实链路回归：登录、刷新令牌、数据库读写、Redis 读写、邮件发送、ASR、Embedding、Qdrant 检索、RSA 加解密。

## 仓库侧处置

- 当前 HEAD 已删除 `.env.bak.rsa-fix-2026-10-15`。
- `.gitignore` 已阻断 `.env.bak*`、`.env.backup*`、`.env.local`、`.env.*.local`。
- 历史清理不在本任务执行。公开历史中的旧 blob 仍可被按 SHA 访问；轮换后旧值失效，历史清理放到私有化窗口：
  1. `git filter-repo --path .env.bak.rsa-fix-2026-10-15 --invert-paths`
  2. 重建所有分支与 tag，force-push
  3. 联系 GitHub Support 清理缓存视图与旧对象
  4. 或直接以干净历史重建私有仓，不复用公开仓对象
- 不在公开仓直接 `filter-repo`：会改写全部 SHA 与记录包，且无法回收已被爬取/缓存的副本。

## GitHub 侧设置

- 开启 Secret Scanning 与 Push Protection。
- 关闭 fork 或对 fork PR 设置人工审批，避免公开仓被用于消耗 Actions 或执行不受控代码。
- Actions 默认 `GITHUB_TOKEN` 只读；工作流权限逐项最小化。
- 只允许组织内已审核的 Actions 与 reusable workflow。
- 开启 Dependabot alerts 与安全更新。

## 数据面审计

仓库当前跟踪 57 个 `data/` 文件，主要是批量评测报告。逐项确认：

- 若含真实来访对话、量表答案、心理画像或自伤内容：立即从公开仓移除，迁移到私有存储，并按隐私红线脱敏。
- 若为合成评测数据：在文件头或 README 标注 `synthetic`，避免被误认为真实临床数据。
- 不把生产数据库导出、真实用户 ID、手机号、邮箱、会话原文提交到任何 Git 仓库。

## 已爬取的部分

公开页面与历史提交可能已被搜索引擎、镜像站或爬虫保存。无法逐一回收；处置顺序是：

1. 先轮换所有密钥，让旧值失效。
2. 再删除 HEAD 文件并阻断未来提交。
3. 私有化时用干净历史重建仓。
4. 必要时向搜索引擎提交缓存移除请求，但不把它当作主要防护。

## 禁止事项

- 不在 issue、PR、聊天、日志或本文中贴出任何密钥值。
- 不用 `--no-verify` 跳过提交闸门。
- 不在公开仓直接重写历史后继续使用旧远端作为唯一真相源。

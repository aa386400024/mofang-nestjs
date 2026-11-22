# AF-327 · 任务重签发记录

- 日期：2026-11-23
- 状态：`canceled`（记录包 manifest 仍显示 `backlog`，属字段语义遗留，未手改）
- 原因：`scope-domain-conflict`。AF-327 任务单 scope 含 `package.json` 与父目录 `docs/worklog/`，越出 executor Agent Card 的 `resources`（只授权 `src/` / `bin/` / `test/` / `docs/worklog/pending|completed|records`）。
- 处理：不改 Agent Card、不绕 scope 校验、不手改任务单正文；按框架受审计的 `task rescope --from AF-327 --sheet ... --apply --archive-old` 收窄 scope 并重签发为 AF-328。
- 承接：AF-328 取消新增 `package.json` 脚本，CLI 以 `pnpm exec tsx bin/visitor-text-humanization-audit.ts` 调用；实现与报告见 `docs/worklog/completed/phase2.5/af328-humanization-acceptance-v1-2026-11-23.md`。

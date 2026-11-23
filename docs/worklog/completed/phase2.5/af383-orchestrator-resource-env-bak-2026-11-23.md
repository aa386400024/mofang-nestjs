# AF-383 交付记录：编排资源域补充密钥备份路径

- 任务单：`docs/worklog/records/phase2.5-orchestration-closed-loop/AF-383/task-sheet.md`
- 基线：`31eaf7d2faabcdd5957b10cfc0ee4065e795a526`
- 日期：2026-11-23

## 改动

`docs/team/agent-orchestration/agent-cards/orchestrator.json` 的 `resources` 增加精确路径：

```text
.env.bak.rsa-fix-2026-10-15
```

只补白名单，不加通配符，不改 `limits` 与其他角色卡。

## 原因

最终清理任务需要从公开 HEAD 删除该密钥备份，但根文件不在 orchestrator 资源域内。AF-382 同内容因回执先摄入后冻结被判 rejected，本单重签并把顺序固定为“实现提交 → 回执冻结 → run-once”。

## 闸门

- `pnpm exec vitest run scripts/orchestration/__tests__/orchestration.spec.mjs`：exit 0，272 passed / 272

## 后续

文件删除后该路径成为历史白名单；保留不会扩大其他写权限。

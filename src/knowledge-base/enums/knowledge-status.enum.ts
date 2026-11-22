// V2026-10-12 (Phase 8.1 — KB 状态枚举 / SPEC §12.2 状态机):
//   4 态状态机, 跟客户端 7.3 KnowledgeStatus 严格对齐, 也跟 mofang-nestjs MySQL
//   端 knowledge_items.status enum 列对齐.
//
//   状态机 (服务端权威, 客户端仅展示 + 触发 action):
//     draft     → review      (POST /:id/submit)
//     review    → published   (POST /:id/approve)
//     review    → draft       (POST /:id/reject, 带 comment)
//     published → archived    (POST /:id/archive)
//     archived  → published   (POST /:id/restore)
//
//   治本:
//     - 不加 `pending` 态 (SPEC §12.2 没这态, 加了跟后端分裂).
//     - 不用 camelCase (跟后端 entity column 严格 wire 字符串对齐, snake_case).
//     - 不放 state machine 库 (XState machine 单独走 workflow.service, enum 是基础).

export enum KnowledgeStatus {
  Draft = 'draft',
  Review = 'review',
  Published = 'published',
  Archived = 'archived',
}

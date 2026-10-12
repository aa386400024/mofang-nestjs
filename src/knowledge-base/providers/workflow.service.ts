// V2026-10-12 (Phase 8.1 — KB 工作流状态机 / SPEC §12.2):
//   4 态状态机迁移合法性校验, 跟客户端 7.3 KnowledgeStatus 严格对应.
//
//   大厂 spec (跟 src/ai-engine/providers/crisis-detector.service.ts 同 pattern):
//     - 纯函数 + 简单 switch, 4 态 5 转换, 不引 XState (V0.x 过度)
//     - XState 留给 V1.x voice training 状态机 (5+ 态 + parallel regions + history)
//     - 业务 service (knowledge.service.ts) 在每个 action handler 开头调
//       assertTransition(from, to) 防状态机越界
//
//   状态机:
//     draft     → review      (submit)
//     review    → published   (approve)
//     review    → draft       (reject, 带 comment)
//     published → archived    (archive)
//     archived  → published   (restore)
//
//   治本:
//     - 不在 entity 加 transition 字段 (state machine 跟 source of truth 分离)
//     - 不引 XState dep (V0.x 4 态 5 转换用 switch 就够, 多了是负担)
//     - 校验 V0.x dev 路径: editor / reviewer / admin 都能 submit / approve /
//       reject / archive / restore (RBAC 内层 gate, 跟客户端 7.8 KnowledgeEditorState
//       5 个 canXxx getter 严格对应), workflow.service 不感知 role.

// V2026-10-12 治本 (Phase 8.1 — BizException import path, 跟 user/voice 等其他模块对齐).
import { Injectable } from '@nestjs/common';

import { BizCode } from '../../common/exceptions/biz-code.enum';
import { BizException } from '../../common/exceptions/biz.exception';
import { KnowledgeStatus } from '../enums/knowledge-status.enum';

/**
 * 5 个状态机转换, V0.x 简单枚举.
 */
export enum WorkflowAction {
  Submit = 'submit',
  Approve = 'approve',
  Reject = 'reject',
  Archive = 'archive',
  Restore = 'restore',
}

@Injectable()
export class WorkflowService {
  /**
   * 校验状态机转换合法性, 不合法抛 BizException(InvalidStateTransition).
   *
   * 用法: knowledge.service._submit() 开头 `this.workflow.assertTransition(item.status, KnowledgeStatus.Review, WorkflowAction.Submit)`.
   */
  public assertTransition(from: KnowledgeStatus, to: KnowledgeStatus, action: WorkflowAction): void {
    if (!this.canTransition(from, to, action)) {
      throw new BizException(BizCode.InvalidStateTransition, `非法状态机转换: ${from} → ${to} via ${action} (spec §12.2 状态机不允)`);
    }
  }

  /**
   * 状态机转换合法性查询 (无副作用, 给 BLoC 层 UI gate 用).
   *
   * V0.x: V1.x voice training 业务也用 (虽然 V1.x 拆独立 state machine).
   */
  public canTransition(from: KnowledgeStatus, to: KnowledgeStatus, action: WorkflowAction): boolean {
    // V2026-10-12 治本: 双重校验 — 不光校验 (from, to) 合法, 还校验 action 跟转换对应,
    // 防 caller 写 `submit` 但 to=published 这种错位调用.
    switch (action) {
      case WorkflowAction.Submit:
        return from === KnowledgeStatus.Draft && to === KnowledgeStatus.Review;
      case WorkflowAction.Approve:
        return from === KnowledgeStatus.Review && to === KnowledgeStatus.Published;
      case WorkflowAction.Reject:
        return from === KnowledgeStatus.Review && to === KnowledgeStatus.Draft;
      case WorkflowAction.Archive:
        return from === KnowledgeStatus.Published && to === KnowledgeStatus.Archived;
      case WorkflowAction.Restore:
        return from === KnowledgeStatus.Archived && to === KnowledgeStatus.Published;
      default:
        return false;
    }
  }

  /**
   * 拿当前状态可执行的 action 列表 — UI 按钮显隐用 (跟客户端 7.3 KnowledgeWorkflowActions widget 严格对应).
   */
  public availableActions(from: KnowledgeStatus): WorkflowAction[] {
    switch (from) {
      case KnowledgeStatus.Draft:
        return [WorkflowAction.Submit];
      case KnowledgeStatus.Review:
        return [WorkflowAction.Approve, WorkflowAction.Reject];
      case KnowledgeStatus.Published:
        return [WorkflowAction.Archive];
      case KnowledgeStatus.Archived:
        return [WorkflowAction.Restore];
      default:
        return [];
    }
  }
}

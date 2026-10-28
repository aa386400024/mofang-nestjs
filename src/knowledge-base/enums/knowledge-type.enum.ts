// V2026-10-12 (Phase 8.1 — KB 类型枚举 / SPEC §12.1):
//   5 态类型枚举, 跟客户端 7.3 KnowledgeType 严格对齐.
//
//   大厂 spec (跟 client enum 严格 wire):
//     - case       案例 (心理咨询真实或虚构案例, 督导训练用)
//     - standard   标准 (行业 / 学会发布的心理干预标准 / 指南)
//     - knowledge  知识点 (单一概念的详细解释, 颗粒度最小)
//     - enterprise 企业 (B 端客户定制内容, V1.x 配合 tenantId 强隔离)
//     - report     报告 (研究 / 行业报告, 长文本为主)

export enum KnowledgeType {
  Case = 'case',
  Standard = 'standard',
  Knowledge = 'knowledge',
  Enterprise = 'enterprise',
  Report = 'report',
}

// V2026-10-09 治本 (Persona 内存仓储 — V0.x 兜底):
//   启动 seed 3 个 demo persona (L1 / L2 / L3 各一), 覆盖所有难度路径
//   特点:
//     - 全量常驻内存, O(1) 查询 (Map.get)
//     - 多租户按 tenantId 分桶, 'default' 兜底
//     - 软删除 (isActive=false) 不返回, 但保留在 map
//   V1.x 切 TypeORM:
//     - findById → repository.findOne({ where: { id, tenantId, isActive: true } })
//     - listActive → repository.find({ where: { tenantId, isActive: true } })
//     - findDefault → repository.findOne({ where: { tenantId, isDefault: true } })
//   接口零变化, 上层 VisitorService / VoiceService 无感知
//
//   反双胞胎:
//     - 不用 lodash keyBy — 原生 Map 够用, 引库增 70KB
//     - 不延迟加载 seed — 启动时一次性注入, 简单可靠
//     - 不存 session 状态 (Visitor 记忆在 VisitorService) — 单职责
//
//   如何验证:
//     1. pnpm build 无 type error
//     2. module 启动后 listActive('default').length === 3
//     3. findById 不存在 id → null, 不 throw
//     4. V1.x 切 DB 时, 接口不变, 注入 token 替换即可

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { Persona } from '../domain/entities/persona.entity';
import type { PersonaRepository } from '../domain/repositories/persona.repository';

/** V0.x 种子数据 — 3 个 persona 覆盖 L1/L2/L3. */
const SEED_PERSONAS: readonly Persona[] = [
  Object.assign(new Persona(), {
    id: 'l1_zhang',
    tenantId: 'default',
    name: '张同学',
    age: 21,
    personality: '内向但渴望被理解, 表达直接, 情感外露, 容易哭',
    complaint: '最近学习压力大, 注意力难集中, 晚上睡不着',
    background:
      '大三计算机专业学生, 正在准备考研. 父母期望高, 自我要求也高. ' +
      '最近一个月每天只能睡 4-5 小时, 白天精神恍惚, 对以前喜欢的游戏也提不起兴趣.',
    emotionBaseline: 'anxious_open' as const,
    defenseLevel: 1,
    difficulty: 'L1' as const,
    voiceId: 'mandarin_female_young',
    knowledgeRefs: [],
    isActive: true,
  }),
  Object.assign(new Persona(), {
    id: 'l2_li',
    tenantId: 'default',
    name: '李女士',
    age: 35,
    personality: '理性克制, 习惯性压抑情绪, 偶尔流露脆弱, 不轻易示弱',
    complaint: '工作和家庭难以平衡, 长期疲惫, 觉得谁都靠不住',
    background:
      '互联网公司产品总监, 孩子 3 岁. 丈夫常出差. 父母帮忙带孩子但观念冲突大. ' +
      '白天开会晚上哄睡, 已经连续 3 个月没有自己的时间. 体检指标多项异常但没空复查.',
    emotionBaseline: 'suppressed_fatigue' as const,
    defenseLevel: 3,
    difficulty: 'L2' as const,
    voiceId: 'mandarin_female_mature',
    knowledgeRefs: [],
    isActive: true,
  }),
  Object.assign(new Persona(), {
    id: 'l3_wang',
    tenantId: 'default',
    name: '王先生',
    age: 45,
    personality: '高度防御, 习惯反问和转移话题, 极少表露脆弱, 拒绝承认情绪问题',
    complaint: '失眠, 焦虑, 觉得自己情绪控制能力下降',
    background:
      '上市公司副总裁, 离异 2 年, 独自带 12 岁儿子. 离婚后开始失眠, 靠安眠药维持. ' +
      '最近一次重要会议上情绪失控摔文件, 事后深感不安但不愿承认. ' +
      '被前妻强制要求"必须接受心理辅导"才同意复探视孩子.',
    emotionBaseline: 'detached_defensive' as const,
    defenseLevel: 5,
    difficulty: 'L3' as const,
    voiceId: 'mandarin_male_mature',
    knowledgeRefs: [],
    isActive: true,
  }),
];

@Injectable()
export class PersonaRepositoryMemory implements PersonaRepository, OnModuleInit {
  private readonly logger = new Logger(PersonaRepositoryMemory.name);
  /** tenantId → (personaId → Persona). 多租户分桶, O(1) 查询. */
  private readonly byTenant = new Map<string, Map<string, Persona>>();

  onModuleInit(): void {
    this.seed(SEED_PERSONAS);
  }

  async findById(tenantId: string, id: string): Promise<Persona | null> {
    const bucket = this.byTenant.get(tenantId);
    const found = bucket?.get(id);
    return found && found.isActive ? found : null;
  }

  async listActive(tenantId: string): Promise<readonly Persona[]> {
    const bucket = this.byTenant.get(tenantId);
    if (!bucket) return [];
    return Array.from(bucket.values()).filter((p) => p.isActive);
  }

  async findDefault(tenantId: string): Promise<Persona | null> {
    const active = await this.listActive(tenantId);
    return active[0] ?? null;
  }

  // ── private ────────────────────────────────────────────────────

  private seed(personas: readonly Persona[]): void {
    for (const p of personas) {
      let bucket = this.byTenant.get(p.tenantId);
      if (!bucket) {
        bucket = new Map();
        this.byTenant.set(p.tenantId, bucket);
      }
      bucket.set(p.id, p);
    }
    this.logger.log(`[seed] tenants=${this.byTenant.size} personas=${personas.length}`);
  }
}

// V2026-10-15 治本 (V1.3 — 5 预设长程个案静态配置):
//   原因: counselor-mode-v1.0 §4.3 拍板 5 预设类型 (workplace/relationship/parenting/grief/
//     anxiety), V0.3 §13 baseline 0 长程, 1:1 wire 0 破坏. 走静态 TS config (不写
//     seed migration) 跟 V0.5 "memory mock 优先" culture 一致, 后续要扩展 (B 端企业
//     定制 / 海外文化适配) 时, 再迁 RAG + Qdrant hybrid 召回.
//
//   修法:
//     - LON_TERM_CASE_PRESETS: 5 preset, key = LongTermCaseType enum 值
//     - 每个 preset 含 5 字段: title / description / totalSessions / progressCurve / visitorPersona
//     - visitorPersona 跟 V0.x persona table 1:1 字段 (name/age/occupation/complaint/background/
//       defenseLevel/emotionBaseline/keyTopics), 方便 V1.x 真接库时把 preset 序列化进
//       long_term_cases.visitor_persona JSON 字段
//     - progressCurve 4 段: 好转 → 反复 → 突破 → 稳定 (跟 counselor-mode-v1.0 §4.3 1:1)
//
//   反双胞胎:
//     - 不写 seed migration: V0.5 风格 (静态 config 优先, V1.x 真接库再迁), 跟 user.state
//       enum 静态定义同 pattern
//     - 不预生成 4-12 次完整对话: 用户每次触发时 LLM 实时生成, memory 跨会话累积
//     - 不写 5 流派督导 prompt: V1.x W3-4 独立 VS, 本 slice 不蔓延
//     - 不存 nextSessionContext 模板: 模板由 LLM 实时生成 (跟 V0.x 6 维 supervisionReport 同 pattern)
//
//   验证:
//     1. tsc 0 错 (5 preset 字段 type 严格)
//     2. 5 key 跟 LongTermCaseType 5 值 1:1
//     3. 跟 counselor-mode-v1.0 §4.3 5 类型 cross-ref: 名称 / 次数 / 议题 1:1
//
//   时间戳: 2026-10-15

import { LongTermCaseType } from '../enums/long-term-case-type.enum';

/**
 * 单个预设长程个案模板.
 *
 * 跟 LongTermCase.config (json 字段) 1:1 对应, 后续 service 启动时可序列化进
 * long_term_cases.config JSON 字段.
 */
export interface LongTermCasePreset {
  /** 跟 LongTermCaseType enum 1:1 */
  caseType: LongTermCaseType;
  /** 个案标题 (UI 列表用) */
  title: string;
  /** 一句话描述 (UI 卡片副标题) */
  description: string;
  /** 总会话次数 (4-12) */
  totalSessions: number;
  /** 4 段进展曲线: 好转 → 反复 → 突破 → 稳定 (counselor-mode §4.3 1:1) */
  progressCurve: 'improve' | 'regress' | 'breakthrough' | 'stable';
  /** 来访者人设 (跟 V0.x persona table 字段 1:1) */
  visitorPersona: {
    name: string;
    age: number;
    occupation: string;
    /** 主诉 (一句话) */
    complaint: string;
    /** 背景故事 (2-3 句) */
    background: string;
    /** 防御层级 0.0-1.0 (0 无防御 / 1 完全封闭, 跟 V0.x persona.defenseLevel 1:1) */
    defenseLevel: number;
    /** 情绪基线 0.0-1.0 (0 极低 / 1 极正向, 跟 V0.x persona.emotionBaseline 1:1) */
    emotionBaseline: number;
    /** 关键议题 (3-5 个, 用于 LLM prompt 约束话题范围) */
    keyTopics: string[];
  };
}

/**
 * 5 预设长程个案配置 (counselor-mode-v1.0 §4.3 1:1).
 *
 * 排序按 caseType 字母序, 跟 LongTermCaseType enum 顺序一致.
 */
export const LON_TERM_CASE_PRESETS: Record<LongTermCaseType, LongTermCasePreset> = {
  // 焦虑发作 — 10 次 — 认知重构 / 暴露练习 / 复发预防
  [LongTermCaseType.ANXIETY]: {
    caseType: LongTermCaseType.ANXIETY,
    title: '焦虑发作: 认知重构 10 次',
    description: '主诉入睡困难 + 心悸手抖, 适合 CBT 认知重构 + 暴露练习 + 复发预防训练',
    totalSessions: 10,
    progressCurve: 'breakthrough',
    visitorPersona: {
      name: '李女士',
      age: 28,
      occupation: '互联网工程师',
      complaint: '近 3 个月入睡困难, 凌晨 2-3 点易醒, 伴随心悸手抖, 担心自己猝死',
      background: '新入职互联网大厂 8 个月, 连续 3 个月 OKR 压力, 1 次通宵后出现首次惊恐发作. 求助意识强, 愿意尝试放松训练.',
      defenseLevel: 0.2,
      emotionBaseline: 0.3,
      keyTopics: ['工作压力', '睡眠卫生', '惊恐发作', '自动思维', '暴露练习', '复发预防'],
    },
  },

  // 丧亲哀伤 — 6 次 — 哀伤过程 / 情绪接纳 / 意义重建
  [LongTermCaseType.GRIEF]: {
    caseType: LongTermCaseType.GRIEF,
    title: '丧亲哀伤: 父亲离世 6 次',
    description: '主诉 3 个月前父亲因病离世, 情绪低落自责, 适合哀伤过程陪伴 + 意义重建',
    totalSessions: 6,
    progressCurve: 'improve',
    visitorPersona: {
      name: '张先生',
      age: 35,
      occupation: '中学教师',
      complaint: '父亲胃癌晚期离世 3 个月, 自己一直压抑, 反复做噩梦, 内疚没能在最后陪伴',
      background: '父亲独居老家, 离世前 1 个月才回乡陪护. 自己是家中独子, 母亲身体不好由他照顾. 性格内敛, 不愿在家人面前表露悲伤.',
      defenseLevel: 0.5,
      emotionBaseline: 0.2,
      keyTopics: ['哀伤过程', '压抑情绪', '内疚感', '未尽事宜', '意义重建', '家庭关系'],
    },
  },

  // 亲子沟通困难 — 8 次 — 青春期对抗 / 教养方式 / 边界
  [LongTermCaseType.PARENTING]: {
    caseType: LongTermCaseType.PARENTING,
    title: '亲子沟通: 青春期对抗 8 次',
    description: '主诉 14 岁儿子辍学在家 1 个月, 拒绝沟通, 适合家庭边界 + 沟通模式重建',
    totalSessions: 8,
    progressCurve: 'regress',
    visitorPersona: {
      name: '王女士',
      age: 42,
      occupation: '财务经理',
      complaint: '儿子初三辍学在家 1 个月, 整天打游戏, 跟父母零交流, 自己焦虑到失眠',
      background: '夫妻关系紧张 (经常因教育理念吵架), 自己工作忙平时儿子由外婆带大. 儿子从小乖巧, 初三突然爆发, 已拒绝复学.',
      defenseLevel: 0.6,
      emotionBaseline: 0.25,
      keyTopics: ['青春期对抗', '家庭边界', '夫妻关系', '教养方式', '辍学危机', '亲子沟通'],
    },
  },

  // 亲密关系冲突 — 8 次 — 沟通模式 / 依恋创伤 / 信任问题
  [LongTermCaseType.RELATIONSHIP]: {
    caseType: LongTermCaseType.RELATIONSHIP,
    title: '亲密关系: 信任崩塌 8 次',
    description: '主诉 5 年婚姻出轨后信任崩塌, 反复争吵, 适合沟通模式 + 依恋关系重建',
    totalSessions: 8,
    progressCurve: 'regress',
    visitorPersona: {
      name: '陈女士',
      age: 32,
      occupation: '产品经理',
      complaint: '发现丈夫 3 个月前出轨 1 次, 自己反复情绪崩溃, 想离又舍不得 5 年感情和孩子',
      background: '夫妻是大学恋人, 结婚 5 年, 儿子 3 岁. 丈夫承认错误但已回归家庭, 自己无法停止翻看手机 / 反复追问细节. 父母劝离.',
      defenseLevel: 0.7,
      emotionBaseline: 0.2,
      keyTopics: ['信任崩塌', '依恋创伤', '沟通模式', '原生家庭', '离婚抉择', '孩子抚养'],
    },
  },

  // 职场适应障碍 — 6 次 — 工作压力 / 职业倦怠 / 自我怀疑
  [LongTermCaseType.WORKPLACE]: {
    caseType: LongTermCaseType.WORKPLACE,
    title: '职场适应: 入职半年焦虑 6 次',
    description: '主诉入职互联网大厂半年频繁焦虑失眠, 适合职业压力 + 自我效能重建',
    totalSessions: 6,
    progressCurve: 'stable',
    visitorPersona: {
      name: '小林',
      age: 28,
      occupation: '互联网产品经理',
      complaint: '入职新公司半年, 频繁焦虑失眠, 总觉得自己能力不够, 担心被优化',
      background: '985 本硕毕业, 之前在小公司 3 年, 跳槽到大厂发现节奏快 / 压力大 / 同事都很强. 单身, 父母在老家, 在一线城市无朋友.',
      defenseLevel: 0.4,
      emotionBaseline: 0.35,
      keyTopics: ['职业倦怠', '自我效能', '完美主义', '同事比较', '社交孤独', '身份认同'],
    },
  },
};

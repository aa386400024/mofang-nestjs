// V2026-10-15 治本 (V2.2 — 4 督导流派静态 config + 4 prompt 模板):
//   原因: counselor-mode-v1.0 §4.6 拍板 4 督导流派 + 典型反馈示例 + LLM prompt 模板,
//     V0.3 §8 baseline 0 流派配置, 1:1 wire 0 破坏. 4 流派走 DB (supervision_schools 表)
//     + 静态 TS config 双轨: 1) DB 存 name/focusAreas/exampleFeedback 持久化;
//     2) TS config 存 promptTemplate 完整模板字符串, 跟 V0.x 静态 enum / preset 风格一致.
//
//   修法:
//     - SUPERVISION_SCHOOL_PRESETS: 4 preset, key = SupervisionSchoolCode enum 值
//     - 每个 preset 含 4 字段: name / focusAreas / exampleFeedback / promptTemplate
//     - promptTemplate V0.5 mock: 简单 TS template literal, 占位符 {transcript} {persona}
//       {emotionTimeline} {visitorPersona}, 运行时拼接待 LLM
//     - 4 prompt 模板差异化: 4 流派 4 套 prompt 指令, 反映 §4.6 4 流派关注重点 (CBT
//       追踪自动思维 / 精神动力学 关注移情 / 人本 评估共情一致性 / 家庭治疗 看家庭系统)
//
//   反双胞胎:
//     - 不接 LLM provider: V0.5 阶段只生成 prompt 字符串返回, V1.x 真接 LLM 时改
//       provider 注入 (跟 W1-2 long-term-case-presets 静态 config 风格一致)
//     - 不在 TS 写完整 parser: prompt 模板走 TS template literal, V1.x LLM 升级
//       时复用 prompt 字符串
//     - 不写 4 流派 i18n: V0.x 中文, V1.x 多语言时再加 i18n layer
//     - 不存同 session 多个 feedback 在 json 字段: 走独立 supervision_feedback 表
//
//   验证:
//     1. tsc 0 错 (4 preset 字段 type 严格)
//     2. 4 key 跟 SupervisionSchoolCode 4 值 1:1
//     3. 跟 counselor-mode-v1.0 §4.6 4 流派 cross-ref: 名称 / 关注重点 / 反馈示例 1:1
//
//   时间戳: 2026-10-15

import { SupervisionSchoolCode } from '../enums/supervision-school-code.enum';

/**
 * 单个督导流派预设配置.
 *
 * 跟 SupervisionSchool entity 字段 1:1 (除 id / isActive / 时间戳), 启动时序列化进
 * supervision_schools 表, 后续 service 从 DB 读.
 */
export interface SupervisionSchoolPreset {
  /** 跟 SupervisionSchoolCode enum 1:1 */
  code: SupervisionSchoolCode;
  /** 流派中文名 (UI 列表用) */
  name: string;
  /** 关注重点 (跟 counselor-mode-v1.0 §4.6 表 1:1) */
  focusAreas: string[];
  /** 典型反馈示例 (跟 §4.6 表 1:1, UI 展示流派特征) */
  exampleFeedback: string[];
  /**
   * LLM prompt 模板 (V0.5 mock: TS template literal).
   *
   * 占位符:
   *   {transcript} - 本次 session 转录 (W1-2 LongTermCaseSession.transcript / V0.x TrainingSession.transcript)
   *   {persona} - 来访者人设 (visitor_persona json 字段)
   *   {emotionTimeline} - 情绪时间线 (V0.x TrainingSession.emotionTimeline)
   *
   * V0.5: service.generateFeedback 拼接待 LLM 字符串, 直接返 prompt 给 client (mock)
   * V1.x: 注入 LLM provider 真正调 LLM, prompt 模板不变
   */
  promptTemplate: string;
}

/**
 * 4 督导流派预设 (counselor-mode-v1.0 §4.6 1:1).
 *
 * 排序按 code 字母序, 跟 SupervisionSchoolCode enum 顺序一致.
 */
export const SUPERVISION_SCHOOL_PRESETS: Record<SupervisionSchoolCode, SupervisionSchoolPreset> = {
  // CBT 督导 — 认知扭曲 / 自动思维 / 行为激活 / 家庭作业
  [SupervisionSchoolCode.CBT]: {
    code: SupervisionSchoolCode.CBT,
    name: 'CBT 认知行为治疗督导',
    focusAreas: ['认知扭曲识别', '自动思维追踪', '行为激活', '家庭作业布置', '苏格拉底式提问'],
    exampleFeedback: [
      '你在这里没有追踪来访者的自动化思维, 来访者说『我什么都做不好』时, 你应该追问支持这个想法的证据',
      '来访者出现「全或无」认知歪曲, 你可以引导列出「灰色地带」证据',
      '家庭作业可以更具体: 建议让来访者每天记录 3 次自动思维 + 替代性解释',
    ],
    promptTemplate: `你是 CBT 认知行为治疗督导, 关注咨询师的认知行为技术使用.

【来访者人设】
{persona}

【本次会话转录】
{transcript}

【情绪时间线】
{emotionTimeline}

【督导要求】
1. 识别咨询师是否追踪来访者自动思维 (CBT 核心技术)
2. 评估咨询师对认知歪曲的识别与引导 (5 类: 全或无 / 过度概括 / 心理过滤 / 灾难化 / 个人化)
3. 检查家庭作业布置是否具体可执行
4. 评分 0-100: 倾听 25 + 提问 25 + 认知技术 30 + 作业布置 20
5. 逐句标注关键对话 (sentence + score + comment)
6. 错误分类: ['打断', '过早诊断', '未追踪自动思维', '作业模糊']
7. 1-3 句成长建议 (e.g. 下次优先用苏格拉底式提问替代直接建议)

输出结构: overallScore + perSentence + errorCategories + growthSuggestion`,
  },

  // 家庭治疗督导 — 家庭结构 / 边界 / 三角关系 / 代际模式
  [SupervisionSchoolCode.FAMILY_THERAPY]: {
    code: SupervisionSchoolCode.FAMILY_THERAPY,
    name: '家庭治疗督导',
    focusAreas: ['家庭结构', '边界', '三角关系', '代际传递模式', '中立性'],
    exampleFeedback: [
      '你只听了妈妈说, 没有邀请爸爸发言, 可能错过了家庭系统的关键信息',
      '家庭三角关系已经形成 (爸爸-妈妈-儿子), 你需要识别并打破这个模式',
      '咨询师被拉入家庭联盟, 失去中立性, 建议在下次会谈中明确角色',
    ],
    promptTemplate: `你是家庭治疗督导, 关注咨询师对家庭系统动力学的把握.

【来访者人设 / 家庭背景】
{persona}

【本次会谈转录 (可能涉及多个家庭成员)】
{transcript}

【情绪时间线】
{emotionTimeline}

【督导要求】
1. 评估咨询师是否邀请所有家庭成员发言 (避免漏听)
2. 识别家庭三角关系 / 边界问题 / 代际传递模式
3. 检查咨询师中立性 (是否被拉入某一方联盟)
4. 评分 0-100: 系统视角 30 + 中立性 25 + 邀请完整性 25 + 干预 20
5. 逐句标注家庭互动关键节点 (sentence + score + comment)
6. 错误分类: ['漏听家庭成员', '偏袒', '未识别三角关系', '边界模糊']
7. 1-3 句成长建议 (e.g. 下次画家谱图辅助, 邀请缺席成员参与)

输出结构: overallScore + perSentence + errorCategories + growthSuggestion`,
  },

  // 人本督导 — 共情一致性 / 无条件积极关注 / 真诚
  [SupervisionSchoolCode.PERSON_CENTERED]: {
    code: SupervisionSchoolCode.PERSON_CENTERED,
    name: '人本主义督导',
    focusAreas: ['共情一致性', '无条件积极关注', '真诚', '以来访者为中心'],
    exampleFeedback: [
      '你的回应看起来在共情, 但来访者可能感受到你在使用技术而不是真的在听',
      '来访者分享童年创伤时, 你没有给予情感确认, 共情一致性不足',
      '建议减少技术干预, 多用情感反映让来访者被充分听见',
    ],
    promptTemplate: `你是人本主义督导, 关注咨询师是否真正以来访者为中心.

【来访者人设】
{persona}

【本次会话转录】
{transcript}

【情绪时间线】
{emotionTimeline}

【督导要求】
1. 评估咨询师共情一致性 (Rogers 3 条件: 共情 / 无条件积极关注 / 真诚)
2. 检查是否以来访者节奏为中心 (而非咨询师议程)
3. 识别「技术化」倾向 (用话术代替真实倾听)
4. 评分 0-100: 共情 35 + 真诚 25 + 节奏 20 + 干预节制 20
5. 逐句标注情感确认时刻 (sentence + score + comment)
6. 错误分类: ['技术化', '过早建议', '情感确认不足', '抢话']
7. 1-3 句成长建议 (e.g. 下次多用情感反映, 减少开放式提问)

输出结构: overallScore + perSentence + errorCategories + growthSuggestion`,
  },

  // 精神动力学督导 — 移情 / 反移情 / 防御机制 / 早期关系模式
  [SupervisionSchoolCode.PSYCHOANALYTIC]: {
    code: SupervisionSchoolCode.PSYCHOANALYTIC,
    name: '精神动力学督导',
    focusAreas: ['移情反应', '反移情觉察', '防御机制', '早期关系模式', '自由联想'],
    exampleFeedback: [
      '来访者这次突然夸你, 这可能是正向移情, 你需要识别而不是接受赞美',
      '来访者反复强调「我必须坚强」, 这是典型的「认同于攻击者」防御机制',
      '你回避了来访者对父亲的依恋话题, 可能触发你自己的反移情, 建议自我觉察',
    ],
    promptTemplate: `你是精神动力学督导, 关注咨询师对深层动力的觉察.

【来访者人设 + 早期关系】
{persona}

【本次会话转录】
{transcript}

【情绪时间线】
{emotionTimeline}

【督导要求】
1. 识别来访者移情反应 (对咨询师的态度反映早期关系模式)
2. 评估咨询师反移情觉察 (咨询师自身情绪反应)
3. 标注来访者防御机制 (压抑 / 投射 / 否认 / 反向形成 / 升华 等)
4. 评估咨询师是否触碰核心冲突 (或回避)
5. 评分 0-100: 移情识别 25 + 防御识别 25 + 反移情 25 + 自由联想 25
6. 逐句标注深层动力 (sentence + score + comment)
7. 错误分类: ['回避核心冲突', '未识别移情', '未觉察反移情', '过度技术化']
8. 1-3 句成长建议 (e.g. 下次多倾听沉默, 留意自身情绪反应)

输出结构: overallScore + perSentence + errorCategories + growthSuggestion`,
  },
};

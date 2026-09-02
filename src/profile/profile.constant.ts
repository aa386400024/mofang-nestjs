/**
 * Profile 模块常量 — V2.0 设计文档 §Tab4 帮助 / 援助热线 (静态内容).
 *
 * 设计:
 *   - FAQ + 热线 都是静态内容, 不用走数据库
 *   - 集中放这里方便多端复用 (心塑 Flutter app + 魔方 Web / Electron)
 *   - 后续 i18n (V3) 时把文案抽到 i18n key, 这里只保留结构
 */

/**
 * 常见问题 FAQ — V2.0 §Tab4 帮助与反馈 (5 条, 心理产品高频).
 */
export const FAQS = [
  {
    id: 'faq.mental_health_definition',
    question: '心塑是心理咨询 App 吗?',
    answer:
      '心塑是循证级心理成长与自助干预工具, 不是治疗师, 不能替代专业咨询。' +
      '如有紧急情况, 请拨打「危机援助热线」或全国心理援助热线 400-161-9995。',
  },
  {
    id: 'faq.data_storage',
    question: '我的数据会被上传到哪里?',
    answer: '所有个人数据本地加密存储; 只有在你显式开启陪伴权限时, 相关状态信息才会按权限等级同步给已绑定的陪伴者。',
  },
  {
    id: 'faq.role_switching',
    question: '如何切换「成长用户 / 陪伴者」角色?',
    answer: '在「我的」Tab 头部点击「切换角色」按钮, 选择对应身份即可, 无需重新登录。',
  },
  {
    id: 'faq.assessment_privacy',
    question: '评估结果只有我能看到吗?',
    answer: '是的。所有评估结果仅本人可见; 陪伴者端只能看到你授权的风险等级, 看不到具体分数或量表内容。',
  },
  {
    id: 'faq.account_deletion',
    question: '如何删除我的账号和数据?',
    answer: '「我的」→「隐私与数据安全」→「删除我的账号」, 7 天冷静期内可撤回。',
  },
] as const;

/**
 * 危机援助热线 — V2.0 §Tab4 危机援助热线 (5 条, 必备).
 */
export const HOTLINES: readonly {
  id: string;
  name: string;
  number: string;
  description: string;
  icon: string;
  isPrimary: boolean;
}[] = [
  {
    id: 'hotline.national_400',
    name: '全国心理援助热线',
    number: '400-161-9995',
    description: '24 小时, 免费, 心理危机干预',
    icon: 'favorite_outline',
    isPrimary: true,
  },
  {
    id: 'hotline.12356',
    name: '12356 心理援助热线',
    number: '12356',
    description: '国家卫健委设立, 24 小时',
    icon: 'health_and_safety_outlined',
    isPrimary: false,
  },
  {
    id: 'hotline.120',
    name: '120 急救',
    number: '120',
    description: '人身安全紧急救助',
    icon: 'emergency_outlined',
    isPrimary: false,
  },
  {
    id: 'hotline.110',
    name: '110 公安',
    number: '110',
    description: '人身威胁 / 自伤他伤风险',
    icon: 'shield_outlined',
    isPrimary: false,
  },
  {
    id: 'hotline.bj_crisis',
    name: '北京心理危机研究与干预中心',
    number: '010-82951332',
    description: '工作日 9:00-17:00',
    icon: 'support_outlined',
    isPrimary: false,
  },
];

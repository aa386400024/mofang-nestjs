// V2026-10-22 治本 (V1.3 §2.1 — practice_scenarios.persona.emotionIntensity 3 档 enum):
//   原因: spec §1.2 把难度梯 L1/L2/L3 定义成「情绪负荷」三档:
//     L1 入门 = 情绪平静、配合、议题清晰
//     L2 进阶 = 情绪有波动 / 有防御 / 混合矛盾
//     L3 困难 = 情绪负荷高或阻抗明显 (前端弹「高情绪负荷场景, 可随时退出」轻提示)
//     情绪负荷是**来访者当前的唤醒水平**, 与「防御风格」(应对方式) 是两个正交维度:
//     同为 stoic, L2 的来访问者只是压着一点情绪, L3 的是压不住了.
//     两者若混成一个字段, 难度梯与内容库就再也无法解耦.
//   修法: 定义 PracticeEmotionIntensity 3 档 enum (calm / elevated / acute),
//     跟防御风格正交, 单独成字段.
//
//   反双胞胎:
//     - 不跟防御风格合并成一个"难度"字段: 难度由 difficulty (int 1/2/3) 承担,
//       情绪负荷由本 enum 承担, 两者语义不同层
//     - 不用连续数值 (0-100 情绪强度): 微技能练习只需要离散档位, 连续值不可枚举、
//       不可校验, 且会让内容库出现 37 / 62 这类无意义的伪精度
//     - 不用 MySQL ENUM 列类型: 跟项目既有的 varchar + 应用层 enum pattern 一致
//
//   验证:
//     1. tsc 0 错
//     2. 60 条 seed 场景的 emotionIntensity 全部落在 3 档内, 且与 difficulty 档位正相关
//        (L1 → calm / L2 → elevated 或 calm / L3 → acute 或 elevated)
//
//   时间戳: 2026-10-22

/**
 * 来访者情绪负荷 3 档 (V1.3 §1.2 难度梯定义).
 */
export enum PracticeEmotionIntensity {
  /** 情绪平静 (L1 标配; L2/L3 也可能出现, 如"表面平静但议题沉重") */
  CALM = 'calm',
  /** 情绪有波动 (L2 标配) */
  ELEVATED = 'elevated',
  /** 情绪负荷高 (L3 标配, 前端弹「高情绪负荷场景, 可随时退出」轻提示) */
  ACUTE = 'acute',
}

/** 情绪负荷的展示文案 (server 单一事实源). */
export const PRACTICE_EMOTION_INTENSITY_LABELS: Record<PracticeEmotionIntensity, string> = {
  [PracticeEmotionIntensity.CALM]: '情绪平静',
  [PracticeEmotionIntensity.ELEVATED]: '情绪波动',
  [PracticeEmotionIntensity.ACUTE]: '情绪负荷高',
};

/**
 * L3 高负荷场景的知情同意式铺垫文案.
 *
 * spec §1.2: 「L3 前端弹『高情绪负荷场景, 可随时退出』轻提示 (知情同意式铺垫, 不阻挡)」.
 * server 下发该文案, 避免客户端各写一份文案 (文案漂移).
 */
export const PRACTICE_HIGH_LOAD_NOTICE = '这是一个情绪负荷较高的场景，可以随时退出，不用有压力。';

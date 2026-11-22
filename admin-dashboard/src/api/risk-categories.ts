// PsyGUARD 风险类别中文映射与解释
export const RISK_CATEGORY_MAP: Record<string, { label: string; desc: string }> = {
  suicide_plan: { label: '自杀计划', desc: '来访者表达了具体的自杀计划、时间、方式或准备行为' },
  passive_ideation: { label: '被动自杀意念', desc: '来访者有自杀的想法或愿望，但无具体计划，如"活着没什么意思""不想活了"' },
  self_harm_ideation: { label: '自伤意念', desc: '来访者表达了自我伤害的想法或行为，如割伤、烫伤自己等' },
  neutral: { label: '正常对话', desc: '无风险信号，正常的咨询对话内容' },
}

export const getRiskLabel = (cat: string) => RISK_CATEGORY_MAP[cat]?.label ?? cat
export const getRiskDesc = (cat: string) => RISK_CATEGORY_MAP[cat]?.desc ?? '—'

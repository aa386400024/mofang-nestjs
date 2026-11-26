import { http } from './client'

/** 与后端 MembershipPromotionStatus / Audience / BillingPeriod 1:1（don't drift）。 */
export type PromotionStatus = 'draft' | 'active' | 'paused' | 'ended'
export type PromotionAudience = 'first_purchase' | 'all'
export type PromotionBillingPeriod = 'monthly' | 'annual'
export type PromotionTier = 'plus' | 'pro' | 'max'

export interface MembershipPromotion {
  id: string
  code: string
  name: string
  description: string
  status: PromotionStatus
  billingPeriod: PromotionBillingPeriod
  audience: PromotionAudience
  autoApply: boolean
  startsAt: string
  endsAt: string
  prices: Partial<Record<PromotionTier, number>>
  floors: Partial<Record<PromotionTier, number>>
  giftMinutes: Partial<Record<PromotionTier, number>>
  budgetCents: number | null
  perUserLimit: number
  priority: number
  ruleVersion: string
  createdAt: string
  updatedAt: string
}

export interface MembershipPromotionStats {
  promotionId: string
  redemptionCount: number
  discountCents: number
  grantedMinutes: number
  budgetCents: number | null
  budgetRemainingCents: number | null
  perUserLimit: number
  reservedCount: number
  reservedCents: number
}

export interface PromotionListQuery {
  status?: PromotionStatus
  billingPeriod?: PromotionBillingPeriod
  page?: number
  pageSize?: number
}

export interface PromotionListResponse {
  items: MembershipPromotion[]
  total: number
  page: number
  pageSize: number
}

/** 创建/更新共用字段；价格等以“分”或分钟为单位，整体可选。 */
export interface PromotionWriteBody {
  code: string
  name: string
  description?: string
  billingPeriod: PromotionBillingPeriod
  audience: PromotionAudience
  autoApply?: boolean
  startsAt: string
  endsAt: string
  prices?: Partial<Record<PromotionTier, number>>
  floors?: Partial<Record<PromotionTier, number>>
  giftMinutes?: Partial<Record<PromotionTier, number>>
  budgetCents?: number | null
  perUserLimit?: number
  priority?: number
}

const BASE = '/membership/promotions'

export const membershipPromotions = {
  list: (params?: PromotionListQuery): Promise<PromotionListResponse> => {
    const q = new URLSearchParams()
    Object.entries(params ?? {}).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.set(k, String(v))
    })
    const qs = q.toString()
    return http.get<PromotionListResponse>(`${BASE}${qs ? `?${qs}` : ''}`)
  },
  get: (id: string): Promise<MembershipPromotion> => http.get<MembershipPromotion>(`${BASE}/${id}`),
  create: (body: PromotionWriteBody): Promise<MembershipPromotion> =>
    http.post<MembershipPromotion>(BASE, body),
  update: (id: string, body: Partial<PromotionWriteBody>): Promise<MembershipPromotion> =>
    http.patch<MembershipPromotion>(`${BASE}/${id}`, body),
  activate: (id: string): Promise<MembershipPromotion> =>
    http.post<MembershipPromotion>(`${BASE}/${id}/activate`, {}),
  pause: (id: string): Promise<MembershipPromotion> =>
    http.post<MembershipPromotion>(`${BASE}/${id}/pause`, {}),
  remove: (id: string): Promise<{ removed: true }> => http.del<{ removed: true }>(`${BASE}/${id}`),
  stats: (id: string): Promise<MembershipPromotionStats> => http.get<MembershipPromotionStats>(`${BASE}/${id}/stats`),
}

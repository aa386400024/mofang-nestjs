<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { NButton, NDatePicker, NInput, NInputNumber, NModal, NPagination, NSelect, NSwitch, NTag } from 'naive-ui'
import {
  membershipPromotions,
  type MembershipPromotion,
  type MembershipPromotionStats,
  type PromotionAudience,
  type PromotionBillingPeriod,
  type PromotionStatus,
  type PromotionTier,
  type PromotionWriteBody,
} from '@/api/membership-promotion'
import EmptyState from '@/components/EmptyState.vue'
import Skeleton from '@/components/Skeleton.vue'

const statusLabel: Record<PromotionStatus, string> = {
  draft: '草稿', active: '进行中', paused: '已暂停', ended: '已结束',
}
const statusTag: Record<PromotionStatus, 'default' | 'success' | 'warning' | 'error'> = {
  draft: 'default', active: 'success', paused: 'warning', ended: 'error',
}
const audienceLabel: Record<PromotionAudience, string> = {
  first_purchase: '首购用户', all: '全体付费用户',
}
const periodLabel: Record<PromotionBillingPeriod, string> = { monthly: '月付', annual: '年付' }
const tiers: PromotionTier[] = ['plus', 'pro', 'max']

const rows = ref<MembershipPromotion[]>([])
const total = ref(0)
const loading = ref(true)
const err = ref('')
const notice = ref('')
const page = ref(1)
const pageSize = 20
const filterStatus = ref<PromotionStatus | ''>('')
const filterPeriod = ref<PromotionBillingPeriod | ''>('')

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

async function load() {
  loading.value = true
  err.value = ''
  try {
    const res = await membershipPromotions.list({
      status: filterStatus.value || undefined,
      billingPeriod: filterPeriod.value || undefined,
      page: page.value,
      pageSize,
    })
    rows.value = res.items
    total.value = res.total
  } catch (e) {
    err.value = String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([filterStatus, filterPeriod], () => { page.value = 1; load() })
watch(page, load)

// ─── 新建 / 编辑 ───
const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const formErr = ref('')

interface EditorForm {
  code: string
  name: string
  description: string
  billingPeriod: PromotionBillingPeriod
  audience: PromotionAudience
  autoApply: boolean
  startsAt: number | null
  endsAt: number | null
  priceYuan: Record<PromotionTier, number | null>
  floorYuan: Record<PromotionTier, number | null>
  giftMinutes: Record<PromotionTier, number | null>
  budgetYuan: number | null
  perUserLimit: number
  priority: number
}

function emptyForm(): EditorForm {
  const now = Date.now()
  return {
    code: '', name: '', description: '',
    billingPeriod: 'monthly', audience: 'first_purchase', autoApply: true,
    startsAt: now, endsAt: now + 30 * 24 * 3600 * 1000,
    priceYuan: { plus: null, pro: null, max: null },
    floorYuan: { plus: null, pro: null, max: null },
    giftMinutes: { plus: null, pro: null, max: null },
    budgetYuan: null, perUserLimit: 1, priority: 100,
  }
}

const form = reactive<EditorForm>(emptyForm())

function fillForm(p: MembershipPromotion) {
  form.code = p.code
  form.name = p.name
  form.description = p.description ?? ''
  form.billingPeriod = p.billingPeriod
  form.audience = p.audience
  form.autoApply = p.autoApply
  form.startsAt = Date.parse(p.startsAt)
  form.endsAt = Date.parse(p.endsAt)
  tiers.forEach((tier) => {
    form.priceYuan[tier] = p.prices?.[tier] != null ? p.prices[tier]! / 100 : null
    form.floorYuan[tier] = p.floors?.[tier] != null ? p.floors[tier]! / 100 : null
    form.giftMinutes[tier] = p.giftMinutes?.[tier] ?? null
  })
  form.budgetYuan = p.budgetCents != null ? p.budgetCents / 100 : null
  form.perUserLimit = p.perUserLimit
  form.priority = p.priority
}

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  formErr.value = ''
  editorOpen.value = true
}

async function openEdit(p: MembershipPromotion) {
  editingId.value = p.id
  formErr.value = ''
  editorOpen.value = true
  fillForm(p)
}

function mapRecord(src: Record<PromotionTier, number | null>, scale = 1): Partial<Record<PromotionTier, number>> {
  const out: Partial<Record<PromotionTier, number>> = {}
  tiers.forEach((tier) => {
    const v = src[tier]
    if (v != null && v > 0) out[tier] = Math.round(v * scale)
  })
  return out
}

function buildBody(): PromotionWriteBody | null {
  if (!form.code.trim() || !form.name.trim()) {
    formErr.value = '活动码与名称必填'
    return null
  }
  if (!form.startsAt || !form.endsAt || form.endsAt <= form.startsAt) {
    formErr.value = '结束时间必须晚于开始时间'
    return null
  }
  const prices = mapRecord(form.priceYuan, 100)
  if (Object.keys(prices).length === 0) {
    formErr.value = '至少填写一档活动价'
    return null
  }
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    billingPeriod: form.billingPeriod,
    audience: form.audience,
    autoApply: form.autoApply,
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: new Date(form.endsAt).toISOString(),
    prices,
    floors: mapRecord(form.floorYuan, 100),
    giftMinutes: mapRecord(form.giftMinutes),
    budgetCents: form.budgetYuan != null ? Math.round(form.budgetYuan * 100) : null,
    perUserLimit: form.perUserLimit,
    priority: form.priority,
  }
}

async function save() {
  const body = buildBody()
  if (!body) return
  saving.value = true
  formErr.value = ''
  try {
    if (editingId.value) await membershipPromotions.update(editingId.value, body)
    else await membershipPromotions.create(body)
    editorOpen.value = false
    notice.value = editingId.value ? '活动已更新' : '活动已创建'
    await load()
  } catch (e) {
    formErr.value = String(e)
  } finally {
    saving.value = false
  }
}

// ─── 状态流转 / 删除 ───
const actingId = ref<string | null>(null)

async function activate(p: MembershipPromotion) {
  actingId.value = p.id
  try { await membershipPromotions.activate(p.id); notice.value = '活动已启用'; await load() }
  catch (e) { notice.value = String(e) }
  finally { actingId.value = null }
}
async function pause(p: MembershipPromotion) {
  actingId.value = p.id
  try { await membershipPromotions.pause(p.id); notice.value = '活动已暂停'; await load() }
  catch (e) { notice.value = String(e) }
  finally { actingId.value = null }
}
async function remove(p: MembershipPromotion) {
  if (!window.confirm(`确认删除活动「${p.name}」？仅草稿/已暂停活动允许删除。`)) return
  actingId.value = p.id
  try { await membershipPromotions.remove(p.id); notice.value = '活动已删除'; await load() }
  catch (e) { notice.value = String(e) }
  finally { actingId.value = null }
}

// ─── 效果统计 ───
const statsOpen = ref(false)
const statsLoading = ref(false)
const stats = ref<MembershipPromotionStats | null>(null)
const statsName = ref('')

async function openStats(p: MembershipPromotion) {
  statsOpen.value = true
  statsLoading.value = true
  statsName.value = p.name
  stats.value = null
  try { stats.value = await membershipPromotions.stats(p.id) }
  catch (e) { notice.value = String(e) }
  finally { statsLoading.value = false }
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function yuan(cents: number | null | undefined): string {
  return cents == null ? '不限' : `¥${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-lg font-semibold text-gray-100">会员活动</h1>
        <p class="text-xs text-muted mt-1">
          活动价、底价、赠送分钟、预算与单用户限次。价格以“元”填写，服务端按“分”存储；启用后未传活动码的订单按 autoApply 自动命中。
        </p>
      </div>
      <NButton type="primary" size="small" @click="openCreate">新建活动</NButton>
    </div>

    <div class="flex flex-wrap gap-3 mb-4 items-center">
      <NSelect
        v-model:value="filterStatus"
        :options="[
          { label: '全部状态', value: '' },
          { label: '草稿', value: 'draft' },
          { label: '进行中', value: 'active' },
          { label: '已暂停', value: 'paused' },
          { label: '已结束', value: 'ended' },
        ]"
        size="small"
        class="w-36"
      />
      <NSelect
        v-model:value="filterPeriod"
        :options="[
          { label: '全部周期', value: '' },
          { label: '月付', value: 'monthly' },
          { label: '年付', value: 'annual' },
        ]"
        size="small"
        class="w-36"
      />
      <span v-if="notice" class="text-xs text-amber-400">{{ notice }}</span>
    </div>

    <Skeleton v-if="loading" type="card-list" :count="5" />
    <EmptyState
      v-else-if="err"
      icon="warning"
      title="加载失败"
      :description="err"
      retry-text="重试"
      @retry="load"
    />
    <EmptyState
      v-else-if="rows.length === 0"
      icon="shield"
      title="暂无会员活动"
      description="新建活动后在这里管理价格、预算与启停"
    />

    <div v-else class="space-y-2">
      <div v-for="p in rows" :key="p.id" class="card p-4">
        <div class="flex flex-wrap items-center gap-3">
          <NTag :type="statusTag[p.status]" size="small" :bordered="false">{{ statusLabel[p.status] }}</NTag>
          <span class="text-sm font-medium text-gray-100">{{ p.name }}</span>
          <span class="text-xs font-mono text-muted">{{ p.code }}</span>
          <span class="text-xs text-muted">{{ periodLabel[p.billingPeriod] }} · {{ audienceLabel[p.audience] }}</span>
          <span v-if="p.autoApply" class="text-[10px] text-emerald-400">自动命中</span>
          <span class="text-xs text-muted ml-auto">{{ formatTime(p.startsAt) }} → {{ formatTime(p.endsAt) }}</span>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
          <div>
            <div class="text-muted mb-1">活动价（元）</div>
            <div class="font-mono text-gray-300">
              <span v-for="tier in tiers" :key="tier" class="mr-2">
                {{ tier }} {{ p.prices?.[tier] != null ? (p.prices[tier]! / 100).toFixed(2) : '—' }}
              </span>
            </div>
          </div>
          <div>
            <div class="text-muted mb-1">赠送分钟</div>
            <div class="font-mono text-gray-300">
              <span v-for="tier in tiers" :key="tier" class="mr-2">{{ tier }} {{ p.giftMinutes?.[tier] ?? 0 }}</span>
            </div>
          </div>
          <div>
            <div class="text-muted mb-1">预算 / 单用户限次</div>
            <div class="font-mono text-gray-300">{{ yuan(p.budgetCents) }} / {{ p.perUserLimit }} 次</div>
          </div>
          <div>
            <div class="text-muted mb-1">优先级 / 规则版本</div>
            <div class="font-mono text-gray-300">{{ p.priority }} · {{ p.ruleVersion }}</div>
          </div>
        </div>

        <div class="flex flex-wrap gap-2 mt-4">
          <NButton size="tiny" @click="openStats(p)">效果统计</NButton>
          <NButton size="tiny" @click="openEdit(p)">编辑</NButton>
          <NButton v-if="p.status === 'draft' || p.status === 'paused'" size="tiny" type="primary" :loading="actingId === p.id" @click="activate(p)">启用</NButton>
          <NButton v-if="p.status === 'active'" size="tiny" type="warning" :loading="actingId === p.id" @click="pause(p)">暂停</NButton>
          <NButton v-if="p.status === 'draft' || p.status === 'paused'" size="tiny" type="error" :loading="actingId === p.id" @click="remove(p)">删除</NButton>
        </div>
      </div>
    </div>

    <div v-if="total > pageSize" class="flex justify-center mt-6">
      <NPagination v-model:page="page" :page-count="pageCount" size="small" />
    </div>

    <!-- 新建 / 编辑 -->
    <NModal v-model:show="editorOpen" preset="card" class="w-[760px] max-w-[92vw]" :title="editingId ? '编辑会员活动' : '新建会员活动'">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div class="text-xs text-muted mb-1">活动码（大写字母/数字/下划线）</div>
          <NInput v-model:value="form.code" placeholder="FIRST_MONTHLY" :disabled="!!editingId" />
        </div>
        <div>
          <div class="text-xs text-muted mb-1">活动名称</div>
          <NInput v-model:value="form.name" placeholder="新用户首期活动" />
        </div>
        <div class="md:col-span-2">
          <div class="text-xs text-muted mb-1">活动说明</div>
          <NInput v-model:value="form.description" type="textarea" :rows="2" placeholder="可选" />
        </div>
        <div>
          <div class="text-xs text-muted mb-1">计费周期</div>
          <NSelect v-model:value="form.billingPeriod" :options="[{ label: '月付', value: 'monthly' }, { label: '年付', value: 'annual' }]" />
        </div>
        <div>
          <div class="text-xs text-muted mb-1">受众</div>
          <NSelect v-model:value="form.audience" :options="[{ label: '首购用户', value: 'first_purchase' }, { label: '全体付费用户', value: 'all' }]" />
        </div>
        <div>
          <div class="text-xs text-muted mb-1">开始时间</div>
          <NDatePicker v-model:value="form.startsAt" type="datetime" class="w-full" />
        </div>
        <div>
          <div class="text-xs text-muted mb-1">结束时间</div>
          <NDatePicker v-model:value="form.endsAt" type="datetime" class="w-full" />
        </div>
      </div>

      <div class="mt-4">
        <div class="text-xs uppercase tracking-wider text-muted mb-2">分档价格（元）</div>
        <div class="grid grid-cols-3 gap-3">
          <div v-for="tier in tiers" :key="tier">
            <div class="text-xs text-muted mb-1">{{ tier }}</div>
            <NInputNumber v-model:value="form.priceYuan[tier]" :min="0" :precision="2" placeholder="活动价" class="w-full" />
          </div>
        </div>
      </div>

      <div class="mt-4">
        <div class="text-xs uppercase tracking-wider text-muted mb-2">分档底价 / 赠送分钟（可选）</div>
        <div class="grid grid-cols-3 gap-3">
          <div v-for="tier in tiers" :key="tier">
            <div class="text-xs text-muted mb-1">{{ tier }}</div>
            <NInputNumber v-model:value="form.floorYuan[tier]" :min="0" :precision="2" placeholder="底价（元）" class="w-full mb-2" />
            <NInputNumber v-model:value="form.giftMinutes[tier]" :min="0" :precision="0" placeholder="赠送分钟" class="w-full" />
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <div>
          <div class="text-xs text-muted mb-1">总预算（元，留空=不限）</div>
          <NInputNumber v-model:value="form.budgetYuan" :min="0" :precision="2" class="w-full" />
        </div>
        <div>
          <div class="text-xs text-muted mb-1">单用户可兑换次数</div>
          <NInputNumber v-model:value="form.perUserLimit" :min="1" :max="1000" :precision="0" class="w-full" />
        </div>
        <div>
          <div class="text-xs text-muted mb-1">优先级（越大越先命中）</div>
          <NInputNumber v-model:value="form.priority" :min="0" :precision="0" class="w-full" />
        </div>
      </div>

      <div class="flex items-center gap-3 mt-4">
        <NSwitch v-model:value="form.autoApply" />
        <span class="text-xs text-gray-300">未传活动码时自动命中（autoApply）</span>
      </div>

      <div v-if="formErr" class="text-xs text-red-400 mt-3">{{ formErr }}</div>
      <div class="flex justify-end gap-2 mt-5">
        <NButton size="small" @click="editorOpen = false">取消</NButton>
        <NButton size="small" type="primary" :loading="saving" @click="save">保存</NButton>
      </div>
    </NModal>

    <!-- 效果统计 -->
    <NModal v-model:show="statsOpen" preset="card" class="w-[520px] max-w-[92vw]" :title="`效果统计 · ${statsName}`">
      <Skeleton v-if="statsLoading" type="card-list" :count="2" />
      <div v-else-if="stats" class="grid grid-cols-2 gap-3 text-sm">
        <div class="card p-3"><div class="text-xs text-muted mb-1">兑换次数</div><div class="font-mono text-gray-100">{{ stats.redemptionCount }}</div></div>
        <div class="card p-3"><div class="text-xs text-muted mb-1">累计优惠</div><div class="font-mono text-gray-100">{{ yuan(stats.discountCents) }}</div></div>
        <div class="card p-3"><div class="text-xs text-muted mb-1">累计赠送分钟</div><div class="font-mono text-gray-100">{{ stats.grantedMinutes }}</div></div>
        <div class="card p-3"><div class="text-xs text-muted mb-1">预算剩余</div><div class="font-mono text-gray-100">{{ yuan(stats.budgetRemainingCents) }}</div></div>
        <div class="card p-3"><div class="text-xs text-muted mb-1">预占单数 / 金额</div><div class="font-mono text-gray-100">{{ stats.reservedCount }} · {{ yuan(stats.reservedCents) }}</div></div>
        <div class="card p-3"><div class="text-xs text-muted mb-1">单用户限次</div><div class="font-mono text-gray-100">{{ stats.perUserLimit }}</div></div>
      </div>
    </NModal>
  </div>
</template>

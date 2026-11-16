<script setup lang="ts">
// 骨架屏加载组件
// 用法：<Skeleton type="card-list" :count="5" />

interface Props {
  type?: 'card-list' | 'stats-cards' | 'table' | 'detail'
  count?: number
}

withDefaults(defineProps<Props>(), {
  type: 'card-list',
  count: 3,
})
</script>

<template>
  <!-- 卡片列表骨架屏 -->
  <div v-if="type === 'card-list'" class="space-y-3">
    <div v-for="i in count" :key="i" class="card p-4 animate-pulse">
      <div class="flex items-center justify-between mb-3">
        <div class="h-4 w-32 bg-bg-elevated rounded"></div>
        <div class="h-4 w-16 bg-bg-elevated rounded"></div>
      </div>
      <div class="space-y-2">
        <div class="h-3 w-full bg-bg-elevated rounded"></div>
        <div class="h-3 w-2/3 bg-bg-elevated rounded"></div>
      </div>
    </div>
  </div>

  <!-- 统计卡片骨架屏 -->
  <div v-else-if="type === 'stats-cards'" class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div v-for="i in 4" :key="i" class="card p-4 animate-pulse">
      <div class="h-3 w-20 bg-bg-elevated rounded mb-2"></div>
      <div class="h-7 w-16 bg-bg-elevated rounded"></div>
    </div>
  </div>

  <!-- 表格骨架屏 -->
  <div v-else-if="type === 'table'" class="card p-4 animate-pulse">
    <div class="space-y-3">
      <div class="h-4 w-full bg-bg-elevated rounded"></div>
      <div class="h-4 w-full bg-bg-elevated rounded"></div>
      <div class="h-4 w-full bg-bg-elevated rounded"></div>
      <div class="h-4 w-3/4 bg-bg-elevated rounded"></div>
    </div>
  </div>

  <!-- 详情页骨架屏 -->
  <div v-else class="space-y-4 animate-pulse">
    <div class="h-8 w-48 bg-bg-elevated rounded"></div>
    <div class="grid grid-cols-3 gap-4">
      <div v-for="i in 3" :key="i" class="card p-4">
        <div class="h-3 w-20 bg-bg-elevated rounded mb-2"></div>
        <div class="h-6 w-12 bg-bg-elevated rounded"></div>
      </div>
    </div>
    <div class="card p-6">
      <div class="space-y-2">
        <div class="h-4 w-full bg-bg-elevated rounded"></div>
        <div class="h-4 w-full bg-bg-elevated rounded"></div>
        <div class="h-4 w-2/3 bg-bg-elevated rounded"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useFreightStore } from "../store";
import { QUOTE_STATUSES, SERVICES } from "../types";
import QuoteCard from "./QuoteCard.vue";

const store = useFreightStore();

const statusFilter = ref("全部");
const serviceFilter = ref("全部服务");
const onlyStale = ref(false);

const filtered = computed(() => {
  return store.quotes
    .filter((q) => statusFilter.value === "全部" || q.status === statusFilter.value)
    .filter((q) => serviceFilter.value === "全部服务" || q.service === serviceFilter.value)
    .filter((q) => !onlyStale.value || store.isStale(q))
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
});
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>报价列表</h2>
      <div class="filters">
        <select v-model="statusFilter">
          <option>全部</option>
          <option v-for="s in QUOTE_STATUSES" :key="s">{{ s }}</option>
        </select>
        <select v-model="serviceFilter">
          <option>全部服务</option>
          <option v-for="s in SERVICES" :key="s">{{ s }}</option>
        </select>
        <label class="check">
          <input v-model="onlyStale" type="checkbox" />
          只看旧金额（待重算）
        </label>
      </div>
    </div>

    <div class="record-grid">
      <div v-if="filtered.length === 0" class="empty">暂无匹配报价</div>
      <QuoteCard v-for="q in filtered" :key="q.id" :quote="q" />
    </div>
  </section>
</template>

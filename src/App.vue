<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { usePricingStore } from "./store";
import { USERS, ROLE_LABEL, formatDate } from "./pricing";
import QuotePanel from "./components/QuotePanel.vue";
import ApprovalPanel from "./components/ApprovalPanel.vue";
import PriceBookPanel from "./components/PriceBookPanel.vue";
import AuditPanel from "./components/AuditPanel.vue";

const store = usePricingStore();

const tabs = ["报价管理", "特价审批", "价表管理", "审计留档"] as const;
type Tab = (typeof tabs)[number];
const activeTab = ref<Tab>("报价管理");

const chartRows = ["待确认", "特价待批", "特价待确认", "已锁定"].map((status) => ({
  status,
  value: store.quotes.filter((q) => q.status === status).length
}));
const maxChart = Math.max(1, ...chartRows.map((r) => r.value));

let timer: number | undefined;
onMounted(() => {
  timer = window.setInterval(() => store.tick(), 60000);
});
onUnmounted(() => window.clearInterval(timer));

function advance(days: number) {
  store.setClockOffset(days);
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流报价 · 价表版本化 · 特价分级审批</p>
          <h1>物流报价与特价审批系统</h1>
          <p class="subtitle">
            按线路、重量、服务匹配当前价表试算（基础价/附加费/折扣逐项列明）；客户确认后金额锁定，换版只影响未确认报价；
            特价申请分级审批、到期作废、全程留档。
          </p>
        </div>
        <div class="topbar-side">
          <div class="role-box">
            <label class="role-label">当前身份
              <select :value="store.currentUserId" @change="store.switchUser(($event.target as HTMLSelectElement).value)">
                <option v-for="u in USERS" :key="u.id" :value="u.id">
                  {{ u.name }}（{{ ROLE_LABEL[u.role] }}）
                </option>
              </select>
            </label>
          </div>
          <div class="clock-box">
            <p>演示时钟：{{ formatDate(store.now) }}</p>
            <div class="clock-btns">
              <button type="button" class="small secondary" @click="advance(0)">回到今天</button>
              <button type="button" class="small secondary" @click="advance(2)">快进2天</button>
              <button type="button" class="small secondary" @click="advance(4)">快进4天</button>
            </div>
          </div>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in store.metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t"
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === t }"
          @click="activeTab = t"
        >
          {{ t }}
          <span
            v-if="t === '特价审批' && store.pendingCount > 0 && store.isApprover"
            class="badge"
          >{{ store.pendingCount }}</span>
        </button>
      </nav>

      <QuotePanel v-if="activeTab === '报价管理'" />
      <ApprovalPanel v-else-if="activeTab === '特价审批'" />
      <PriceBookPanel v-else-if="activeTab === '价表管理'" />
      <AuditPanel v-else />

      <section v-if="activeTab === '报价管理'" class="mini-chart panel-chart">
        <h3>报价状态分布</h3>
        <div v-for="row in chartRows" :key="row.status" class="bar">
          <span>{{ row.status }}</span>
          <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
          <strong>{{ row.value }}</strong>
        </div>
      </section>
    </div>
  </main>
</template>

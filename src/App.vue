<script setup lang="ts">
import { onUnmounted, ref } from "vue";
import { useFreightStore, USERS } from "./store";
import type { Role } from "./types";
import QuoteForm from "./components/QuoteForm.vue";
import QuoteList from "./components/QuoteList.vue";
import ApprovalCenter from "./components/ApprovalCenter.vue";
import PriceManager from "./components/PriceManager.vue";
import AuditLog from "./components/AuditLog.vue";

const store = useFreightStore();
type Tab = "quotes" | "approval" | "price" | "audit";
const tab = ref<Tab>("quotes");

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "quotes", label: "报价与锁价" },
  { key: "approval", label: "特价审批" },
  { key: "price", label: "价表管理" },
  { key: "audit", label: "留档查询" }
];

// 进入页面先清理一次过期特价申请，之后每 30 秒扫描
store.sweepExpired();
const timer = window.setInterval(() => store.sweepExpired(), 30000);
onUnmounted(() => window.clearInterval(timer));

function changeRole(role: Role) {
  store.switchRole(role);
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流报价 · 价表匹配与特价审批闭环</p>
          <h1>物流报价与特价审批</h1>
          <p class="subtitle">
            按线路、重量阶梯和服务匹配当前价表，列明基础价、附加费与折扣；客户确认后金额锁定，价表换版只影响未确认报价。
            特价须申请审批，逾期自动作废。
          </p>
        </div>
        <div class="role-box">
          <p class="role-label">当前身份</p>
          <div class="role-switch">
            <button
              type="button"
              :class="store.role === 'sales' ? '' : 'secondary'"
              @click="changeRole('sales')"
            >
              业务员
            </button>
            <button
              type="button"
              :class="store.role === 'approver' ? '' : 'secondary'"
              @click="changeRole('approver')"
            >
              审批人
            </button>
          </div>
          <p class="role-name">{{ USERS[store.role] }}</p>
          <button type="button" class="reset-btn" @click="store.resetDemo()">恢复演示数据</button>
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
          :key="t.key"
          type="button"
          :class="tab === t.key ? 'tab active' : 'tab'"
          @click="tab = t.key"
        >
          {{ t.label }}
          <span v-if="t.key === 'approval' && store.pendingApplications.length" class="badge">
            {{ store.pendingApplications.length }}
          </span>
        </button>
      </nav>

      <section v-if="tab === 'quotes'" class="workspace">
        <QuoteForm />
        <QuoteList />
      </section>

      <section v-else-if="tab === 'approval'" class="single-col">
        <ApprovalCenter />
      </section>

      <section v-else-if="tab === 'price'" class="single-col">
        <PriceManager />
      </section>

      <section v-else class="single-col">
        <AuditLog />
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { usePricingStore } from "../store";
import { formatDate } from "../pricing";
import type { AuditModule } from "../types";

const store = usePricingStore();

const modules: ("全部" | AuditModule)[] = ["全部", "价表", "报价", "特价审批"];
const moduleFilter = ref<(typeof modules)[number]>("全部");

const logs = computed(() =>
  moduleFilter.value === "全部"
    ? store.logs
    : store.logs.filter((l) => l.module === moduleFilter.value)
);

const moduleClass: Record<string, string> = {
  价表: "mod-book",
  报价: "mod-quote",
  特价审批: "mod-approval"
};
</script>

<template>
  <section class="list-panel audit-panel">
    <div class="toolbar">
      <h2>操作审计与留档</h2>
      <div class="seg">
        <button
          v-for="m in modules"
          :key="m"
          type="button"
          class="seg-btn"
          :class="{ active: moduleFilter === m }"
          @click="moduleFilter = m"
        >{{ m }}</button>
      </div>
    </div>

    <p class="panel-hint">
      价表每次换版整体归档（含全部运价/附加费/折扣规则）；特价申请保留完整审批经过；报价确认、重算、删除均有日志。
    </p>

    <ul class="audit-list">
      <li v-for="l in logs" :key="l.id" class="audit-item">
        <span class="audit-time">{{ formatDate(l.at) }}</span>
        <span class="mod-tag" :class="moduleClass[l.module]">{{ l.module }}</span>
        <div class="audit-body">
          <p><b>{{ l.action }}</b> · {{ l.by }}</p>
          <p class="audit-detail">{{ l.detail }}</p>
        </div>
      </li>
    </ul>
    <div v-if="logs.length === 0" class="empty">暂无日志</div>
  </section>
</template>

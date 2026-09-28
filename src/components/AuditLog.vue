<script setup lang="ts">
import { computed, ref } from "vue";
import { useFreightStore } from "../store";
import { formatDateTime } from "../pricing";

const store = useFreightStore();
const category = ref("全部");

const categories = ["全部", "价表", "报价", "特价"];

const filtered = computed(() =>
  store.events
    .filter((e) => category.value === "全部" || e.category === category.value)
    .sort((a, b) => b.at.localeCompare(a.at))
);
</script>

<template>
  <section class="list-panel audit-panel">
    <div class="toolbar">
      <h2>审批与价表留档</h2>
      <div class="seg">
        <button
          v-for="c in categories"
          :key="c"
          type="button"
          :class="category === c ? '' : 'secondary'"
          @click="category = c"
        >
          {{ c }}
        </button>
      </div>
    </div>
    <p class="muted">价表版本、报价锁价、特价申请与审批经过全部留档，不随报价删除而清除。</p>

    <div class="audit-list">
      <div v-for="ev in filtered" :key="ev.id" class="audit-item" :class="`cat-${ev.category}`">
        <span class="audit-time">{{ formatDateTime(ev.at) }}</span>
        <span class="audit-cat">{{ ev.category }}</span>
        <div class="audit-body">
          <p><strong>{{ ev.action }}</strong> · {{ ev.actor }}</p>
          <p class="muted">{{ ev.detail }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PriceSnapshot } from "../types";
import { formatMoney } from "../pricing";

const props = defineProps<{
  price: PriceSnapshot;
  compact?: boolean;
}>();

const rows = computed(() => props.price.lines);
</script>

<template>
  <div class="fee" :class="{ 'fee-compact': compact }">
    <div v-for="(line, i) in rows" :key="i" class="fee-row">
      <span class="fee-label">{{ line.label }}</span>
      <span class="fee-value" :class="line.kind === 'discount' ? 'neg' : ''">
        {{ line.kind === "discount" ? "−" : "" }}{{ formatMoney(Math.abs(line.amount)) }}
      </span>
    </div>
    <div class="fee-row fee-total">
      <span>应收合计（价表 v{{ price.versionNumber }}）</span>
      <strong>{{ formatMoney(price.finalAmount) }}</strong>
    </div>
  </div>
</template>

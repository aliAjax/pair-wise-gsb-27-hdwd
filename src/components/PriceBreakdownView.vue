<script setup lang="ts">
import type { PriceBreakdown, SpecialDiscount } from "../types";
import { formatMoney } from "../pricing";

defineProps<{
  breakdown: PriceBreakdown;
  special?: SpecialDiscount;
  compact?: boolean;
}>();
</script>

<template>
  <div class="price-block">
    <p v-if="!compact" class="rule-text">匹配规则：{{ breakdown.matchedRuleText }}</p>
    <table class="price-table">
      <tbody>
        <tr>
          <td>基础价</td>
          <td class="num">{{ formatMoney(breakdown.basePrice) }}</td>
        </tr>
        <tr v-for="line in breakdown.surcharges" :key="line.code">
          <td class="surcharge">＋{{ line.label }}</td>
          <td class="num surcharge">{{ formatMoney(line.amount) }}</td>
        </tr>
        <tr class="subtotal">
          <td>小计（基础价＋附加费）</td>
          <td class="num">{{ formatMoney(breakdown.subtotal) }}</td>
        </tr>
        <tr v-for="line in breakdown.discountLines" :key="line.code">
          <td class="discount">－{{ line.label }}</td>
          <td class="num discount">{{ formatMoney(-line.amount) }}</td>
        </tr>
        <tr v-if="special" class="discount">
          <td>
            －特价减免
            <span class="rate-tag">{{ (special.rate * 100).toFixed(1) }}%</span>
          </td>
          <td class="num discount">{{ formatMoney(-special.amount) }}</td>
        </tr>
        <tr class="total">
          <td>应收合计</td>
          <td class="num">{{ formatMoney(special ? breakdown.subtotal - special.amount : breakdown.total) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rule-text {
  margin: 0 0 8px;
  font-size: 12px;
  color: #69758c;
  line-height: 1.6;
}
.price-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.price-table td {
  padding: 4px 0;
  color: #536078;
}
.price-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.surcharge { color: #8a6d1f; }
.discount { color: #14724f; }
.subtotal td {
  border-top: 1px dashed #cfd8e5;
  padding-top: 6px;
  margin-top: 4px;
  color: #445069;
  font-weight: 600;
}
.rate-tag {
  display: inline-block;
  margin-left: 4px;
  background: #e8f4ef;
  color: #14724f;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
}
.total td {
  border-top: 1px solid #cfd8e5;
  padding-top: 8px;
  color: #172033;
  font-weight: 800;
  font-size: 15px;
}
</style>

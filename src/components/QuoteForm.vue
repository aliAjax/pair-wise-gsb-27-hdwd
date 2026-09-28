<script setup lang="ts">
import { computed, reactive } from "vue";
import { ROUTES, SERVICES } from "../types";
import type { ServiceType } from "../types";
import { useFreightStore } from "../store";
import { formatMoney } from "../pricing";
import FeeBreakdown from "./FeeBreakdown.vue";

const store = useFreightStore();

const form = reactive({
  customer: "",
  route: ROUTES[0],
  service: "标准达" as ServiceType,
  weight: 100,
  notes: ""
});

const previewPrice = computed(() => {
  try {
    if (form.weight > 0) {
      return store.preview(form.route, form.service, Number(form.weight));
    }
  } catch {
    // 重量超出已配置阶梯时无预览
  }
  return null;
});

function submit() {
  try {
    const quote = store.createQuote({
      customer: form.customer,
      route: form.route,
      service: form.service,
      weight: Number(form.weight),
      notes: form.notes
    });
    form.customer = "";
    form.notes = "";
    form.weight = 100;
    window.alert(`报价已生成，应收 ${formatMoney(quote.price.finalAmount)}（价表 v${quote.price.versionNumber}），等待客户确认。`);
  } catch (e) {
    window.alert((e as Error).message);
  }
}
</script>

<template>
  <section class="panel">
    <h2>新增报价 / 试算</h2>
    <p class="panel-hint">
      按当前生效价表 <strong>v{{ store.activeVersion.version }}</strong>
      匹配线路、重量阶梯与服务类型，实时列明基础价、附加费和折扣。
    </p>
    <form class="form-grid" @submit.prevent="submit">
      <label>
        客户名称
        <input v-model="form.customer" placeholder="如：海沃商贸" required />
      </label>
      <label>
        运输线路
        <select v-model="form.route">
          <option v-for="r in ROUTES" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>
      <label>
        服务类型
        <select v-model="form.service">
          <option v-for="s in SERVICES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label>
        重量 kg
        <input v-model.number="form.weight" type="number" min="0.1" step="0.1" required />
      </label>
      <label>
        备注
        <textarea v-model="form.notes" placeholder="温区、合约背景、竞争情况等" />
      </label>

      <div v-if="previewPrice" class="preview-box">
        <p class="preview-title">试算预览（未保存）</p>
        <FeeBreakdown :price="previewPrice" compact />
      </div>
      <div v-else class="preview-box preview-empty">当前重量没有匹配的费率阶梯，请调整重量。</div>

      <button type="submit" :disabled="store.role !== 'sales'">
        {{ store.role === "sales" ? "按当前价表试算并保存" : "仅业务员可创建报价" }}
      </button>
    </form>
  </section>
</template>

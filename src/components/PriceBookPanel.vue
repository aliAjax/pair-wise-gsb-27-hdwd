<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { usePricingStore } from "../store";
import { BAND_TEXT, SERVICES, formatDate, formatMoney } from "../pricing";
import type { PriceVersion, ServiceType } from "../types";
import BaseDialog from "./BaseDialog.vue";

const store = usePricingStore();

const selectedVersionId = ref(store.activeVersion.id);
const selected = computed<PriceVersion | undefined>(() =>
  store.findVersion(selectedVersionId.value)
);

const routeFilter = ref("全部线路");
const routeOptions = computed(() => ["全部线路", ...new Set(store.activeVersion.rules.map((r) => r.route))]);

const shownRoutes = computed(() => {
  const v = selected.value;
  if (!v) return [];
  const routes = [...new Set(v.rules.map((r) => r.route))];
  return routeFilter.value === "全部线路" ? routes : routes.filter((r) => r === routeFilter.value);
});

/* 换版 */
const showPublish = ref(false);
const factorPct = ref(105);
const note = ref("");

function openPublish() {
  factorPct.value = 105;
  note.value = "";
  showPublish.value = true;
}

function doPublish() {
  const err = store.publishVersion(factorPct.value / 100, note.value);
  if (err) ElMessage.warning(err);
  else {
    ElMessage.success(`V${store.activeVersion.versionNo} 已发布生效，旧版本归档`);
    selectedVersionId.value = store.activeVersion.id;
    showPublish.value = false;
  }
}

function serviceCount(v: PriceVersion, service: ServiceType) {
  return v.rules.filter((r) => r.service === service).length;
}
</script>

<template>
  <section class="book-panel">
    <div class="book-layout">
      <aside class="version-list">
        <div class="toolbar">
          <h2>价表版本</h2>
          <button
            type="button"
            class="small"
            :disabled="!store.isApprover"
            :title="store.isApprover ? '发布新版本' : '仅审批人可发布价表'"
            @click="openPublish"
          >发布新版</button>
        </div>
        <article
          v-for="v in store.versions"
          :key="v.id"
          class="version-card"
          :class="{ active: v.id === selectedVersionId, current: v.active }"
          @click="selectedVersionId = v.id"
        >
          <div class="version-head">
            <b>V{{ v.versionNo }}</b>
            <span v-if="v.active" class="status st-green">生效中</span>
            <span v-else class="status st-gray">已归档</span>
          </div>
          <p class="version-time">{{ formatDate(v.publishedAt) }}</p>
          <p class="version-note">{{ v.note }}</p>
          <p class="version-meta">
            发布人：{{ v.publishedBy }}｜规则 {{ v.rules.length }} 条 · 附加费
            {{ v.surcharges.length }} 项 · 折扣 {{ v.discounts.length }} 项
          </p>
        </article>
      </aside>

      <div class="version-detail" v-if="selected">
        <div class="toolbar">
          <h2>V{{ selected.versionNo }} 价表明细</h2>
          <select v-model="routeFilter" class="filter-select">
            <option v-for="r in routeOptions" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>

        <h3 class="block-title">基础运价（线路 × 服务 × 重量段）</h3>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>线路</th>
                <th v-for="s in SERVICES" :key="s">{{ s }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="route in shownRoutes"
                :key="route"
              >
                <td>{{ route }}</td>
                <td v-for="s in SERVICES" :key="s">
                  <div
                    v-for="rule in selected.rules.filter((r) => r.route === route && r.service === (s as ServiceType))"
                    :key="s"
                    class="bands"
                  >
                    <p v-for="b in rule.bands" :key="b.minWeight" class="band-line">
                      {{ BAND_TEXT(b) }}：
                      <b>{{ formatMoney(b.basePrice) }}</b> + {{ formatMoney(b.perKgRate) }}/kg
                    </p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="block-title">附加费规则</h3>
        <table class="data-table">
          <thead>
            <tr><th>代码</th><th>名称</th><th>适用服务</th><th>计费方式</th><th>费率/金额</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in selected.surcharges" :key="s.code">
              <td>{{ s.code }}</td>
              <td>{{ s.label }}</td>
              <td>{{ s.service ?? "全部服务" }}</td>
              <td>{{ { percent: "按基础价比例", perKg: "每公斤", flat: "每票固定" }[s.kind] }}</td>
              <td>
                <b v-if="s.kind === 'percent'">{{ (s.value * 100).toFixed(1) }}%</b>
                <b v-else>{{ formatMoney(s.value) }}{{ s.kind === "perKg" ? "/kg" : "/票" }}</b>
              </td>
            </tr>
          </tbody>
        </table>

        <h3 class="block-title">常规折扣（随客户类型自动匹配，特价审批减免另计）</h3>
        <table class="data-table">
          <thead>
            <tr><th>代码</th><th>名称</th><th>适用客户</th><th>折扣率</th></tr>
          </thead>
          <tbody>
            <tr v-for="d in selected.discounts" :key="d.code">
              <td>{{ d.code }}</td>
              <td>{{ d.label }}</td>
              <td>{{ d.customerType }}</td>
              <td><b>{{ (d.rate * 100).toFixed(0) }}%</b></td>
            </tr>
          </tbody>
        </table>

        <p v-if="!selected.active" class="archive-note">
          📦 该版本已归档留档。已确认锁定的报价仍按本版本金额执行；未确认报价可在报价页重算到当前生效版本。
        </p>
        <p v-else class="service-count-note">
          覆盖 {{ serviceCount(selected, '标准达') }} 条标准达 / {{ serviceCount(selected, '次日达') }} 条次日达 /
          {{ serviceCount(selected, '冷链') }} 条冷链运价。
        </p>
      </div>
    </div>

    <!-- 发布新版 -->
    <BaseDialog :show="showPublish" title="发布新价表版本" width="520px" @close="showPublish = false">
      <div class="form-grid">
        <p class="dlg-hint">
          以当前生效 <b>V{{ store.activeVersion.versionNo }}</b> 为底稿，对基础价、续重单价、按公斤/按票附加费做整体调整；
          百分比附加费与常规折扣率不变。发布后：旧版归档，<b>已确认锁定报价金额不变</b>，未确认报价提示按新版重算。
        </p>
        <label>整体调整系数（%，105 = 上调5%）
          <input v-model.number="factorPct" type="number" min="50" max="300" step="1" />
        </label>
        <label>换版说明（必填）<textarea v-model="note" placeholder="如：旺季燃油成本上涨，整体上调5%" /></label>
      </div>
      <template #footer>
        <button type="button" class="secondary" @click="showPublish = false">取消</button>
        <button type="button" @click="doPublish">发布并生效</button>
      </template>
    </BaseDialog>
  </section>
</template>

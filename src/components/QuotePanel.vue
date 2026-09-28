<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { usePricingStore } from "../store";
import {
  CUSTOMER_TYPES,
  SEED_ROUTES,
  SERVICES,
  calculate,
  formatDate,
  formatMoney
} from "../pricing";
import type { PriceBreakdown, Quote } from "../types";
import BaseDialog from "./BaseDialog.vue";
import PriceBreakdownView from "./PriceBreakdownView.vue";

const store = usePricingStore();

const filters = ["全部", "待确认", "特价待批", "特价待确认", "已锁定"];
const filter = ref("全部");

const form = reactive({
  customer: "",
  customerType: CUSTOMER_TYPES[0],
  route: SEED_ROUTES[0],
  service: SERVICES[0] as (typeof SERVICES)[number],
  weight: 100,
  notes: ""
});

const preview = computed<PriceBreakdown | null>(() =>
  calculate(store.activeVersion, {
    route: form.route,
    service: form.service,
    weight: Number(form.weight) || 0,
    customerType: form.customerType
  })
);

function submit() {
  const err = store.createQuote({
    customer: form.customer,
    customerType: form.customerType,
    route: form.route,
    service: form.service,
    weight: Number(form.weight),
    notes: form.notes
  });
  if (err) ElMessage.warning(err);
  else {
    ElMessage.success("报价已按当前生效价表生成");
    form.customer = "";
    form.notes = "";
    form.weight = 100;
  }
}

const list = computed(() =>
  filter.value === "全部" ? store.quotes : store.quotes.filter((q) => q.status === filter.value)
);

function quotedBd(q: Quote): PriceBreakdown | null {
  const ver = store.findVersion(q.quotedVersionId);
  if (!ver) return null;
  return calculate(ver, {
    route: q.route,
    service: q.service,
    weight: q.weight,
    customerType: q.customerType
  });
}

function lock(q: Quote) {
  const err = store.lockQuote(q.id);
  if (err) ElMessage.warning(err);
  else ElMessage.success("客户已确认，金额锁定");
}

function remove(q: Quote) {
  if (confirm(`确定删除 ${q.customer} 的报价？审批记录将保留。`)) {
    store.deleteQuote(q.id);
    ElMessage.success("已删除");
  }
}

/* 特价申请弹窗 */
const specialTarget = ref<Quote | null>(null);
const specialRatePct = ref(6);
const specialReason = ref("");
const specialPreview = computed(() => {
  if (!specialTarget.value) return null;
  return store.liveBreakdown(specialTarget.value);
});

function openSpecial(q: Quote) {
  specialTarget.value = q;
  specialRatePct.value = 6;
  specialReason.value = "";
}

function submitSpecial() {
  if (!specialTarget.value) return;
  const err = store.requestSpecial(specialTarget.value.id, specialRatePct.value / 100, specialReason.value);
  if (err) ElMessage.warning(err);
  else {
    ElMessage.success("特价申请已提交，原报价进入待批");
    specialTarget.value = null;
  }
}

function statusClass(q: Quote): string {
  return {
    待确认: "st-blue",
    特价待批: "st-amber",
    特价待确认: "st-purple",
    已锁定: "st-green"
  }[q.status];
}
</script>

<template>
  <section class="workspace">
    <form class="panel" @submit.prevent="submit">
      <h2>新增报价</h2>
      <p class="panel-hint">按线路、重量、服务匹配 <b>V{{ store.activeVersion.versionNo }}</b> 当前生效价表</p>
      <div class="form-grid">
        <label>客户名称<input v-model="form.customer" placeholder="客户全称" required /></label>
        <label>客户类型
          <select v-model="form.customerType">
            <option v-for="t in CUSTOMER_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label>运输线路
          <select v-model="form.route">
            <option v-for="r in SEED_ROUTES" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>服务类型
          <select v-model="form.service">
            <option v-for="s in SERVICES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label>重量 kg<input v-model.number="form.weight" type="number" min="0.1" step="0.1" required /></label>
        <label>备注<textarea v-model="form.notes" placeholder="客户背景、竞争情况等" /></label>

        <div v-if="preview" class="preview-box">
          <p class="preview-title">当前价表试算预览</p>
          <PriceBreakdownView :breakdown="preview" compact />
        </div>

        <button type="submit">计算并保存报价</button>
      </div>
    </form>

    <section class="list-panel">
      <div class="toolbar">
        <h2>报价列表</h2>
        <div class="toolbar-right">
          <button type="button" class="secondary small" @click="store.recalcAllStale()">
            一键重算未确认报价
          </button>
          <select v-model="filter" class="filter-select">
            <option v-for="f in filters" :key="f" :value="f">{{ f }}</option>
          </select>
        </div>
      </div>

      <div class="record-grid">
        <div v-if="list.length === 0" class="empty">暂无匹配数据</div>

        <article v-for="q in list" :key="q.id" class="record">
          <div class="record-head">
            <div>
              <p class="record-title">{{ q.customer }}</p>
              <p class="record-sub">{{ q.route }} · {{ q.service }} · {{ q.weight }}kg · {{ q.customerType }}</p>
            </div>
            <span class="status" :class="statusClass(q)">{{ q.status }}</span>
          </div>

          <!-- 已锁定：展示锁定快照，换版不影响 -->
          <template v-if="q.status === '已锁定' && q.locked">
            <PriceBreakdownView :breakdown="q.locked.breakdown" :special="q.locked.specialDiscount" compact />
            <p class="lock-note">
              🔒 {{ formatDate(q.locked.lockedAt) }} 由 {{ q.locked.lockedBy }} 锁定（依据
              V{{ q.locked.breakdown.versionNo }}），客户已确认，后续换版不影响本单金额
            </p>
          </template>

          <!-- 未锁定：展示报价所依据版本的金额；落后于当前版本时给提示 -->
          <template v-else-if="quotedBd(q)">
            <PriceBreakdownView :breakdown="quotedBd(q)" compact />
            <div v-if="store.isStale(q)" class="stale-warn">
              ⚠ 当前价表已更新到 V{{ store.activeVersion.versionNo }}，本单仍依据
              V{{ quotedBd(q)!.versionNo }}。新金额：
              <b>{{ formatMoney(store.liveBreakdown(q)?.total ?? 0) }}</b>
              （客户确认前不会自动改动）
            </div>
          </template>

          <!-- 特价待批 -->
          <p v-if="store.pendingRequest(q.id)" class="special-warn">
            🧾 特价申请 {{ store.pendingRequest(q.id)!.requestNo }}（{{ store.pendingRequest(q.id)!.category }}）
            审批中，有效期至 {{ formatDate(store.pendingRequest(q.id)!.expiresAt) }}，逾期自动作废
          </p>

          <!-- 特价已批准待确认 -->
          <template v-else-if="q.status === '特价待确认'">
            <p class="special-ok-note">
              ✅ 特价已批准，应收
              <b>{{
                formatMoney(
                  (quotedBd(q)?.subtotal ?? 0) -
                    (store.latestRequest(q.id)?.approvedDiscount?.amount ?? 0)
                )
              }}</b>
              ，请与客户确认
            </p>
          </template>

          <p class="note" v-if="q.notes">{{ q.notes }}</p>

          <div class="actions">
            <button v-if="q.status === '待确认'" type="button" @click="lock(q)">客户确认·锁定金额</button>
            <button
              v-if="q.status === '特价待确认'"
              type="button"
              @click="lock(q)"
            >按特价锁定</button>
            <button
              v-if="q.status === '特价待确认'"
              type="button"
              class="secondary"
              @click="store.waiveSpecial(q.id)"
            >放弃特价·按常规价</button>
            <button
              v-if="q.status === '待确认' && !store.pendingRequest(q.id)"
              type="button"
              class="secondary"
              @click="openSpecial(q)"
            >申请特价</button>
            <button
              v-if="q.status === '待确认' && store.isStale(q)"
              type="button"
              class="secondary"
              @click="store.recalcQuote(q.id) && ElMessage.success('已按当前价表重算')"
            >重算到 V{{ store.activeVersion.versionNo }}</button>
            <button
              v-if="q.status !== '已锁定'"
              type="button"
              class="danger"
              @click="remove(q)"
            >删除</button>
          </div>
        </article>
      </div>
    </section>
  </section>

  <!-- 特价申请 -->
  <BaseDialog :show="specialTarget !== null" title="提交特价申请" @close="specialTarget = null">
    <template v-if="specialTarget && specialPreview">
      <p class="dlg-sub">
        {{ specialTarget.customer }} · {{ specialTarget.route }} / {{ specialTarget.service }} /
        {{ specialTarget.weight }}kg
      </p>
      <PriceBreakdownView :breakdown="specialPreview" compact />
      <div class="form-grid dlg-form">
        <label>申请折扣率（%）
          <input v-model.number="specialRatePct" type="number" min="0.1" max="50" step="0.1" />
        </label>
        <p class="dlg-hint">
          申请减免金额：<b>{{
            formatMoney((specialPreview.subtotal * specialRatePct) / 100)
          }}</b>
          ；类别：<b>{{
            specialRatePct / 100 <= 0.05
              ? "一类(≤5%) → 区经理"
              : specialRatePct / 100 <= 0.1
                ? "二类(5%-10%) → 销售总监"
                : "三类(>10%) → 总经理"
          }}</b>；有效期 3 天，逾期作废需重算重提。审批人批准额不得高于申请额。
        </p>
        <label>特价理由<textarea v-model="specialReason" placeholder="客户价值、竞品情况、本票说明" /></label>
      </div>
    </template>
    <template #footer>
      <button type="button" class="secondary" @click="specialTarget = null">取消</button>
      <button type="button" @click="submitSpecial">提交申请·原报价进入待批</button>
    </template>
  </BaseDialog>
</template>

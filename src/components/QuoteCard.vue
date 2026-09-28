<script setup lang="ts">
import { computed, ref } from "vue";
import type { Quote } from "../types";
import { useFreightStore } from "../store";
import { formatMoney, formatDateTime } from "../pricing";
import FeeBreakdown from "./FeeBreakdown.vue";

const props = defineProps<{ quote: Quote }>();
const store = useFreightStore();

const showSpecial = ref(false);
const applyAmount = ref<number>(0);
const reason = ref("");
const showHistory = ref(false);

const stale = computed(() => store.isStale(props.quote));
const activeApp = computed(() => store.activeApplicationOf(props.quote.id));
const linkedApp = computed(() =>
  props.quote.specialAppId ? store.applicationById(props.quote.specialAppId) : undefined
);
const quoteEvents = computed(() =>
  store.events
    .filter((e) => e.quoteId === props.quote.id)
    .sort((a, b) => b.at.localeCompare(a.at))
);

/** 当前价表口径的金额（仅用于对比提醒，不改报价本身） */
const currentPrice = computed(() => store.currentPriceOf(props.quote));

function openSpecial() {
  applyAmount.value = Math.floor(props.quote.price.finalAmount * 100) / 100 - 10;
  reason.value = "";
  showSpecial.value = true;
}

function submitSpecial() {
  try {
    store.submitSpecial({
      quoteId: props.quote.id,
      applyAmount: Number(applyAmount.value),
      reason: reason.value
    });
    showSpecial.value = false;
  } catch (e) {
    window.alert((e as Error).message);
  }
}

function guard(fn: () => void) {
  try {
    fn();
  } catch (e) {
    window.alert((e as Error).message);
  }
}

const isSales = computed(() => store.role === "sales");
</script>

<template>
  <article class="record quote-card" :class="{ 'is-locked': quote.status === '已确认', 'is-pending': quote.status === '待批' }">
    <div class="record-head">
      <div>
        <p class="record-title">{{ quote.customer }}</p>
        <p class="record-sub">{{ quote.route }} · {{ quote.service }} · {{ quote.weight }}kg</p>
      </div>
      <span class="status" :class="`st-${quote.status}`">{{ quote.status }}</span>
    </div>

    <div class="version-line">
      <span>计价版本：价表 v{{ quote.price.versionNumber }}</span>
      <span>来源：{{ quote.source }}</span>
      <span>更新：{{ formatDateTime(quote.updatedAt) }}</span>
    </div>

    <!-- 旧金额提醒：已确认的报价不受影响；未确认报价换版后显示差异 -->
    <div v-if="stale && currentPrice" class="stale-banner">
      <div>
        <strong>⚠ 价表已换版，当前显示的是旧金额</strong>
        <p>
          旧金额 {{ formatMoney(quote.price.finalAmount) }}（v{{ quote.price.versionNumber }}）
          → 当前价表 v{{ currentPrice.versionNumber }} 应为
          <strong>{{ formatMoney(currentPrice.finalAmount) }}</strong>
          （{{ currentPrice.finalAmount >= quote.price.finalAmount ? "上涨" : "下调" }}
          {{ formatMoney(Math.abs(currentPrice.finalAmount - quote.price.finalAmount)) }}）
        </p>
      </div>
      <button
        type="button"
        :disabled="!isSales || quote.status !== '待确认'"
        @click="guard(() => store.recalc(quote.id))"
      >
        按当前价表重算
      </button>
    </div>

    <div v-if="quote.status === '已确认'" class="lock-banner">
      🔒 客户已于 {{ formatDateTime(quote.updatedAt) }} 确认锁价，金额不再随价表换版变化。
    </div>

    <FeeBreakdown :price="quote.price" class="card-breakdown" />

    <!-- 特价申请进行中 -->
    <div v-if="activeApp" class="app-box app-active">
      <p>
        <strong>特价申请审批中</strong>
        （{{ activeApp.status }}）
      </p>
      <p>申请额 {{ formatMoney(activeApp.applyAmount) }} / 常规价 {{ formatMoney(activeApp.quoteSnapshot.standardAmount) }}，截止 {{ formatDateTime(activeApp.expiresAt) }}，逾期自动作废。</p>
      <p class="muted">{{ activeApp.reason }}</p>
    </div>

    <!-- 已批准留痕 -->
    <div v-else-if="linkedApp && linkedApp.status === '已批准'" class="app-box app-approved">
      批准留痕：申请 {{ formatMoney(linkedApp.applyAmount) }}，审批人 {{ linkedApp.approver }}
      按 <strong>{{ formatMoney(linkedApp.approvedAmount ?? 0) }}</strong> 批准（未超过申请额），
      于 {{ formatDateTime(linkedApp.decidedAt ?? "") }} 批准。
    </div>

    <p class="note">{{ quote.notes }}</p>

    <!-- 提交特价 -->
    <form v-if="showSpecial && quote.status === '待确认'" class="special-form" @submit.prevent="submitSpecial">
      <h4>特价申请</h4>
      <p class="muted">提交后本报价进入「待批」，申请有效期 48 小时；批准额不得高于申请额。</p>
      <label>
        申请特价金额（元，当前常规价 {{ formatMoney(quote.price.finalAmount) }}）
        <input v-model.number="applyAmount" type="number" min="0.01" step="0.01" required />
      </label>
      <label>
        申请理由（竞争情况、货量承诺等）
        <textarea v-model="reason" required />
      </label>
      <div class="actions">
        <button type="submit">提交特价申请</button>
        <button type="button" class="secondary" @click="showSpecial = false">取消</button>
      </div>
    </form>

    <div v-else class="actions">
      <button
        v-if="isSales && quote.status === '待确认'"
        type="button"
        @click="guard(() => store.confirmQuote(quote.id))"
      >
        客户确认锁价
      </button>
      <button
        v-if="isSales && quote.status === '待确认' && !activeApp"
        type="button"
        class="secondary"
        :disabled="stale"
        :title="stale ? '旧金额需先重算' : ''"
        @click="openSpecial"
      >
        申请特价
      </button>
      <button type="button" class="secondary" @click="showHistory = !showHistory">
        {{ showHistory ? "收起" : "查看" }}留档（{{ quoteEvents.length }}）
      </button>
      <button
        v-if="isSales && quote.status !== '待批'"
        type="button"
        class="danger"
        @click="guard(() => store.removeQuote(quote.id))"
      >
        删除
      </button>
    </div>

    <div v-if="showHistory" class="history">
      <div v-for="ev in quoteEvents" :key="ev.id" class="history-item">
        <span class="history-time">{{ formatDateTime(ev.at) }}</span>
        <div>
          <p><strong>{{ ev.action }}</strong> · {{ ev.actor }}</p>
          <p class="muted">{{ ev.detail }}</p>
        </div>
      </div>
    </div>
  </article>
</template>

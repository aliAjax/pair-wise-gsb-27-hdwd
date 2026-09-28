<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { usePricingStore } from "../store";
import {
  CATEGORY_APPROVER,
  REQUEST_VALID_DAYS,
  ROLE_LABEL,
  formatDate,
  formatMoney
} from "../pricing";
import type { SpecialRequest } from "../types";
import BaseDialog from "./BaseDialog.vue";
import PriceBreakdownView from "./PriceBreakdownView.vue";

const store = usePricingStore();

type Tab = "待审批" | "已处理" | "我的申请";
const REQUEST_TABS: Tab[] = ["待审批", "已处理", "我的申请"];
const tab = ref<Tab>("待审批");

const visible = computed<SpecialRequest[]>(() => {
  if (tab.value === "待审批")
    return store.requests
      .filter((r) => r.status === "待审批")
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  if (tab.value === "已处理")
    return store.requests.filter((r) => ["已批准", "已驳回", "已作废", "已重提"].includes(r.status));
  return store.requests.filter((r) => r.applicant === store.currentUser.name);
});

function canApprove(r: SpecialRequest): boolean {
  return CATEGORY_APPROVER[r.category] === store.currentUser.role;
}

function quoteOf(r: SpecialRequest) {
  return store.quotes.find((q) => q.id === r.quoteId);
}

function remainHours(r: SpecialRequest): number {
  return Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - new Date(store.now).getTime()) / 3600000));
}

function finalAmount(r: SpecialRequest, amountOverride?: number): number {
  const disc = amountOverride ?? r.approvedDiscount?.amount;
  return r.breakdownAtRequest.subtotal - (disc ?? 0);
}

/* 审批弹窗 */
const approveTarget = ref<SpecialRequest | null>(null);
const approveRatePct = ref(0);
const approveNote = ref("");

function openApprove(r: SpecialRequest) {
  approveTarget.value = r;
  approveRatePct.value = Math.floor(r.requestedDiscount.rate * 1000) / 10;
  approveNote.value = "";
}

function doApprove() {
  if (!approveTarget.value) return;
  const err = store.approveRequest(approveTarget.value.id, approveRatePct.value / 100, approveNote.value);
  if (err) ElMessage.warning(err);
  else {
    ElMessage.success("特价已批准，待客户确认后锁定");
    approveTarget.value = null;
  }
}

const rejectTarget = ref<SpecialRequest | null>(null);
const rejectNote = ref("");
function doReject() {
  if (!rejectTarget.value) return;
  const err = store.rejectRequest(rejectTarget.value.id, rejectNote.value);
  if (err) ElMessage.warning(err);
  else {
    ElMessage.success("已驳回，原报价恢复常规报价");
    rejectTarget.value = null;
    rejectNote.value = "";
  }
}

/* 重算重提弹窗 */
const resubmitTarget = ref<SpecialRequest | null>(null);
const resubmitRatePct = ref(6);
const resubmitReason = ref("");

function openResubmit(r: SpecialRequest) {
  resubmitTarget.value = r;
  resubmitRatePct.value = Math.round(r.requestedDiscount.rate * 1000) / 10;
  resubmitReason.value = r.requestedDiscount.reason;
}

const resubmitPreview = computed(() => {
  if (!resubmitTarget.value) return null;
  const q = quoteOf(resubmitTarget.value);
  return q ? store.liveBreakdown(q) : null;
});

function doResubmit() {
  if (!resubmitTarget.value) return;
  const err = store.resubmit(
    resubmitTarget.value.id,
    resubmitRatePct.value / 100,
    resubmitReason.value
  );
  if (err) ElMessage.warning(err);
  else {
    ElMessage.success("已按当前价表重算并重新提交");
    resubmitTarget.value = null;
  }
}

function statusClass(s: string): string {
  return {
    待审批: "st-amber",
    已批准: "st-green",
    已驳回: "st-red",
    已作废: "st-gray",
    已重提: "st-blue"
  }[s] ?? "st-gray";
}
</script>

<template>
  <section class="list-panel approval-panel">
    <div class="toolbar">
      <h2>特价审批</h2>
      <div class="seg">
        <button
          v-for="t in REQUEST_TABS"
          :key="t"
          type="button"
          class="seg-btn"
          :class="{ active: tab === t }"
          @click="tab = t"
        >
          {{ t }}
          <span v-if="t === '待审批' && store.pendingCount > 0 && store.isApprover" class="badge">
            {{ store.pendingCount }}
          </span>
        </button>
      </div>
    </div>

    <p class="panel-hint">
      一类(≤5%) 由 <b>区经理</b> 处理，二类(5%-10%) 由 <b>销售总监</b> 处理，三类(&gt;10%) 由
      <b>总经理</b> 处理；批准折扣不得高于申请折扣。申请有效期
      {{ REQUEST_VALID_DAYS }} 天，过期自动作废，须重算后重新提交。
    </p>

    <div class="record-grid">
      <div v-if="visible.length === 0" class="empty">暂无申请</div>

      <article v-for="r in visible" :key="r.id" class="record">
        <div class="record-head">
          <div>
            <p class="record-title">
              {{ r.requestNo }}
              <span class="cat-tag">{{ r.category }}</span>
            </p>
            <p class="record-sub">
              {{ quoteOf(r)?.customer }} · {{ r.breakdownAtRequest.route }} /
              {{ r.breakdownAtRequest.service }} / {{ r.breakdownAtRequest.weight }}kg
            </p>
          </div>
          <span class="status" :class="statusClass(r.status)">
            {{ r.status }}
            <template v-if="r.status === '待审批'">（剩 {{ remainHours(r) }} 小时）</template>
          </span>
        </div>

        <PriceBreakdownView :breakdown="r.breakdownAtRequest" compact />

        <div class="special-box">
          <div v-if="r.status === '待审批'">
            申请减免 <b class="discount">{{ formatMoney(r.requestedDiscount.amount) }}</b>
            （{{ (r.requestedDiscount.rate * 100).toFixed(1) }}%），申请后应收
            <b>{{ formatMoney(finalAmount(r, r.requestedDiscount.amount)) }}</b>
            <p class="reason">理由：{{ r.requestedDiscount.reason }}</p>
          </div>
          <div v-else-if="r.status === '已批准' && r.approvedDiscount">
            批准减免 <b class="discount">{{ formatMoney(r.approvedDiscount.amount) }}</b>
            （{{ (r.approvedDiscount.rate * 100).toFixed(1) }}%），批准后应收
            <b>{{ formatMoney(finalAmount(r)) }}</b>
            <p class="reason">审批人：{{ r.approver }}｜{{ r.decisionNote }}</p>
          </div>
          <div v-else-if="r.status === '已驳回'">
            驳回人：{{ r.approver }}｜{{ r.decisionNote }}
          </div>
          <div v-else-if="r.status === '已作废'" class="st-red-text">
            已于 {{ formatDate(r.expiresAt) }} 到期自动作废，需按当前价表重算后重新提交
          </div>
          <div v-else-if="r.status === '已重提'" class="st-blue-text">
            已重算并生成新申请
          </div>
        </div>

        <!-- 操作区 -->
        <div class="actions">
          <template v-if="r.status === '待审批'">
            <template v-if="canApprove(r)">
              <button type="button" @click="openApprove(r)">审批（批准/改批）</button>
              <button type="button" class="danger" @click="rejectTarget = r">驳回</button>
            </template>
            <span v-else-if="store.isApprover" class="guard-note">
              该类申请仅由{{ ROLE_LABEL[CATEGORY_APPROVER[r.category]] }}处理
            </span>
            <span v-else class="guard-note">
              等待{{ ROLE_LABEL[CATEGORY_APPROVER[r.category]] }}审批
            </span>
          </template>
          <button
            v-if="['已作废', '已驳回'].includes(r.status) && quoteOf(r) && quoteOf(r)!.status !== '已锁定'"
            type="button"
            class="secondary"
            @click="openResubmit(r)"
          >重算后重新提交</button>
        </div>

        <!-- 审批轨迹 -->
        <details class="trail">
          <summary>审批经过（{{ r.trail.length }}）</summary>
          <ul>
            <li v-for="(t, i) in r.trail" :key="i">
              <span class="trail-time">{{ formatDate(t.at) }}</span>
              <b>{{ t.by }}</b> · {{ t.action }}
              <p>{{ t.detail }}</p>
            </li>
          </ul>
        </details>
      </article>
    </div>
  </section>

  <!-- 批准弹窗 -->
<BaseDialog :show="approveTarget !== null" title="特价审批" @close="approveTarget = null">
  <template v-if="approveTarget">
    <p class="dlg-sub">
      {{ approveTarget.requestNo }}｜{{ approveTarget.category }}｜审批人角色：
      {{ ROLE_LABEL[CATEGORY_APPROVER[approveTarget.category]] }}
    </p>
    <PriceBreakdownView :breakdown="approveTarget.breakdownAtRequest" compact />
    <div class="form-grid dlg-form">
      <label>批准折扣率（%，不得高于申请 {{ (approveTarget.requestedDiscount.rate * 100).toFixed(1) }}%）
        <input
          v-model.number="approveRatePct"
          type="number"
          min="0.1"
          :max="approveTarget.requestedDiscount.rate * 100"
          step="0.1"
        />
      </label>
      <p class="dlg-hint">
        批准减免：<b class="discount">{{
          formatMoney((approveTarget.breakdownAtRequest.subtotal * approveRatePct) / 100)
        }}</b>
        ，批准后应收：<b>{{
          formatMoney(
            approveTarget.breakdownAtRequest.subtotal -
              (approveTarget.breakdownAtRequest.subtotal * approveRatePct) / 100
          )
        }}</b>
      </p>
      <label>审批意见<textarea v-model="approveNote" placeholder="批准幅度、适用范围说明" /></label>
    </div>
  </template>
  <template #footer>
    <button type="button" class="secondary" @click="approveTarget = null">取消</button>
    <button type="button" @click="doApprove">确认批准</button>
  </template>
</BaseDialog>

<!-- 驳回弹窗 -->
<BaseDialog :show="rejectTarget !== null" title="驳回特价申请" width="480px" @close="rejectTarget = null">
  <template v-if="rejectTarget">
    <p class="dlg-sub">{{ rejectTarget.requestNo }}（{{ rejectTarget.category }}）</p>
    <label class="form-grid">驳回理由（必填）
      <textarea v-model="rejectNote" placeholder="驳回后原报价恢复为常规报价" />
    </label>
  </template>
  <template #footer>
    <button type="button" class="secondary" @click="rejectTarget = null">取消</button>
    <button type="button" class="danger" @click="doReject">确认驳回</button>
  </template>
</BaseDialog>

<!-- 重算重提弹窗 -->
<BaseDialog :show="resubmitTarget !== null" title="重算后重新提交" @close="resubmitTarget = null">
  <template v-if="resubmitTarget && quoteOf(resubmitTarget)">
    <p class="dlg-sub">
      原申请 {{ resubmitTarget.requestNo }}（{{ resubmitTarget.status }}）·
      {{ quoteOf(resubmitTarget)!.customer }}
    </p>
    <div v-if="resubmitPreview" class="recalc-box">
      <p class="preview-title">按当前生效 V{{ resubmitPreview.versionNo }} 重算</p>
      <PriceBreakdownView :breakdown="resubmitPreview" compact />
    </div>
    <div class="form-grid dlg-form">
      <label>新申请折扣率（%）<input v-model.number="resubmitRatePct" type="number" min="0.1" max="50" step="0.1" /></label>
      <p class="dlg-hint">
        新申请减免：<b class="discount">{{
          formatMoney(((resubmitPreview?.subtotal ?? 0) * resubmitRatePct) / 100)
        }}</b>
        ，有效期重新计算 {{ REQUEST_VALID_DAYS }} 天
      </p>
      <label>特价理由<textarea v-model="resubmitReason" /></label>
    </div>
  </template>
  <template #footer>
    <button type="button" class="secondary" @click="resubmitTarget = null">取消</button>
    <button type="button" @click="doResubmit">重新提交申请</button>
  </template>
</BaseDialog>
</template>

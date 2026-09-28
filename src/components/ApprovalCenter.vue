<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useFreightStore } from "../store";
import type { SpecialApplication } from "../types";
import { formatDateTime, formatMoney } from "../pricing";

const store = useFreightStore();
const expanded = reactive<Record<string, boolean>>({});
const approveAmounts = reactive<Record<string, number>>({});
const decisionNotes = reactive<Record<string, string>>({});

const tab = ref<"pending" | "history">("pending");

function amountOf(app: SpecialApplication): number {
  return approveAmounts[app.id] ?? app.applyAmount;
}

function approve(app: SpecialApplication) {
  if (
    !window.confirm(
      `确认按 ${formatMoney(amountOf(app))} 批准该特价？\n（申请额 ${formatMoney(
        app.applyAmount
      )}，批准额不得超过申请额）`
    )
  )
    return;
  try {
    store.decideSpecial({
      applicationId: app.id,
      approve: true,
      approvedAmount: amountOf(app),
      decisionNote: decisionNotes[app.id]
    });
  } catch (e) {
    window.alert((e as Error).message);
  }
}

function reject(app: SpecialApplication) {
  try {
    store.decideSpecial({
      applicationId: app.id,
      approve: false,
      decisionNote: decisionNotes[app.id]
    });
  } catch (e) {
    window.alert((e as Error).message);
  }
}

const list = computed(() =>
  tab.value === "pending" ? store.pendingApplications : store.processedApplications
);

const sortedList = computed(() =>
  list.value.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>特价审批中心</h2>
      <div class="seg">
        <button
          type="button"
          :class="tab === 'pending' ? '' : 'secondary'"
          @click="tab = 'pending'"
        >
          待审批（{{ store.pendingApplications.length }}）
        </button>
        <button
          type="button"
          :class="tab === 'history' ? '' : 'secondary'"
          @click="tab = 'history'"
        >
          已处理留档（{{ store.processedApplications.length }}）
        </button>
      </div>
    </div>

    <div v-if="store.role !== 'approver' && tab === 'pending'" class="role-notice">
      当前为业务员身份，只能查看；请在右上角切换为「审批人」后处理同类特价申请。
    </div>

    <div class="record-grid">
      <div v-if="sortedList.length === 0" class="empty">
        {{ tab === "pending" ? "没有待审批的特价申请" : "暂无已处理申请" }}
      </div>

      <article
        v-for="app in sortedList"
        :key="app.id"
        class="record app-card"
        :class="`app-status-${app.status}`"
      >
        <div class="record-head">
          <div>
            <p class="record-title">
              {{ app.quoteSnapshot.customer }}
              <span class="tag-mini">{{ app.status }}</span>
            </p>
            <p class="record-sub">
              {{ app.quoteSnapshot.route }} · {{ app.quoteSnapshot.service }} ·
              {{ app.quoteSnapshot.weight }}kg
            </p>
          </div>
          <div class="amount-col">
            <span class="muted">常规价</span>
            <strong>{{ formatMoney(app.quoteSnapshot.standardAmount) }}</strong>
            <span class="muted">申请额</span>
            <strong class="accent">{{ formatMoney(app.applyAmount) }}</strong>
          </div>
        </div>

        <div class="version-line">
          <span>申请人：{{ app.applicant }}</span>
          <span>价表 v{{ app.quoteSnapshot.versionNumber }}</span>
          <span>提交：{{ formatDateTime(app.createdAt) }}</span>
          <span>截止：{{ formatDateTime(app.expiresAt) }}</span>
        </div>
        <p class="note">{{ app.reason }}</p>

        <!-- 待审批：审批人可批驳，且批准额不得超过申请额 -->
        <template v-if="app.status === '待审批'">
          <button
            type="button"
            class="linklike"
            @click="expanded[app.id] = !expanded[app.id]"
          >
            {{ expanded[app.id] ? "收起审批操作" : "展开审批操作" }}
          </button>
          <div v-if="expanded[app.id]" class="approve-box">
            <label>
              批准金额（元，不得超过申请额 {{ formatMoney(app.applyAmount) }}）
              <input
                v-model.number="approveAmounts[app.id]"
                type="number"
                min="0.01"
                :max="app.applyAmount"
                step="0.01"
                :placeholder="String(app.applyAmount)"
              />
            </label>
            <label>
              审批意见
              <textarea
                v-model="decisionNotes[app.id]"
                placeholder="批准/驳回依据，将随审批记录留档"
              />
            </label>
            <div class="actions">
              <button
                type="button"
                :disabled="store.role !== 'approver' || amountOf(app) > app.applyAmount"
                @click="approve(app)"
              >
                {{
                  amountOf(app) > app.applyAmount
                    ? "批准额超过申请额，不能批准"
                    : "按该金额批准"
                }}
              </button>
              <button
                type="button"
                class="danger"
                :disabled="store.role !== 'approver'"
                @click="reject(app)"
              >
                驳回（需重算后再申请）
              </button>
            </div>
          </div>
        </template>

        <!-- 已处理：完整留痕 -->
        <div v-else class="decision-box">
          <p v-if="app.status === '已批准'">
            ✅ {{ formatDateTime(app.decidedAt) }} 由 {{ app.approver }} 按
            <strong>{{ formatMoney(app.approvedAmount ?? 0) }}</strong>
            批准（申请额 {{ formatMoney(app.applyAmount) }}，未超过申请额）。
          </p>
          <p v-else-if="app.status === '已驳回'">
            ❌ {{ formatDateTime(app.decidedAt) }} 由 {{ app.approver }} 驳回。
          </p>
          <p v-else>
            ⏰ {{ formatDateTime(app.decidedAt) }} 超过有效期自动作废，需重算后重新提交。
          </p>
          <p class="muted">审批意见：{{ app.decisionNote || "无" }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useFreightStore, type VersionDraft } from "../store";
import { ROUTES, SERVICES } from "../types";
import type { RateRule, ServiceType, SurchargeRule, DiscountRule } from "../types";
import { formatDateTime } from "../pricing";

const store = useFreightStore();
const editing = ref(false);
const draft = ref<VersionDraft | null>(null);
const showHistory = ref(false);
const message = ref("");

function startEdit() {
  draft.value = store.draftFromActive();
  editing.value = true;
  message.value = "";
}

function rateRow(route: string, service: ServiceType) {
  return draft.value!.rateRules.filter((r) => r.route === route && r.service === service);
}

function setPercent(rule: SurchargeRule, value: number) {
  rule.percentOfBase = value;
  rule.perKg = undefined;
}
function setPerKg(rule: SurchargeRule, value: number) {
  rule.perKg = value;
  rule.percentOfBase = undefined;
}
function setDiscount(rule: DiscountRule, rate: number) {
  rule.rate = rate;
}

function publish() {
  if (!draft.value) return;
  // 校验阶梯配置
  for (const [route] of Object.entries(Object.fromEntries(draft.value.rateRules.map((r) => [r.route, 1])))) {
    for (const service of SERVICES) {
      const tiers = draft.value.rateRules
        .filter((r) => r.route === route && r.service === service)
        .sort((a, b) => a.weightFrom - b.weightFrom);
      if (tiers.length === 0) {
        window.alert(`${route}/${service} 缺少费率阶梯`);
        return;
      }
      if (tiers[0].weightFrom !== 0) {
        window.alert(`${route}/${service} 首档必须从 0kg 开始`);
        return;
      }
    }
  }
  try {
    store.publishVersion(draft.value);
    message.value = `价表 v${store.activeVersion.version} 已发布：已确认报价继续锁价，未确认报价将提示旧金额并需重算。`;
    editing.value = false;
    draft.value = null;
  } catch (e) {
    window.alert((e as Error).message);
  }
}

const history = computed(() =>
  store.versions.slice().sort((a, b) => b.version - a.version)
);

function tierLabel(rule: RateRule) {
  return `${rule.weightFrom}~${rule.weightTo === null ? "∞" : rule.weightTo}kg`;
}
</script>

<template>
  <section class="list-panel">
    <div class="toolbar">
      <h2>价表管理</h2>
      <div class="seg">
        <button type="button" :disabled="store.role !== 'approver'" @click="startEdit">
          基于当前版改版并发布
        </button>
        <button type="button" class="secondary" @click="showHistory = !showHistory">
          {{ showHistory ? "收起" : "查看" }}历史版本（{{ store.versions.length }}）
        </button>
      </div>
    </div>

    <p v-if="store.role !== 'approver'" class="role-notice">
      当前为业务员身份，只读查看；换版发布需审批人身份。
    </p>
    <p v-if="message" class="success-notice">{{ message }}</p>

    <div class="version-current">
      <p>
        当前生效：<strong>价表 v{{ store.activeVersion.version }}</strong>
        （{{ store.activeVersion.note }}）
      </p>
      <p class="muted">
        发布人：{{ store.activeVersion.publishedBy }} · 发布于 {{ formatDateTime(store.activeVersion.createdAt) }}
      </p>
    </div>

    <!-- 改版编辑 -->
    <div v-if="editing && draft" class="edit-box">
      <h3>编辑新版价表（基于 v{{ store.activeVersion.version }}，发布后为 v{{ store.activeVersion.version + 1 }}）</h3>
      <label>
        换版说明
        <input v-model="draft.note" placeholder="如：燃油费季节性上调" />
      </label>

      <h4 class="edit-h">基础运费阶梯（起步价 + 元/kg）</h4>
      <div v-for="route in ROUTES" :key="route" class="route-block">
        <p class="route-name">{{ route }}</p>
        <table class="rate-table">
          <thead>
            <tr>
              <th>服务</th>
              <th v-for="(t, i) in rateRow(route, SERVICES[0])" :key="i">阶梯 {{ i + 1 }}（{{ tierLabel(t) }}）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="service in SERVICES" :key="service">
              <td>{{ service }}</td>
              <td v-for="rule of rateRow(route, service)" :key="rule.weightFrom">
                <div class="rate-inputs">
                  <label class="mini">
                    起步
                    <input v-model.number="rule.base" type="number" step="0.1" min="0" />
                  </label>
                  <label class="mini">
                    元/kg
                    <input v-model.number="rule.perKg" type="number" step="0.01" min="0" />
                  </label>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h4 class="edit-h">附加费</h4>
      <div v-for="rule in draft.surchargeRules" :key="rule.id" class="rule-row">
        <span class="rule-name">{{ rule.name }}（适用：{{ rule.services.length ? rule.services.join("、") : "全部服务" }}）</span>
        <label class="mini">
          基础价百分比
          <input
            :value="rule.percentOfBase !== undefined ? (rule.percentOfBase * 100).toFixed(1) : ''"
            type="number"
            step="0.1"
            min="0"
            @input="setPercent(rule, Number(($event.target as HTMLInputElement).value) / 100)"
          />
          %
        </label>
        <label class="mini">
          或 元/kg
          <input
            :value="rule.perKg ?? ''"
            type="number"
            step="0.01"
            min="0"
            @input="setPerKg(rule, Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </div>

      <h4 class="edit-h">常规折扣（折率，如 0.96 = 96 折）</h4>
      <div v-for="rule in draft.discountRules" :key="rule.id" class="rule-row">
        <span class="rule-name">{{ rule.name }}（{{ rule.services.join("、") }}）</span>
        <label class="mini">
          折率
          <input
            :value="rule.rate"
            type="number"
            step="0.005"
            min="0.01"
            max="1"
            @input="setDiscount(rule, Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </div>

      <div class="actions">
        <button type="button" @click="publish">发布新版价表</button>
        <button type="button" class="secondary" @click="editing = false">取消</button>
      </div>
    </div>

    <!-- 历史版本只读留档 -->
    <div v-if="showHistory" class="history-versions">
      <article v-for="v in history" :key="v.id" class="version-item" :class="{ archived: !v.active }">
        <div class="record-head">
          <p class="record-title">
            价表 v{{ v.version }}
            <span v-if="v.active" class="tag-mini tag-active">生效中</span>
            <span v-else class="tag-mini">已归档</span>
          </p>
          <span class="muted">{{ formatDateTime(v.createdAt) }}</span>
        </div>
        <p class="note">{{ v.note }}（发布人：{{ v.publishedBy }}）</p>
        <p class="muted">
          含 {{ v.rateRules.length }} 条阶梯费率、{{ v.surchargeRules.length }} 条附加费、
          {{ v.discountRules.length }} 条常规折扣；已确认报价引用的旧版本规则在此完整留存。
        </p>
      </article>
    </div>
  </section>
</template>

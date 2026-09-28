import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { buildSeed } from "./seed";
import { calculate, round2 } from "./pricing";
import type {
  AuditEvent,
  PriceVersion,
  Quote,
  QuoteStatus,
  Role,
  SpecialApplication,
  SurchargeRule,
  DiscountRule,
  RateRule
} from "./types";

const STORAGE_KEY = "hxwlfront-13-freight-v2";
/** 特价申请有效期：48 小时 */
export const SPECIAL_TTL_MS = 48 * 3600000;

export const USERS: Record<Role, string> = {
  sales: "李业务员",
  approver: "王经理（审批人）"
};

interface PersistShape {
  versions: PriceVersion[];
  quotes: Quote[];
  applications: SpecialApplication[];
  events: AuditEvent[];
  role: Role;
}

export interface VersionDraft {
  note: string;
  rateRules: RateRule[];
  surchargeRules: SurchargeRule[];
  discountRules: DiscountRule[];
}

export class BusinessError extends Error {}

function loadState(): PersistShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as PersistShape;
    } catch {
      // 损坏数据回退到种子
    }
  }
  const seed = buildSeed();
  return { ...seed, role: "sales" };
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export const useFreightStore = defineStore("freight", () => {
  const initial = loadState();
  const versions = ref<PriceVersion[]>(initial.versions);
  const quotes = ref<Quote[]>(initial.quotes);
  const applications = ref<SpecialApplication[]>(initial.applications);
  const events = ref<AuditEvent[]>(initial.events);
  const role = ref<Role>(initial.role);

  const user = computed(() => USERS[role.value]);

  const activeVersion = computed(
    () => versions.value.find((v) => v.active) ?? versions.value[versions.value.length - 1]
  );

  function persist() {
    const data: PersistShape = {
      versions: versions.value,
      quotes: quotes.value,
      applications: applications.value,
      events: events.value,
      role: role.value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function switchRole(next: Role) {
    role.value = next;
    persist();
  }

  function log(
    ev: Omit<AuditEvent, "id" | "at" | "actor"> & { actor?: string }
  ) {
    events.value.unshift({
      id: uid("ev"),
      at: new Date().toISOString(),
      actor: ev.actor ?? user.value,
      ...ev
    });
    persist();
  }

  // ---------- 过期申请清理 ----------
  /**
   * 扫描超过有效期仍未审批的申请：作废并把报价退回「待确认」。
   * 任何业务操作前都先跑一遍，另在界面层定时触发。
   */
  function sweepExpired(): string[] {
    const expiredIds: string[] = [];
    const now = Date.now();
    for (const app of applications.value) {
      if (app.status === "待审批" && new Date(app.expiresAt).getTime() <= now) {
        app.status = "已过期";
        app.decidedAt = new Date().toISOString();
        app.decisionNote = "超过审批有效期未处理，系统自动作废。";
        expiredIds.push(app.id);
        const quote = quotes.value.find((q) => q.id === app.quoteId);
        if (quote && quote.status === "待批") {
          quote.status = "待确认";
          quote.updatedAt = new Date().toISOString();
        }
        log({
          category: "特价",
          action: "申请过期作废",
          detail: `特价申请（申请额 ${app.applyAmount} 元）超过有效期自动作废，报价退回待确认，需按当前价表重算后再提交。`,
          quoteId: app.quoteId,
          applicationId: app.id,
          actor: "系统"
        });
      }
    }
    if (expiredIds.length) persist();
    return expiredIds;
  }

  // ---------- 报价 ----------
  function requireSales() {
    if (role.value !== "sales") {
      throw new BusinessError("该操作仅限业务员执行，请切换到业务员身份。");
    }
  }
  function requireApprover() {
    if (role.value !== "approver") {
      throw new BusinessError("该操作仅限审批人执行，请切换到审批人身份。");
    }
  }

  /** 按当前价表试算（不落库），供表单实时预览 */
  function preview(route: string, service: Quote["service"], weight: number) {
    return calculate({ version: activeVersion.value, route, service, weight });
  }

  /**
   * 用「当前生效价表」对同一线路/重量/服务重算，仅用于和报价上的旧金额做对比；
   * 不会改动报价本身。已确认报价金额锁定，不参与对比。
   */
  function currentPriceOf(quote: Quote) {
    if (quote.status === "已确认") return null;
    try {
      return calculate({
        version: activeVersion.value,
        route: quote.route,
        service: quote.service,
        weight: quote.weight
      });
    } catch {
      return null;
    }
  }

  /** 未确认报价相对当前价表是否已过期（旧金额）；已确认报价金额锁定，不判旧 */
  function isStale(quote: Quote): boolean {
    if (quote.status === "已确认") return false;
    return quote.price.versionId !== activeVersion.value.id;
  }

  function createQuote(input: {
    customer: string;
    route: string;
    service: Quote["service"];
    weight: number;
    notes: string;
  }): Quote {
    requireSales();
    sweepExpired();
    if (!input.customer.trim()) throw new BusinessError("请填写客户名称。");
    if (!(input.weight > 0)) throw new BusinessError("重量必须大于 0。");
    const price = preview(input.route, input.service, input.weight);
    const now = new Date().toISOString();
    const quote: Quote = {
      id: uid("q"),
      customer: input.customer.trim(),
      route: input.route,
      service: input.service,
      weight: input.weight,
      status: "待确认",
      notes: input.notes.trim() || "暂无备注",
      price,
      source: "试算",
      createdAt: now,
      updatedAt: now
    };
    quotes.value.unshift(quote);
    log({
      category: "报价",
      action: "创建报价",
      detail: `${quote.customer} ${quote.route}/${quote.service}/${quote.weight}kg 按价表 v${price.versionNumber} 试算，基础价 ${price.baseAmount} 元、附加费 ${price.surchargeAmount} 元、折扣 ${price.standardDiscount} 元，应收 ${price.finalAmount} 元。`,
      quoteId: quote.id
    });
    return quote;
  }

  /** 客户确认：金额锁定，之后价表换版不再影响本报价 */
  function confirmQuote(quoteId: string) {
    requireSales();
    const quote = quotes.value.find((q) => q.id === quoteId);
    if (!quote) return;
    if (quote.status === "已确认") return;
    if (quote.status === "待批") {
      throw new BusinessError("报价正在特价审批中，待审批结束后再请客户确认。");
    }
    if (isStale(quote)) {
      throw new BusinessError("报价金额仍是旧价表金额，请先按当前价表重算后再确认。");
    }
    quote.status = "已确认";
    quote.updatedAt = new Date().toISOString();
    log({
      category: "报价",
      action: "客户确认锁价",
      detail: `客户确认报价 v${quote.price.versionNumber}，应收 ${quote.price.finalAmount} 元锁定；后续价表换版不影响本报价。`,
      quoteId: quote.id
    });
  }

  /** 按当前价表重算未确认报价；特价作废后重新申请前也必须先重算 */
  function recalc(quoteId: string) {
    const quote = quotes.value.find((q) => q.id === quoteId);
    if (!quote) return;
    if (quote.status === "已确认") {
      throw new BusinessError("已确认报价金额已锁定，不能重算。");
    }
    if (quote.status === "待批") {
      throw new BusinessError("报价正在特价审批中，不能重算。");
    }
    const oldVersion = quote.price.versionNumber;
    const oldAmount = quote.price.finalAmount;
    const price = calculate({
      version: activeVersion.value,
      route: quote.route,
      service: quote.service,
      weight: quote.weight
    });
    quote.price = price;
    quote.specialAppId = undefined;
    quote.source = "试算";
    quote.updatedAt = new Date().toISOString();
    log({
      category: "报价",
      action: "按当前价表重算",
      detail: `由价表 v${oldVersion}（${oldAmount} 元）重算为 v${price.versionNumber}：基础价 ${price.baseAmount} 元、附加费 ${price.surchargeAmount} 元、折扣 ${price.standardDiscount} 元，应收 ${price.finalAmount} 元。`,
      quoteId: quote.id
    });
  }

  function removeQuote(quoteId: string) {
    requireSales();
    const quote = quotes.value.find((q) => q.id === quoteId);
    if (!quote) return;
    if (quote.status === "待批") {
      throw new BusinessError("报价正在特价审批中，不能删除。");
    }
    quotes.value = quotes.value.filter((q) => q.id !== quoteId);
    log({
      category: "报价",
      action: "删除报价",
      detail: `删除报价：${quote.customer} ${quote.route}/${quote.service}/${quote.weight}kg。审批留档仍保留。`,
      quoteId: quote.id
    });
  }

  // ---------- 特价申请 ----------
  function activeApplicationOf(quoteId: string) {
    return applications.value.find(
      (a) => a.quoteId === quoteId && a.status === "待审批"
    );
  }

  function submitSpecial(input: {
    quoteId: string;
    applyAmount: number;
    reason: string;
  }) {
    requireSales();
    sweepExpired();
    const quote = quotes.value.find((q) => q.id === input.quoteId);
    if (!quote) return;
    if (quote.status === "已确认") {
      throw new BusinessError("报价已客户确认锁定，不能再申请特价。");
    }
    if (quote.status === "待批") {
      throw new BusinessError("该报价已有同类特价申请在审批中。");
    }
    if (isStale(quote)) {
      throw new BusinessError("报价还是旧价表金额，请先「按当前价表重算」后再提交特价申请。");
    }
    if (!(input.applyAmount > 0)) throw new BusinessError("申请金额必须大于 0。");
    if (input.applyAmount >= quote.price.finalAmount) {
      throw new BusinessError(
        `特价金额必须低于当前常规价 ${quote.price.finalAmount} 元。`
      );
    }
    if (!input.reason.trim()) throw new BusinessError("请填写特价申请理由。");

    const now = new Date();
    const app: SpecialApplication = {
      id: uid("sp"),
      quoteId: quote.id,
      applicant: user.value,
      quoteSnapshot: {
        customer: quote.customer,
        route: quote.route,
        service: quote.service,
        weight: quote.weight,
        versionId: quote.price.versionId,
        versionNumber: quote.price.versionNumber,
        standardAmount: quote.price.finalAmount
      },
      applyAmount: round2(input.applyAmount),
      reason: input.reason.trim(),
      status: "待审批",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SPECIAL_TTL_MS).toISOString()
    };
    applications.value.unshift(app);
    // 原报价进入待批；新申请基于当前常规价，清除上一轮特价批准痕迹
    quote.status = "待批";
    quote.source = "试算";
    quote.specialAppId = undefined;
    quote.updatedAt = now.toISOString();
    log({
      category: "特价",
      action: "提交特价申请",
      detail: `申请特价 ${app.applyAmount} 元（常规价 ${app.quoteSnapshot.standardAmount} 元，价表 v${app.quoteSnapshot.versionNumber}），有效期 48 小时；原报价进入待批。`,
      quoteId: quote.id,
      applicationId: app.id
    });
  }

  /**
   * 审批特价：只能由审批人处理，批准额不得高于申请额。
   */
  function decideSpecial(input: {
    applicationId: string;
    approve: boolean;
    approvedAmount?: number;
    decisionNote?: string;
  }) {
    requireApprover();
    const app = applications.value.find((a) => a.id === input.applicationId);
    if (!app) return;
    sweepExpired();
    if (app.status !== "待审批") {
      throw new BusinessError("该申请已处理或已作废。");
    }
    const quote = quotes.value.find((q) => q.id === app.quoteId);
    if (!quote) {
      throw new BusinessError("关联报价已不存在，无法审批。");
    }
    const now = new Date().toISOString();
    app.decidedAt = now;
    app.approver = user.value;
    app.decisionNote = input.decisionNote?.trim() || "无审批意见";

    if (!input.approve) {
      app.status = "已驳回";
      quote.status = "待确认";
      quote.updatedAt = now;
      log({
        category: "特价",
        action: "驳回特价申请",
        detail: `驳回 ${app.quoteSnapshot.customer} 的特价申请（申请额 ${app.applyAmount} 元）：${app.decisionNote}；报价退回待确认，业务员可重算后重新申请。`,
        quoteId: quote.id,
        applicationId: app.id
      });
      return;
    }

    const amount = round2(input.approvedAmount ?? app.applyAmount);
    // 规则：批准额不得超过申请额，也不能高于常规价
    if (amount > app.applyAmount) {
      throw new BusinessError(
        `批准额 ${amount} 元超过申请额 ${app.applyAmount} 元，不能批准。`
      );
    }
    if (amount <= 0) throw new BusinessError("批准金额必须大于 0。");
    if (amount > app.quoteSnapshot.standardAmount) {
      throw new BusinessError("批准额不得高于常规价表金额。");
    }
    // 申请快照可能已跨版：按申请时的价表版本应用批准额，保证「不超过申请额」的口径一致
    const snapshotVersion = versions.value.find(
      (v) => v.id === app.quoteSnapshot.versionId
    );
    if (!snapshotVersion) {
      throw new BusinessError("申请时的价表版本已丢失，无法处理，请要求业务员重算后重新申请。");
    }
    app.status = "已批准";
    app.approvedAmount = amount;

    quote.price = calculate({
      version: snapshotVersion,
      route: app.quoteSnapshot.route,
      service: app.quoteSnapshot.service,
      weight: app.quoteSnapshot.weight,
      specialTarget: amount
    });
    quote.specialAppId = app.id;
    quote.source = "特价批准";
    quote.status = "待确认";
    quote.updatedAt = now;
    log({
      category: "特价",
      action: "批准特价申请",
      detail: `按价表 v${snapshotVersion.version} 重算并应用特价：申请额 ${app.applyAmount} 元、批准 ${amount} 元（未超过申请额）；报价进入待确认，待客户确认后锁价。审批人：${user.value}。`,
      quoteId: quote.id,
      applicationId: app.id
    });
  }

  // ---------- 价表换版 ----------
  function publishVersion(draft: VersionDraft) {
    requireApprover();
    sweepExpired();
    const previous = activeVersion.value;
    const version: PriceVersion = {
      id: uid("pv"),
      version: previous.version + 1,
      note: draft.note.trim() || `价表第 ${previous.version + 1} 版`,
      createdAt: new Date().toISOString(),
      publishedBy: user.value,
      active: true,
      rateRules: draft.rateRules,
      surchargeRules: draft.surchargeRules,
      discountRules: draft.discountRules
    };
    for (const v of versions.value) v.active = false;
    versions.value.push(version);
    log({
      category: "价表",
      action: "发布价表",
      detail: `价表 v${version.version}《${version.note}》发布生效。已确认报价金额保持锁定，未确认报价标记为旧金额、需重算后才影响金额。`,
      versionId: version.id
    });
  }

  /** 用当前生效版的规则初始化换版草稿 */
  function draftFromActive(): VersionDraft {
    const v = activeVersion.value;
    return {
      note: "",
      rateRules: v.rateRules.map((r) => ({ ...r })),
      surchargeRules: v.surchargeRules.map((s) => ({ ...s, services: [...s.services] })),
      discountRules: v.discountRules.map((d) => ({ ...d, services: [...d.services] }))
    };
  }

  const pendingApplications = computed(() =>
    applications.value.filter((a) => a.status === "待审批")
  );
  const processedApplications = computed(() =>
    applications.value.filter((a) => a.status !== "待审批")
  );

  const quoteById = (id: string) => quotes.value.find((q) => q.id === id);
  const applicationById = (id: string) => applications.value.find((a) => a.id === id);

  const metrics = computed(() => {
    const by = (s: QuoteStatus) => quotes.value.filter((q) => q.status === s).length;
    return [
      { label: "报价总数", value: quotes.value.length },
      { label: "待确认（未锁价）", value: by("待确认") },
      { label: "特价待批", value: by("待批") },
      { label: "已确认（已锁价）", value: by("已确认") }
    ];
  });

  function resetDemo() {
    localStorage.removeItem(STORAGE_KEY);
    const seed = buildSeed();
    versions.value = seed.versions;
    quotes.value = seed.quotes;
    applications.value = seed.applications;
    events.value = seed.events;
    role.value = "sales";
    persist();
  }

  return {
    // state
    versions,
    quotes,
    applications,
    events,
    role,
    user,
    // getters
    activeVersion,
    pendingApplications,
    processedApplications,
    metrics,
    quoteById,
    applicationById,
    // helpers
    preview,
    currentPriceOf,
    isStale,
    activeApplicationOf,
    draftFromActive,
    // actions
    switchRole,
    sweepExpired,
    createQuote,
    confirmQuote,
    recalc,
    removeQuote,
    submitSpecial,
    decideSpecial,
    publishVersion,
    resetDemo,
    persist
  };
});

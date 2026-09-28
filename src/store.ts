import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { ElMessage } from "element-plus";
import type {
  AuditLogEntry,
  AuditModule,
  AuditTrailEntry,
  PriceBreakdown,
  PriceVersion,
  Quote,
  ServiceType,
  SpecialDiscount,
  SpecialRequest
} from "./types";
import {
  APPROVER_ROLES,
  CATEGORY_APPROVER,
  CUSTOMER_TYPES,
  REQUEST_VALID_DAYS,
  ROLE_LABEL,
  STORAGE_KEY,
  USERS,
  buildInitialVersion,
  calculate,
  categoryOf,
  round2,
  scaleVersion,
  specialDiscountFromRate
} from "./pricing";

interface PersistShape {
  versions: PriceVersion[];
  quotes: Quote[];
  requests: SpecialRequest[];
  logs: AuditLogEntry[];
  currentUserId: string;
}

interface NewQuoteInput {
  customer: string;
  customerType: string;
  route: string;
  service: ServiceType;
  weight: number;
  notes: string;
}

function daysAgoIso(days: number, base = Date.now()): string {
  return new Date(base - days * 86400000).toISOString();
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildSeed(now: number): PersistShape {
  const v1 = buildInitialVersion(daysAgoIso(30, now));
  const v2 = scaleVersion(
    v1,
    2,
    1.05,
    "总经理-郑海",
    "旺季运价整体上调 5%（基础价/续重/按件附加费），折扣与燃油比例不变",
    daysAgoIso(3, now)
  );
  v1.active = false;
  v2.active = true;

  const bd = (
    route: string,
    service: ServiceType,
    weight: number,
    customerType: string,
    version: PriceVersion
  ) => calculate(version, { route, service, weight, customerType })!;

  // 已锁定的标准报价（V1 锁定，换版后金额不变）
  const q3Bd = bd("广州-武汉", "次日达", 320, "大客户", v1);
  const q3: Quote = {
    id: "q-seed-3",
    customer: "广汇连锁",
    customerType: "大客户",
    route: "广州-武汉",
    service: "次日达",
    weight: 320,
    status: "已锁定",
    quotedVersionId: v1.id,
    locked: {
      kind: "standard",
      breakdown: q3Bd,
      lockedAt: daysAgoIso(12, now),
      lockedBy: "业务员-林晓"
    },
    notes: "客户已回传确认函",
    createdBy: "业务员-林晓",
    createdAt: daysAgoIso(13, now),
    updatedAt: daysAgoIso(12, now)
  };

  // 已锁定的特价报价（V2 批准后锁定）
  const q4Bd = bd("北京-济南", "冷链", 620, "大客户", v2);
  const q4Special: SpecialDiscount = {
    amount: specialDiscountFromRate(q4Bd.subtotal, 0.045),
    rate: 0.045,
    reason: "年度框架客户，竞品报价压力大"
  };
  const q4: Quote = {
    id: "q-seed-4",
    customer: "鲜达供应链",
    customerType: "大客户",
    route: "北京-济南",
    service: "冷链",
    weight: 620,
    status: "已锁定",
    quotedVersionId: v2.id,
    locked: {
      kind: "special",
      breakdown: q4Bd,
      specialDiscount: q4Special,
      lockedAt: daysAgoIso(5, now),
      lockedBy: "业务员-林晓"
    },
    notes: "特价 4.5%，区经理已批",
    createdBy: "业务员-林晓",
    createdAt: daysAgoIso(6, now),
    updatedAt: daysAgoIso(5, now)
  };
  const r4: SpecialRequest = {
    id: "r-seed-4",
    requestNo: "SP-SEED-004",
    quoteId: q4.id,
    category: categoryOf(q4Special.rate),
    breakdownAtRequest: q4Bd,
    requestedDiscount: q4Special,
    status: "已批准",
    applicant: "业务员-林晓",
    createdAt: daysAgoIso(6, now),
    expiresAt: daysAgoIso(3, now),
    decidedAt: daysAgoIso(5.4, now),
    approver: "区经理-周明",
    approvedDiscount: q4Special,
    decisionNote: "同意 4.5%，仅限本票",
    trail: [
      {
        at: daysAgoIso(6, now),
        by: "业务员-林晓",
        action: "提交申请",
        detail: `申请特价减免 ${q4Special.amount} 元（4.5%）`
      },
      {
        at: daysAgoIso(5.4, now),
        by: "区经理-周明",
        action: "批准",
        detail: "批准减免 4.5%，仅限本票"
      }
    ]
  };

  // 进行中的特价申请（V2，剩余约 2 天有效期）
  const q5: Quote = {
    id: "q-seed-5",
    customer: "恒业工贸",
    customerType: "协议客户",
    route: "成都-西安",
    service: "标准达",
    weight: 240,
    status: "特价待批",
    quotedVersionId: v2.id,
    notes: "客户要求与上月持平",
    createdBy: "业务员-林晓",
    createdAt: daysAgoIso(1, now),
    updatedAt: daysAgoIso(1, now)
  };
  const q5Bd = bd(q5.route, q5.service, q5.weight, q5.customerType, v2);
  const q5Special: SpecialDiscount = {
    amount: specialDiscountFromRate(q5Bd.subtotal, 0.06),
    rate: 0.06,
    reason: "客户月均发货 20 票，申请 6% 折扣"
  };
  const r5: SpecialRequest = {
    id: "r-seed-5",
    requestNo: "SP-SEED-005",
    quoteId: q5.id,
    category: categoryOf(q5Special.rate),
    breakdownAtRequest: q5Bd,
    requestedDiscount: q5Special,
    status: "待审批",
    applicant: "业务员-林晓",
    createdAt: daysAgoIso(1, now),
    expiresAt: new Date(now - 1 * 86400000 + REQUEST_VALID_DAYS * 86400000).toISOString(),
    trail: [
      {
        at: daysAgoIso(1, now),
        by: "业务员-林晓",
        action: "提交申请",
        detail: "申请特价减免 6%（二类，销售总监审批）"
      }
    ]
  };

  // 已过期的特价申请：初始即过有效期，启动时由 sweep 作废，业务员需重算重提
  const q6: Quote = {
    id: "q-seed-6",
    customer: "远诚建材",
    customerType: "普通客户",
    route: "杭州-合肥",
    service: "次日达",
    weight: 130,
    status: "特价待批",
    quotedVersionId: v1.id,
    notes: "客户拖了很久才回复",
    createdBy: "业务员-林晓",
    createdAt: daysAgoIso(12, now),
    updatedAt: daysAgoIso(12, now)
  };
  const q6Bd = bd(q6.route, q6.service, q6.weight, q6.customerType, v1);
  const q6Special: SpecialDiscount = {
    amount: specialDiscountFromRate(q6Bd.subtotal, 0.04),
    rate: 0.04,
    reason: "老客户维系，申请 4%"
  };
  const r6: SpecialRequest = {
    id: "r-seed-6",
    requestNo: "SP-SEED-006",
    quoteId: q6.id,
    category: categoryOf(q6Special.rate),
    breakdownAtRequest: q6Bd,
    requestedDiscount: q6Special,
    status: "待审批",
    applicant: "业务员-林晓",
    createdAt: daysAgoIso(12, now),
    expiresAt: daysAgoIso(9, now),
    trail: [
      {
        at: daysAgoIso(12, now),
        by: "业务员-林晓",
        action: "提交申请",
        detail: "申请特价减免 4%"
      }
    ]
  };

  // 两张未确认报价，演示换版影响
  const q1: Quote = {
    id: "q-seed-1",
    customer: "海沃商贸",
    customerType: "协议客户",
    route: "上海-南京",
    service: "标准达",
    weight: 180,
    status: "待确认",
    quotedVersionId: v1.id,
    notes: "等客户财务确认",
    createdBy: "业务员-林晓",
    createdAt: daysAgoIso(20, now),
    updatedAt: daysAgoIso(20, now)
  };
  const q2: Quote = {
    id: "q-seed-2",
    customer: "云仓食品",
    customerType: "普通客户",
    route: "杭州-合肥",
    service: "冷链",
    weight: 95,
    status: "待确认",
    quotedVersionId: v2.id,
    notes: "当前版本报价",
    createdBy: "业务员-林晓",
    createdAt: daysAgoIso(2, now),
    updatedAt: daysAgoIso(2, now)
  };

  const logs: AuditLogEntry[] = [
    {
      id: "log-seed-1",
      at: v1.publishedAt,
      by: "系统初始化",
      module: "价表",
      action: "发布版本",
      detail: "V1 初始价表发布并生效"
    },
    {
      id: "log-seed-2",
      at: v2.publishedAt,
      by: "总经理-郑海",
      module: "价表",
      action: "发布版本",
      detail: "V2 发布并生效，V1 归档；整体运价上调 5%，仅影响未确认报价"
    }
  ];

  return {
    versions: [v2, v1],
    quotes: [q6, q5, q2, q1, q4, q3],
    requests: [r6, r5, r4],
    logs,
    currentUserId: USERS[0].id
  };
}

function load(): PersistShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as PersistShape;
    } catch {
      // fall through to seed
    }
  }
  return buildSeed(Date.now());
}

export const usePricingStore = defineStore("pricing", () => {
  const initial = load();
  const versions = ref<PriceVersion[]>(initial.versions);
  const quotes = ref<Quote[]>(initial.quotes);
  const requests = ref<SpecialRequest[]>(initial.requests);
  const logs = ref<AuditLogEntry[]>(initial.logs);
  const currentUserId = ref(initial.currentUserId);

  // 演示时钟：仅内存，刷新页面回到真实时间
  const clockOffsetMs = ref(0);
  const now = ref(new Date(Date.now() + clockOffsetMs.value).toISOString());

  function persist() {
    const data: PersistShape = {
      versions: versions.value,
      quotes: quotes.value,
      requests: requests.value,
      logs: logs.value,
      currentUserId: currentUserId.value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function nowMs(): number {
    return Date.now() + clockOffsetMs.value;
  }

  function tick() {
    now.value = new Date(nowMs()).toISOString();
    sweepExpired();
  }

  function addLog(by: string, module: AuditModule, action: string, detail: string) {
    logs.value = [
      { id: uid("log"), at: new Date(nowMs()).toISOString(), by, module, action, detail },
      ...logs.value
    ];
  }

  const currentUser = computed(
    () => USERS.find((u) => u.id === currentUserId.value) ?? USERS[0]
  );
  const isApprover = computed(() => APPROVER_ROLES.includes(currentUser.value.role));

  const activeVersion = computed(
    () => versions.value.find((v) => v.active) ?? versions.value[0]
  );
  const archivedVersions = computed(() => versions.value.filter((v) => !v.active));

  function findVersion(id: string): PriceVersion | undefined {
    return versions.value.find((v) => v.id === id);
  }

  /** 未确认报价按当前生效价表重新试算 */
  function liveBreakdown(quote: Quote): PriceBreakdown | null {
    return calculate(activeVersion.value, {
      route: quote.route,
      service: quote.service,
      weight: quote.weight,
      customerType: quote.customerType
    });
  }

  function isStale(quote: Quote): boolean {
    // 特价待批/特价待确认的金额按申请快照冻结；只有常规未确认报价受换版影响
    return quote.status === "待确认" && quote.quotedVersionId !== activeVersion.value.id;
  }

  /** 报价单上进行中的特价申请（待审批） */
  function pendingRequest(quoteId: string): SpecialRequest | undefined {
    return requests.value.find((r) => r.quoteId === quoteId && r.status === "待审批");
  }

  function latestRequest(quoteId: string): SpecialRequest | undefined {
    return requests.value
      .filter((r) => r.quoteId === quoteId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  /* ---------- 报价 ---------- */

  function createQuote(input: NewQuoteInput): string | null {
    if (!input.customer.trim()) return "请填写客户名称";
    if (input.weight <= 0) return "重量必须大于 0";
    const bd = calculate(activeVersion.value, {
      route: input.route,
      service: input.service,
      weight: input.weight,
      customerType: input.customerType
    });
    if (!bd) return "当前价表缺少该线路/服务的运价规则";

    const ts = new Date(nowMs()).toISOString();
    const quote: Quote = {
      id: uid("q"),
      customer: input.customer.trim(),
      customerType: input.customerType,
      route: input.route,
      service: input.service,
      weight: input.weight,
      status: "待确认",
      quotedVersionId: activeVersion.value.id,
      notes: input.notes.trim(),
      createdBy: currentUser.value.name,
      createdAt: ts,
      updatedAt: ts
    };
    quotes.value = [quote, ...quotes.value];
    addLog(
      currentUser.value.name,
      "报价",
      "新增报价",
      `${quote.customer} ${quote.route}/${quote.service}/${quote.weight}kg，按 V${bd.versionNo} 试算合计 ${bd.total} 元`
    );
    persist();
    return null;
  }

  /** 未确认报价重算到当前价表（锁定单不允许重算） */
  function recalcQuote(id: string): boolean {
    const quote = quotes.value.find((q) => q.id === id);
    if (!quote || quote.status === "已锁定") return false;
    const bd = liveBreakdown(quote);
    if (!bd) return false;
    const fromVer = quote.quotedVersionId;
    quote.quotedVersionId = activeVersion.value.id;
    quote.updatedAt = new Date(nowMs()).toISOString();
    addLog(
      currentUser.value.name,
      "报价",
      "重算报价",
      `${quote.customer} 从 V${findVersion(fromVer)?.versionNo ?? "?"} 重算到 V${bd.versionNo}，合计 ${bd.total} 元`
    );
    persist();
    return true;
  }

  function recalcAllStale() {
    const stale = quotes.value.filter((q) => isStale(q));
    stale.forEach((q) => recalcQuote(q.id));
    if (stale.length === 0) ElMessage.info("没有需要重算的未确认报价");
  }

  /** 客户确认 → 金额锁定；特价单取已批准申请的减免额 */
  function lockQuote(id: string): string | null {
    const quote = quotes.value.find((q) => q.id === id);
    if (!quote) return "报价不存在";
    if (quote.status === "已锁定") return "报价已锁定";
    if (quote.status === "特价待批") return "特价申请审批中，暂不能确认";

    const ts = new Date(nowMs()).toISOString();
    if (quote.status === "特价待确认") {
      const req = requests.value
        .filter((r) => r.quoteId === quote.id && r.status === "已批准")
        .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
      if (!req || !req.approvedDiscount) return "未找到已批准的特价，无法锁定";
      quote.locked = {
        kind: "special",
        breakdown: req.breakdownAtRequest,
        specialDiscount: req.approvedDiscount,
        lockedAt: ts,
        lockedBy: currentUser.value.name
      };
    } else {
      const bd = liveBreakdown(quote);
      if (!bd) return "当前价表无法匹配运价";
      quote.quotedVersionId = bd.versionId;
      quote.locked = {
        kind: "standard",
        breakdown: bd,
        lockedAt: ts,
        lockedBy: currentUser.value.name
      };
    }
    quote.status = "已锁定";
    quote.updatedAt = ts;
    addLog(
      currentUser.value.name,
      "报价",
      "客户确认锁定",
      `${quote.customer} 金额已锁定（V${quote.locked!.breakdown.versionNo}），后续换版不再影响本单`
    );
    persist();
    return null;
  }

  /** 特价待确认状态下放弃特价，回到常规报价 */
  function waiveSpecial(id: string) {
    const quote = quotes.value.find((q) => q.id === id);
    if (!quote || quote.status !== "特价待确认") return;
    quote.status = "待确认";
    quote.quotedVersionId = activeVersion.value.id;
    quote.updatedAt = new Date(nowMs()).toISOString();
    addLog(currentUser.value.name, "报价", "放弃特价", `${quote.customer} 放弃已批准特价，按当前常规价表报价`);
    persist();
  }

  function deleteQuote(id: string) {
    const q = quotes.value.find((x) => x.id === id);
    quotes.value = quotes.value.filter((x) => x.id !== id);
    addLog(currentUser.value.name, "报价", "删除报价", q ? `${q.customer} ${q.route}` : id);
    persist();
  }

  /* ---------- 特价申请 ---------- */

  function trailEntry(action: string, detail: string): AuditTrailEntry {
    return { at: new Date(nowMs()).toISOString(), by: currentUser.value.name, action, detail };
  }

  function requestSpecial(
    quoteId: string,
    rate: number,
    reason: string
  ): string | null {
    const quote = quotes.value.find((q) => q.id === quoteId);
    if (!quote) return "报价不存在";
    if (quote.status === "已锁定") return "报价已锁定，不能申请特价";
    if (pendingRequest(quoteId)) return "该报价已有待审批的特价申请";
    if (!(rate > 0) || rate > 0.5) return "折扣率需在 0~50% 之间";
    if (!reason.trim()) return "请填写特价理由";

    const bd = liveBreakdown(quote);
    if (!bd) return "当前价表无法匹配运价";
    quote.quotedVersionId = bd.versionId;
    const discount: SpecialDiscount = {
      amount: specialDiscountFromRate(bd.subtotal, rate),
      rate: round2(rate),
      reason: reason.trim()
    };
    const category = categoryOf(rate);
    const ts = new Date(nowMs()).toISOString();
    const req: SpecialRequest = {
      id: uid("r"),
      requestNo: `SP-${Date.now().toString().slice(-6)}`,
      quoteId,
      category,
      breakdownAtRequest: bd,
      requestedDiscount: discount,
      status: "待审批",
      applicant: currentUser.value.name,
      createdAt: ts,
      expiresAt: new Date(nowMs() + REQUEST_VALID_DAYS * 86400000).toISOString(),
      trail: [
        {
          at: ts,
          by: currentUser.value.name,
          action: "提交申请",
          detail: `申请特价减免 ${discount.amount} 元（${(rate * 100).toFixed(1)}%），${category}，审批人：${
            ROLE_LABEL[CATEGORY_APPROVER[category]]
          }`
        }
      ]
    };
    requests.value = [req, ...requests.value];
    quote.status = "特价待批";
    quote.updatedAt = ts;
    addLog(
      currentUser.value.name,
      "特价审批",
      "提交特价申请",
      `${quote.customer} 申请 ${(rate * 100).toFixed(1)}%（${category}），有效期 ${REQUEST_VALID_DAYS} 天，原报价进入待批`
    );
    persist();
    return null;
  }

  function approveRequest(
    requestId: string,
    approvedRate: number,
    note: string
  ): string | null {
    const req = requests.value.find((r) => r.id === requestId);
    if (!req) return "申请不存在";
    if (req.status !== "待审批") return "该申请已结案，不能再审批";
    if (new Date(req.expiresAt).getTime() <= nowMs()) {
      sweepExpired();
      return "申请已超过有效期并作废，请通知业务员重算后重新提交";
    }
    if (CATEGORY_APPROVER[req.category] !== currentUser.value.role)
      return `同类申请仅由${ROLE_LABEL[CATEGORY_APPROVER[req.category]]}处理`;
    if (!(approvedRate > 0)) return "批准折扣率必须大于 0";
    if (approvedRate > req.requestedDiscount.rate + 1e-9)
      return `批准折扣不得高于申请折扣（${(req.requestedDiscount.rate * 100).toFixed(1)}%）`;

    const approved: SpecialDiscount = {
      amount: specialDiscountFromRate(req.breakdownAtRequest.subtotal, approvedRate),
      rate: round2(approvedRate),
      reason: req.requestedDiscount.reason
    };
    const ts = new Date(nowMs()).toISOString();
    req.status = "已批准";
    req.decidedAt = ts;
    req.approver = currentUser.value.name;
    req.approvedDiscount = approved;
    req.decisionNote = note.trim() || "同意";
    req.trail.push(
      trailEntry(
        "批准",
        `批准减免 ${approved.amount} 元（${(approvedRate * 100).toFixed(1)}%），未超过申请额 ${(
          req.requestedDiscount.rate * 100
        ).toFixed(1)}%。备注：${req.decisionNote}`
      )
    );

    const quote = quotes.value.find((q) => q.id === req.quoteId);
    if (quote) {
      quote.status = "特价待确认";
      quote.updatedAt = ts;
    }
    addLog(
      currentUser.value.name,
      "特价审批",
      "批准特价",
      `${req.requestNo} 批准 ${(approvedRate * 100).toFixed(1)}%（申请 ${(
        req.requestedDiscount.rate * 100
      ).toFixed(1)}%），待客户确认后锁定`
    );
    persist();
    return null;
  }

  function rejectRequest(requestId: string, note: string): string | null {
    const req = requests.value.find((r) => r.id === requestId);
    if (!req) return "申请不存在";
    if (req.status !== "待审批") return "该申请已结案，不能再审批";
    if (CATEGORY_APPROVER[req.category] !== currentUser.value.role)
      return `同类申请仅由${ROLE_LABEL[CATEGORY_APPROVER[req.category]]}处理`;
    if (!note.trim()) return "请填写驳回理由";

    const ts = new Date(nowMs()).toISOString();
    req.status = "已驳回";
    req.decidedAt = ts;
    req.approver = currentUser.value.name;
    req.decisionNote = note.trim();
    req.trail.push(trailEntry("驳回", `驳回：${note.trim()}`));

    const quote = quotes.value.find((q) => q.id === req.quoteId);
    if (quote) {
      quote.status = "待确认";
      quote.updatedAt = ts;
    }
    addLog(
      currentUser.value.name,
      "特价审批",
      "驳回特价",
      `${req.requestNo} 驳回：${note.trim()}，原报价恢复为常规报价`
    );
    persist();
    return null;
  }

  /** 过期作废/被驳回的申请：按当前价表重算后重新提交，生成新申请，旧申请标记已重提 */
  function resubmit(
    oldRequestId: string,
    rate: number,
    reason: string
  ): string | null {
    const old = requests.value.find((r) => r.id === oldRequestId);
    if (!old) return "申请不存在";
    if (old.status === "待审批" || old.status === "已重提") return "该申请状态不允许重提";
    const quote = quotes.value.find((q) => q.id === old.quoteId);
    if (!quote) return "原报价不存在";
    if (quote.status === "已锁定") return "报价已锁定";
    if (!(rate > 0) || rate > 0.5) return "折扣率需在 0~50% 之间";
    if (!reason.trim()) return "请填写特价理由";

    const bd = liveBreakdown(quote);
    if (!bd) return "当前价表无法匹配运价";
    const discount: SpecialDiscount = {
      amount: specialDiscountFromRate(bd.subtotal, rate),
      rate: round2(rate),
      reason: reason.trim()
    };
    const category = categoryOf(rate);
    const ts = new Date(nowMs()).toISOString();
    const req: SpecialRequest = {
      id: uid("r"),
      requestNo: `SP-${Date.now().toString().slice(-6)}`,
      quoteId: quote.id,
      category,
      breakdownAtRequest: bd,
      requestedDiscount: discount,
      status: "待审批",
      applicant: currentUser.value.name,
      createdAt: ts,
      expiresAt: new Date(nowMs() + REQUEST_VALID_DAYS * 86400000).toISOString(),
      trail: [
        {
          at: ts,
          by: currentUser.value.name,
          action: "重算后重新提交",
          detail: `原申请 ${old.requestNo} 已${old.status}；按 V${bd.versionNo} 重算，重新申请 ${(
            rate * 100
          ).toFixed(1)}%（${category}）`
        }
      ]
    };
    requests.value = [req, ...requests.value];
    old.status = "已重提";
    old.supersededBy = req.id;
    old.trail.push(
      trailEntry("重新提交", `已按当前价表重算并生成新申请 ${req.requestNo}`)
    );
    quote.status = "特价待批";
    quote.quotedVersionId = bd.versionId;
    quote.updatedAt = ts;
    addLog(
      currentUser.value.name,
      "特价审批",
      "重算重提",
      `${quote.customer} 原申请 ${old.requestNo}（${old.status}）按 V${bd.versionNo} 重算后重新提交 ${req.requestNo}`
    );
    persist();
    return null;
  }

  /** 到期的待审批申请自动作废，原报价退回待确认 */
  function sweepExpired(): number {
    const ts = new Date(nowMs()).toISOString();
    let count = 0;
    for (const req of requests.value) {
      if (req.status === "待审批" && new Date(req.expiresAt).getTime() <= nowMs()) {
        req.status = "已作废";
        req.trail.push({
          at: ts,
          by: "系统",
          action: "到期作废",
          detail: `有效期至 ${req.expiresAt}，未审批自动作废；业务员须按当前价表重算后重新提交`
        });
        const quote = quotes.value.find((q) => q.id === req.quoteId);
        if (quote && quote.status === "特价待批") {
          quote.status = "待确认";
          quote.updatedAt = ts;
        }
        count++;
        addLog("系统", "特价审批", "申请到期作废", `${req.requestNo} 有效期截止自动作废，原报价退回待确认`);
      }
    }
    if (count > 0) persist();
    return count;
  }

  /* ---------- 价表换版 ---------- */

  function publishVersion(factor: number, note: string): string | null {
    if (!(factor > 0) || factor > 3) return "调整系数需在 0~3 之间";
    if (!note.trim()) return "请填写换版说明";
    if (!isApprover.value) return "仅审批人（区经理/销售总监/总经理）可以发布价表";
    const nextNo = Math.max(...versions.value.map((v) => v.versionNo)) + 1;
    const nv = scaleVersion(
      activeVersion.value,
      nextNo,
      factor,
      currentUser.value.name,
      note.trim(),
      new Date(nowMs()).toISOString()
    );
    versions.value.forEach((v) => (v.active = false));
    versions.value = [nv, ...versions.value];
    addLog(
      currentUser.value.name,
      "价表",
      "发布版本",
      `V${nextNo} 发布并生效，V${activeVersion.value.versionNo} 归档；调整系数 ${factor}。已确认报价金额保持锁定，仅未确认报价受影响`
    );
    persist();
    sweepExpired();
    return null;
  }

  function setClockOffset(days: number) {
    clockOffsetMs.value = Math.round(days * 86400000);
    tick();
  }

  function switchUser(id: string) {
    currentUserId.value = id;
    persist();
  }

  const pendingCount = computed(
    () =>
      requests.value.filter(
        (r) => r.status === "待审批" && CATEGORY_APPROVER[r.category] === currentUser.value.role
      ).length
  );

  const metrics = computed(() => {
    const total = quotes.value.length;
    const locked = quotes.value.filter((q) => q.status === "已锁定").length;
    const waiting = requests.value.filter((r) => r.status === "待审批").length;
    const stale = quotes.value.filter((q) => isStale(q)).length;
    return [
      { label: "报价总数", value: total },
      { label: "已确认锁定", value: locked },
      { label: "特价待审批", value: waiting },
      { label: "未确认且落后价表", value: stale }
    ];
  });

  persist();
  sweepExpired();

  return {
    // state
    versions,
    quotes,
    requests,
    logs,
    currentUserId,
    now,
    CUSTOMER_TYPES,
    // getters
    currentUser,
    isApprover,
    activeVersion,
    archivedVersions,
    metrics,
    pendingCount,
    // helpers
    findVersion,
    liveBreakdown,
    isStale,
    pendingRequest,
    latestRequest,
    tick,
    // quote actions
    createQuote,
    recalcQuote,
    recalcAllStale,
    lockQuote,
    waiveSpecial,
    deleteQuote,
    // request actions
    requestSpecial,
    approveRequest,
    rejectRequest,
    resubmit,
    sweepExpired,
    // version / user
    publishVersion,
    setClockOffset,
    switchUser
  };
});

import { calculate } from "./pricing";
import type {
  AuditEvent,
  PriceVersion,
  Quote,
  RateRule,
  ServiceType,
  SpecialApplication,
  SurchargeRule,
  DiscountRule
} from "./types";
import { ROUTES, SERVICES } from "./types";

const DAY = 86400000;
const HOUR = 3600000;

const tierDefs: Record<
  ServiceType,
  Array<{ to: number | null; base: number; perKg: number }>
> = {
  标准达: [
    { to: 50, base: 35, perKg: 4.6 },
    { to: 200, base: 55, perKg: 4.2 },
    { to: null, base: 80, perKg: 3.9 }
  ],
  次日达: [
    { to: 50, base: 45, perKg: 5.4 },
    { to: 200, base: 70, perKg: 5.0 },
    { to: null, base: 150, perKg: 4.6 }
  ],
  冷链: [
    { to: 50, base: 60, perKg: 6.2 },
    { to: 200, base: 90, perKg: 5.6 },
    { to: null, base: 120, perKg: 5.0 }
  ]
};

/** 各线路相对基准价表的系数（base、perKg 连乘） */
const routeFactors: Record<string, number> = {
  "上海-南京": 1.0,
  "杭州-合肥": 0.92,
  "广州-长沙": 1.08,
  "北京-济南": 0.96
};

function buildRateRules(factorOverride?: Record<string, number>): RateRule[] {
  const rules: RateRule[] = [];
  for (const route of ROUTES) {
    const f = factorOverride?.[route] ?? routeFactors[route];
    for (const service of SERVICES) {
      const tiers = tierDefs[service];
      tiers.forEach((tier, index) => {
        const prevTo = index === 0 ? 0 : tiers[index - 1].to ?? 0;
        rules.push({
          route,
          service,
          weightFrom: prevTo,
          weightTo: index === tiers.length - 1 ? null : tier.to,
          base: Math.round(tier.base * f * 10) / 10,
          perKg: Math.round(tier.perKg * f * 100) / 100
        });
      });
    }
  }
  return rules;
}

function v1Surcharges(): SurchargeRule[] {
  return [
    { id: "surch-fuel", name: "燃油附加费", services: [], percentOfBase: 0.06 },
    { id: "surch-cold", name: "冷链操作费", services: ["冷链"], perKg: 1 }
  ];
}

function v2Surcharges(): SurchargeRule[] {
  return [
    { id: "surch-fuel", name: "燃油附加费", services: [], percentOfBase: 0.08 },
    { id: "surch-cold", name: "冷链操作费", services: ["冷链"], perKg: 1.2 }
  ];
}

function v1Discounts(): DiscountRule[] {
  return [
    { id: "disc-std", name: "标准合约折扣", services: ["标准达"], rate: 0.96 },
    { id: "disc-next", name: "次日达合约折扣", services: ["次日达"], rate: 0.98 },
    { id: "disc-cold", name: "冷链合约折扣", services: ["冷链"], rate: 0.98 }
  ];
}

function v2Discounts(): DiscountRule[] {
  return [
    { id: "disc-std", name: "标准合约折扣", services: ["标准达"], rate: 0.96 },
    { id: "disc-next", name: "次日达合约折扣", services: ["次日达"], rate: 0.98 },
    { id: "disc-cold", name: "冷链合约折扣", services: ["冷链"], rate: 0.97 }
  ];
}

export function buildSeed(): {
  versions: PriceVersion[];
  quotes: Quote[];
  applications: SpecialApplication[];
  events: AuditEvent[];
} {
  const now = Date.now();
  const iso = (offset: number) => new Date(now + offset).toISOString();

  const v1: PriceVersion = {
    id: "pv-v1",
    version: 1,
    note: "初版合约价表",
    createdAt: iso(-30 * DAY),
    publishedBy: "王经理（审批人）",
    active: false,
    rateRules: buildRateRules(),
    surchargeRules: v1Surcharges(),
    discountRules: v1Discounts()
  };

  const v2: PriceVersion = {
    id: "pv-v2",
    version: 2,
    note: "燃油附加费上调至 8%，冷链操作费 1.2 元/kg，冷链合约 97 折",
    createdAt: iso(-6 * DAY),
    publishedBy: "王经理（审批人）",
    active: true,
    rateRules: buildRateRules({ "广州-长沙": 1.1 }),
    surchargeRules: v2Surcharges(),
    discountRules: v2Discounts()
  };

  // A：客户已确认，按 v1 锁价（v2 换版不影响）
  const priceA = calculate({
    version: v1,
    route: "杭州-合肥",
    service: "标准达",
    weight: 95
  });
  const quoteA: Quote = {
    id: "q-seed-a",
    customer: "海沃商贸",
    route: "杭州-合肥",
    service: "标准达",
    weight: 95,
    status: "已确认",
    notes: "季度合约客户，客户已确认锁定 v1 金额。",
    price: { ...priceA, calculatedAt: iso(-20 * DAY) },
    source: "试算",
    createdAt: iso(-20 * DAY),
    updatedAt: iso(-19 * DAY)
  };

  // B：仍按 v1 报价、未确认，v2 已生效 -> 旧金额，待重算
  const priceB = calculate({
    version: v1,
    route: "上海-南京",
    service: "冷链",
    weight: 180
  });
  const quoteB: Quote = {
    id: "q-seed-b",
    customer: "云仓食品",
    route: "上海-南京",
    service: "冷链",
    weight: 180,
    status: "待确认",
    notes: "温区已确认；价表已换版，金额未重算。",
    price: { ...priceB, calculatedAt: iso(-4 * DAY) },
    source: "试算",
    createdAt: iso(-4 * DAY),
    updatedAt: iso(-4 * DAY)
  };

  // C：业务员已提交特价申请，原报价进入待批
  const priceC = calculate({
    version: v2,
    route: "广州-长沙",
    service: "次日达",
    weight: 320
  });
  const quoteC: Quote = {
    id: "q-seed-c",
    customer: "恒泰电子",
    route: "广州-长沙",
    service: "次日达",
    weight: 320,
    status: "待批",
    notes: "客户月均 30 票，申请特价冲量。",
    price: { ...priceC, calculatedAt: iso(-6 * HOUR) },
    source: "试算",
    createdAt: iso(-6 * HOUR),
    updatedAt: iso(-2 * HOUR)
  };

  const appC: SpecialApplication = {
    id: "sp-seed-c",
    quoteId: "q-seed-c",
    applicant: "李业务员",
    quoteSnapshot: {
      customer: "恒泰电子",
      route: "广州-长沙",
      service: "次日达",
      weight: 320,
      versionId: "pv-v2",
      versionNumber: 2,
      standardAmount: priceC.finalAmount
    },
    applyAmount: 1650,
    reason: "竞品报价 1680 元，客户承诺本月走货 30 票。",
    status: "待审批",
    createdAt: iso(-2 * HOUR),
    expiresAt: iso(2 * DAY - 2 * HOUR)
  };

  // D：上一笔特价申请已过期作废，业务员已按 v2 重算（可重新申请）
  const priceDv1 = calculate({
    version: v1,
    route: "北京-济南",
    service: "冷链",
    weight: 60
  });
  const priceD = calculate({
    version: v2,
    route: "北京-济南",
    service: "冷链",
    weight: 60
  });
  const quoteD: Quote = {
    id: "q-seed-d",
    customer: "鲜达冷链",
    route: "北京-济南",
    service: "冷链",
    weight: 60,
    status: "待确认",
    notes: "上一笔特价申请已过期，已按 v2 重算。",
    price: { ...priceD, calculatedAt: iso(-2 * DAY) },
    source: "试算",
    createdAt: iso(-5 * DAY),
    updatedAt: iso(-2 * DAY)
  };

  const appD: SpecialApplication = {
    id: "sp-seed-d",
    quoteId: "q-seed-d",
    applicant: "李业务员",
    quoteSnapshot: {
      customer: "鲜达冷链",
      route: "北京-济南",
      service: "冷链",
      weight: 60,
      versionId: "pv-v1",
      versionNumber: 1,
      standardAmount: priceDv1.finalAmount
    },
    applyAmount: 470,
    reason: "新客户首单让利。",
    status: "已过期",
    createdAt: iso(-5 * DAY),
    expiresAt: iso(-3 * DAY),
    decidedAt: iso(-3 * DAY),
    decisionNote: "超过审批有效期未处理，系统自动作废。"
  };

  const events: AuditEvent[] = [
    {
      id: "ev-1",
      at: iso(-30 * DAY),
      actor: "王经理（审批人）",
      category: "价表",
      action: "发布价表",
      detail: "价表 v1《初版合约价表》发布生效。",
      versionId: "pv-v1"
    },
    {
      id: "ev-2",
      at: iso(-20 * DAY),
      actor: "李业务员",
      category: "报价",
      action: "创建报价",
      detail: `海沃商贸 杭州-合肥/标准达/95kg 按价表 v1 试算，金额 ${priceA.finalAmount} 元。`,
      quoteId: "q-seed-a"
    },
    {
      id: "ev-3",
      at: iso(-19 * DAY),
      actor: "李业务员",
      category: "报价",
      action: "客户确认锁价",
      detail: `客户确认报价，金额 ${priceA.finalAmount} 元锁定；后续换版不影响本报价。`,
      quoteId: "q-seed-a"
    },
    {
      id: "ev-4",
      at: iso(-6 * DAY),
      actor: "王经理（审批人）",
      category: "价表",
      action: "发布价表",
      detail: "价表 v2 发布生效；燃油附加费 8%、冷链操作费 1.2 元/kg，仅影响未确认报价。",
      versionId: "pv-v2"
    },
    {
      id: "ev-5",
      at: iso(-5 * DAY),
      actor: "李业务员",
      category: "报价",
      action: "创建报价",
      detail: "鲜达冷链 北京-济南/冷链/60kg 按价表 v1 试算。",
      quoteId: "q-seed-d"
    },
    {
      id: "ev-6",
      at: iso(-5 * DAY),
      actor: "李业务员",
      category: "特价",
      action: "提交特价申请",
      detail: `申请金额 470 元（常规价 ${priceDv1.finalAmount} 元），有效期 48 小时，报价进入待批。`,
      quoteId: "q-seed-d",
      applicationId: "sp-seed-d"
    },
    {
      id: "ev-7",
      at: iso(-3 * DAY),
      actor: "系统",
      category: "特价",
      action: "申请过期作废",
      detail: "特价申请超过有效期未审批，自动作废；报价退回待确认。",
      quoteId: "q-seed-d",
      applicationId: "sp-seed-d"
    },
    {
      id: "ev-8",
      at: iso(-2 * DAY),
      actor: "李业务员",
      category: "报价",
      action: "按新版重算",
      detail: `已过期申请作废后，按当前价表 v2 重算，金额 ${priceD.finalAmount} 元。`,
      quoteId: "q-seed-d"
    },
    {
      id: "ev-9",
      at: iso(-4 * DAY),
      actor: "李业务员",
      category: "报价",
      action: "创建报价",
      detail: `云仓食品 上海-南京/冷链/180kg 按价表 v1 试算，金额 ${priceB.finalAmount} 元。`,
      quoteId: "q-seed-b"
    },
    {
      id: "ev-10",
      at: iso(-6 * HOUR),
      actor: "李业务员",
      category: "报价",
      action: "创建报价",
      detail: `恒泰电子 广州-长沙/次日达/320kg 按价表 v2 试算，金额 ${priceC.finalAmount} 元。`,
      quoteId: "q-seed-c"
    },
    {
      id: "ev-11",
      at: iso(-2 * HOUR),
      actor: "李业务员",
      category: "特价",
      action: "提交特价申请",
      detail: `申请金额 1650 元（常规价 ${priceC.finalAmount} 元），有效期 48 小时，报价进入待批。`,
      quoteId: "q-seed-c",
      applicationId: "sp-seed-c"
    }
  ];
  events.sort((a, b) => a.at.localeCompare(b.at));

  return { versions: [v1, v2], quotes: [quoteA, quoteB, quoteC, quoteD], applications: [appC, appD], events };
}

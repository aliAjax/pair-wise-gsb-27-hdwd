import type {
  PriceBreakdown,
  PriceVersion,
  RateRule,
  Role,
  ServiceType,
  SurchargeLine,
  DiscountLine,
  SurchargeRule,
  SpecialCategory,
  WeightBand
} from "./types";

export const STORAGE_KEY = "hxwlfront-13-pricing-v1";

export const SERVICES: readonly ServiceType[] = ["标准达", "次日达", "冷链"];
export const CUSTOMER_TYPES = ["普通客户", "协议客户", "大客户"];

/** 线路基础系数（标准达为基准），用于生成初始价表 */
const ROUTE_FACTORS: Record<string, number> = {
  "上海-南京": 0.9,
  "杭州-合肥": 1.0,
  "广州-武汉": 1.4,
  "北京-济南": 1.15,
  "成都-西安": 1.3
};
export const SEED_ROUTES = Object.keys(ROUTE_FACTORS);

const SERVICE_MULTIPLIER: Record<ServiceType, number> = {
  标准达: 1,
  次日达: 1.35,
  冷链: 1.55
};

export const WEIGHT_BANDS: WeightBand[] = [
  { minWeight: 0, maxWeight: 50, basePrice: 0, perKgRate: 7 },
  { minWeight: 50.01, maxWeight: 500, basePrice: 120, perKgRate: 4.8 },
  { minWeight: 500.01, maxWeight: null, basePrice: 600, perKgRate: 3.6 }
];

export const BAND_TEXT = (band: WeightBand) =>
  band.maxWeight === null
    ? `${band.minWeight}kg 以上`
    : `${band.minWeight}-${band.maxWeight}kg`;

function buildRules(): RateRule[] {
  const routes: RateRule[] = [];
  for (const [route, factor] of Object.entries(ROUTE_FACTORS)) {
    for (const service of SERVICES) {
      const mult = SERVICE_MULTIPLIER[service] * factor;
      routes.push({
        route,
        service,
        bands: WEIGHT_BANDS.map((band) => ({
          ...band,
          basePrice: round2(band.basePrice * mult),
          perKgRate: round2(band.perKgRate * mult)
        }))
      });
    }
  }
  return routes;
}

function buildSurcharges(): SurchargeRule[] {
  return [
    { code: "FUEL", label: "燃油附加费", kind: "percent", value: 0.09 },
    { code: "COLD", label: "冷链温控附加", kind: "perKg", service: "冷链", value: 1.2 },
    { code: "EXP", label: "优先分拣费", kind: "flat", service: "次日达", value: 60 },
    { code: "DOOR", label: "上门服务费", kind: "flat", value: 30 }
  ];
}

function buildDiscounts() {
  return [
    { code: "AGREE", label: "协议客户折扣", customerType: "协议客户", rate: 0.03 },
    { code: "VIP", label: "大客户折扣", customerType: "大客户", rate: 0.08 }
  ];
}

/** 生成初始价表 V1 */
export function buildInitialVersion(nowIso: string): PriceVersion {
  return {
    id: "ver-1",
    versionNo: 1,
    publishedAt: nowIso,
    publishedBy: "系统初始化",
    note: "V1 初始价表：线路×服务×重量段基础运价，含燃油/冷链/次日达/上门附加费",
    rules: buildRules(),
    surcharges: buildSurcharges(),
    discounts: buildDiscounts(),
    active: true
  };
}

/** 按系数发布新版本：基础价、续重单价、固定/每公斤附加费整体缩放 */
export function scaleVersion(
  base: PriceVersion,
  versionNo: number,
  factor: number,
  publishedBy: string,
  note: string,
  nowIso: string
): PriceVersion {
  return {
    id: `ver-${versionNo}`,
    versionNo,
    publishedAt: nowIso,
    publishedBy,
    note,
    active: true,
    rules: base.rules.map((rule) => ({
      ...rule,
      bands: rule.bands.map((band) => ({
        ...band,
        basePrice: round2(band.basePrice * factor),
        perKgRate: round2(band.perKgRate * factor)
      }))
    })),
    surcharges: base.surcharges.map((s) =>
      s.kind === "percent" ? { ...s } : { ...s, value: round2(s.value * factor) }
    ),
    discounts: base.discounts.map((d) => ({ ...d }))
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 按线路、重量、服务匹配当前价表，列出基础价、附加费、折扣 */
export function calculate(
  version: PriceVersion,
  params: {
    route: string;
    service: ServiceType;
    weight: number;
    customerType: string;
  }
): PriceBreakdown | null {
  const { route, service, weight, customerType } = params;
  const rule = version.rules.find((r) => r.route === route && r.service === service);
  if (!rule) return null;
  const band = rule.bands.find(
    (b) => weight >= b.minWeight && (b.maxWeight === null || weight <= b.maxWeight)
  );
  if (!band) return null;

  const basePrice = round2(
    weight <= 50 ? band.perKgRate * weight : band.basePrice + band.perKgRate * weight
  );

  const surchargeLines: SurchargeLine[] = version.surcharges
    .filter((s) => !s.service || s.service === service)
    .map((s) => {
      let amount = 0;
      if (s.kind === "percent") amount = basePrice * s.value;
      else if (s.kind === "perKg") amount = s.value * weight;
      else amount = s.value;
      return { code: s.code, label: s.label, amount: round2(amount) };
    });

  const subtotal = round2(basePrice + surchargeLines.reduce((acc, l) => acc + l.amount, 0));

  const discountLines: DiscountLine[] = version.discounts
    .filter((d) => d.customerType === customerType)
    .map((d) => ({
      code: d.code,
      label: `${d.label} ${(d.rate * 100).toFixed(0)}%`,
      amount: round2(subtotal * d.rate)
    }));

  const total = round2(subtotal - discountLines.reduce((acc, l) => acc + l.amount, 0));

  return {
    versionId: version.id,
    versionNo: version.versionNo,
    route,
    service,
    weight,
    matchedRuleText: `${route} / ${service} / ${BAND_TEXT(band)}（基础价 ${band.basePrice}元 + 续重 ${band.perKgRate}元/kg）`,
    basePrice,
    surcharges: surchargeLines,
    discountLines,
    subtotal,
    total
  };
}

/* ---------- 人员与审批类别 ---------- */

export interface UserInfo {
  id: string;
  name: string;
  role: Role;
}

export const USERS: UserInfo[] = [
  { id: "u-sales", name: "业务员-林晓", role: "sales" },
  { id: "u-rm", name: "区经理-周明", role: "regional_manager" },
  { id: "u-sd", name: "销售总监-陈静", role: "sales_director" },
  { id: "u-gm", name: "总经理-郑海", role: "general_manager" }
];

export const ROLE_LABEL: Record<Role, string> = {
  sales: "业务员",
  regional_manager: "区经理",
  sales_director: "销售总监",
  general_manager: "总经理"
};

export const APPROVER_ROLES: Role[] = ["regional_manager", "sales_director", "general_manager"];

export const CATEGORY_APPROVER: Record<SpecialCategory, Role> = {
  "一类(≤5%)": "regional_manager",
  "二类(5%-10%)": "sales_director",
  "三类(>10%)": "general_manager"
};

export function categoryOf(rate: number): SpecialCategory {
  if (rate <= 0.05) return "一类(≤5%)";
  if (rate <= 0.1) return "二类(5%-10%)";
  return "三类(>10%)";
}

export const REQUEST_VALID_DAYS = 3;

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}¥${Math.abs(n).toFixed(2)}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

/** 特价减免额 = 小计 × 折扣率，不得超过小计（最终金额不为负），以页面输入为准 */
export function specialDiscountFromRate(subtotal: number, rate: number): number {
  return round2(Math.min(rate, 1) * subtotal);
}

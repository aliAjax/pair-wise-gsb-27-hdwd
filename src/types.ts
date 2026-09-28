// 领域类型：价表版本、报价、特价申请、审批留档

export type ServiceType = "标准达" | "次日达" | "冷链";
export type Role = "sales" | "approver";

export const SERVICES: readonly ServiceType[] = ["标准达", "次日达", "冷链"];
export const ROUTES = ["上海-南京", "杭州-合肥", "广州-长沙", "北京-济南"] as const;
export type Route = (typeof ROUTES)[number];

export type QuoteStatus = "待确认" | "待批" | "已确认";
export const QUOTE_STATUSES: readonly QuoteStatus[] = ["待确认", "待批", "已确认"];

/** 阶梯费率：重量落在 [weightFrom, weightTo) 区间，按 起步价 + 续重单价 * 重量 计 */
export interface RateRule {
  route: string;
  service: ServiceType;
  weightFrom: number;
  weightTo: number | null; // null 表示无上限
  base: number;
  perKg: number;
}

export interface SurchargeRule {
  id: string;
  name: string;
  services: ServiceType[]; // 适用服务，空数组表示全部
  /** 按重量计的单价（元/kg） */
  perKg?: number;
  /** 按基础价的百分比计（0.06 表示 6%） */
  percentOfBase?: number;
}

export interface DiscountRule {
  id: string;
  name: string;
  services: ServiceType[];
  /** 折扣率，0.95 表示 95 折 */
  rate: number;
}

export interface PriceVersion {
  id: string;
  version: number;
  note: string;
  createdAt: string;
  publishedBy: string;
  active: boolean;
  rateRules: RateRule[];
  surchargeRules: SurchargeRule[];
  discountRules: DiscountRule[];
}

/** 报价上留存的费用明细，每一笔金额都能解释来源 */
export interface FeeLine {
  kind: "base" | "surcharge" | "discount";
  label: string;
  amount: number; // 正数为加收，负数为折减
}

export interface PriceSnapshot {
  versionId: string;
  versionNumber: number;
  baseAmount: number;
  surchargeAmount: number;
  standardDiscount: number; // 价表常规折扣额（负数）
  specialDiscount: number; // 特价审批额外折扣额（负数）
  finalAmount: number;
  lines: FeeLine[];
  calculatedAt: string;
}

export type QuoteSource = "试算" | "特价批准";

export interface Quote {
  id: string;
  customer: string;
  route: string;
  service: ServiceType;
  weight: number;
  status: QuoteStatus;
  notes: string;
  /** 当前生效金额明细；客户确认后冻结，不再随价表换版而变 */
  price: PriceSnapshot;
  /** 特价批准后保留的批准痕迹 */
  specialAppId?: string;
  source: QuoteSource;
  createdAt: string;
  updatedAt: string;
}

export type SpecialStatus = "待审批" | "已批准" | "已驳回" | "已过期";

export interface SpecialApplication {
  id: string;
  quoteId: string;
  applicant: string;
  /** 申请时报价快照（线路/重量/服务/价表版本/当时金额） */
  quoteSnapshot: {
    customer: string;
    route: string;
    service: ServiceType;
    weight: number;
    versionId: string;
    versionNumber: number;
    standardAmount: number; // 申请时的常规价表金额
  };
  applyAmount: number; // 申请特价金额
  reason: string;
  status: SpecialStatus;
  createdAt: string;
  expiresAt: string; // 申请有效期截止
  decidedAt?: string;
  approver?: string;
  /** 实际批准金额，不得高于申请额 */
  approvedAmount?: number;
  decisionNote?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  category: "价表" | "报价" | "特价";
  action: string;
  detail: string;
  quoteId?: string;
  applicationId?: string;
  versionId?: string;
}

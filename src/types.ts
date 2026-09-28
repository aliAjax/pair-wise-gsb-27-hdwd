export type ServiceType = "标准达" | "次日达" | "冷链";

export type Role = "sales" | "regional_manager" | "sales_director" | "general_manager";

export interface WeightBand {
  minWeight: number; // kg，含
  maxWeight: number | null; // kg，含；null 表示无上限
  basePrice: number; // 该段基础价
  perKgRate: number; // 续重单价 元/kg
}

export interface RateRule {
  route: string;
  service: ServiceType;
  bands: WeightBand[];
}

export type SurchargeKind = "percent" | "perKg" | "flat";

export interface SurchargeRule {
  code: string;
  label: string;
  kind: SurchargeKind;
  service?: ServiceType; // 缺省 = 全部服务适用
  value: number; // percent: 比例；perKg: 元/kg；flat: 元/票
}

export interface DiscountRule {
  code: string;
  label: string;
  customerType: string;
  rate: number; // 折扣率，0.02 = 2%
}

export interface PriceVersion {
  id: string;
  versionNo: number;
  publishedAt: string;
  publishedBy: string;
  note: string;
  rules: RateRule[];
  surcharges: SurchargeRule[];
  discounts: DiscountRule[];
  active: boolean;
}

export interface SurchargeLine {
  code: string;
  label: string;
  amount: number;
}

export interface DiscountLine {
  code: string;
  label: string;
  amount: number;
}

/** 一次试算的完整结果快照 */
export interface PriceBreakdown {
  versionId: string;
  versionNo: number;
  route: string;
  service: ServiceType;
  weight: number;
  matchedRuleText: string;
  basePrice: number;
  surcharges: SurchargeLine[];
  discountLines: DiscountLine[];
  subtotal: number; // 基础价 + 附加费
  total: number; // 小计 - 常规折扣
}

/**
 * 待确认：常规报价，等待客户确认（可重算/申请特价）
 * 特价待批：已提交特价申请，原报价冻结等待审批
 * 特价待确认：特价已批准，业务员向客户确认（可锁定或放弃特价）
 * 已锁定：客户已确认，金额快照锁定，换版不影响
 */
export type QuoteStatus = "待确认" | "特价待批" | "特价待确认" | "已锁定";

export interface SpecialDiscount {
  amount: number; // 特价减免金额
  rate: number; // 占小计比例
  reason: string;
}

export interface LockedPrice {
  kind: "standard" | "special";
  breakdown: PriceBreakdown;
  specialDiscount?: SpecialDiscount;
  lockedAt: string;
  lockedBy: string;
}

export interface Quote {
  id: string;
  customer: string;
  customerType: string;
  route: string;
  service: ServiceType;
  weight: number;
  status: QuoteStatus;
  /** 当前报价所依据的价表版本；与生效版本不一致即表示已换版 */
  quotedVersionId: string;
  /** 客户确认后的锁定快照 */
  locked?: LockedPrice;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type SpecialCategory = "一类(≤5%)" | "二类(5%-10%)" | "三类(>10%)";
export type SpecialStatus = "待审批" | "已批准" | "已驳回" | "已作废" | "已重提";

export interface AuditTrailEntry {
  at: string;
  by: string;
  action: string;
  detail: string;
}

export interface SpecialRequest {
  id: string;
  requestNo: string;
  quoteId: string;
  category: SpecialCategory;
  /** 申请时刻的试算快照，审批只针对该快照，不受换版影响 */
  breakdownAtRequest: PriceBreakdown;
  requestedDiscount: SpecialDiscount;
  status: SpecialStatus;
  applicant: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  approver?: string;
  approvedDiscount?: SpecialDiscount;
  decisionNote?: string;
  supersededBy?: string;
  trail: AuditTrailEntry[];
}

export type AuditModule = "价表" | "报价" | "特价审批";

export interface AuditLogEntry {
  id: string;
  at: string;
  by: string;
  module: AuditModule;
  action: string;
  detail: string;
}

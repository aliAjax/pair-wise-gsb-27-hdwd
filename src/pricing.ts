import type {
  FeeLine,
  PriceSnapshot,
  PriceVersion,
  RateRule,
  ServiceType
} from "./types";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 金额格式化：1260 -> ¥1,260.00 */
export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}¥${abs.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** 找到线路 + 服务 + 重量命中的阶梯费率 */
export function matchRate(
  rules: RateRule[],
  route: string,
  service: ServiceType,
  weight: number
): RateRule {
  const hit = rules.find(
    (r) =>
      r.route === route &&
      r.service === service &&
      weight >= r.weightFrom &&
      (r.weightTo === null || weight < r.weightTo)
  );
  if (!hit) {
    throw new Error(`价表缺少适用费率：${route} / ${service} / ${weight}kg`);
  }
  return hit;
}

export interface CalcInput {
  version: PriceVersion;
  route: string;
  service: ServiceType;
  weight: number;
  /** 特价批准后的目标金额；传入时按差额计算额外特价折扣 */
  specialTarget?: number;
}

/**
 * 按当前价表试算，列明基础价、附加费、常规折扣、特价折扣。
 * 折扣以「(基础价 + 附加费)」为基数。
 */
export function calculate(input: CalcInput): PriceSnapshot {
  const { version, route, service, weight } = input;
  const rate = matchRate(version.rateRules, route, service, weight);
  const base = round2(rate.base + rate.perKg * weight);
  const lines: FeeLine[] = [
    {
      kind: "base",
      label: `基础运费（${rate.base} + ${rate.perKg}元/kg × ${weight}kg）`,
      amount: base
    }
  ];

  let surcharge = 0;
  for (const rule of version.surchargeRules) {
    if (rule.services.length > 0 && !rule.services.includes(service)) continue;
    let amount = 0;
    if (typeof rule.perKg === "number") {
      amount = round2(rule.perKg * weight);
      lines.push({ kind: "surcharge", label: `${rule.name}（${rule.perKg}元/kg）`, amount });
    } else if (typeof rule.percentOfBase === "number") {
      amount = round2(base * rule.percentOfBase);
      lines.push({
        kind: "surcharge",
        label: `${rule.name}（基础价 × ${(rule.percentOfBase * 100).toFixed(0)}%）`,
        amount
      });
    }
    surcharge += amount;
  }
  surcharge = round2(surcharge);

  const beforeDiscount = round2(base + surcharge);
  let standardDiscount = 0;
  const discountRule = version.discountRules.find(
    (d) => d.services.length === 0 || d.services.includes(service)
  );
  if (discountRule && discountRule.rate < 1) {
    standardDiscount = round2(beforeDiscount * (discountRule.rate - 1));
    lines.push({
      kind: "discount",
      label: `${discountRule.name}（${discountRule.rate * 10}折）`,
      amount: standardDiscount
    });
  }

  let finalAmount = round2(beforeDiscount + standardDiscount);
  let specialDiscount = 0;
  if (typeof input.specialTarget === "number") {
    // 特价折扣把金额压到批准额；目标不得高于常规价，不得低于 0
    const target = round2(Math.min(Math.max(input.specialTarget, 0), finalAmount));
    specialDiscount = round2(target - finalAmount);
    if (specialDiscount < 0) {
      lines.push({ kind: "discount", label: "特价审批折扣", amount: specialDiscount });
    }
    finalAmount = target;
  }

  return {
    versionId: version.id,
    versionNumber: version.version,
    baseAmount: base,
    surchargeAmount: surcharge,
    standardDiscount,
    specialDiscount,
    finalAmount,
    lines,
    calculatedAt: new Date().toISOString()
  };
}

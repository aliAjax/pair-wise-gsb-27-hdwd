// 逻辑冒烟测试：mock 浏览器环境，直接驱动 Pinia store
import { describe, it as test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setActivePinia, createPinia } from "pinia";
import { usePricingStore } from "./store";
import { USERS } from "./pricing";

const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toBeNull: () => assert.equal(actual, null),
  toBeGreaterThan: (expected: number) => assert.ok((actual as number) > expected),
  toBeGreaterThanOrEqual: (expected: number) => assert.ok((actual as number) >= expected),
  toContain: (s: string) => assert.ok(String(actual).includes(s)),
  toBeTruthy: () => assert.ok(actual),
  not: {
    toBeNull: () => assert.notEqual(actual, null)
  }
});

let mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => {
    mem[k] = v;
  },
  removeItem: (k: string) => delete mem[k],
  clear: () => {
    mem = {};
  }
};

function asUser(store: ReturnType<typeof usePricingStore>, role: string) {
  const u = USERS.find((x) => x.role === role)!;
  store.switchUser(u.id);
}

describe("报价与特价审批", () => {
  beforeEach(() => {
    mem = {};
    setActivePinia(createPinia());
  });

  test("种子数据：V2 生效，V1 归档；存在过期申请", () => {
    const store = usePricingStore();
    expect(store.activeVersion.versionNo).toBe(2);
    expect(store.archivedVersions[0].versionNo).toBe(1);
    // q-seed-6 的申请启动时应已被 sweep 作废
    const r6 = store.requests.find((r) => r.id === "r-seed-6")!;
    expect(r6.status).toBe("已作废");
    const q6 = store.quotes.find((q) => q.id === "q-seed-6")!;
    expect(q6.status).toBe("待确认");
  });

  test("新建报价按当前价表试算，列明基础价/附加费/折扣", () => {
    const store = usePricingStore();
    asUser(store, "sales");
    const err = store.createQuote({
      customer: "测试客户",
      customerType: "大客户",
      route: "上海-南京",
      service: "冷链",
      weight: 100,
      notes: ""
    });
    expect(err).toBeNull();
    const q = store.quotes[0];
    const bd = store.liveBreakdown(q);
    assert.ok(bd);
    expect(bd!.surcharges.length).toBeGreaterThanOrEqual(2); // 燃油+冷链+上门
    expect(bd!.discountLines.length).toBe(1); // 大客户 8%
    expect(bd!.total).toBeGreaterThan(0);
    expect(q.quotedVersionId).toBe(store.activeVersion.id);
  });

  test("客户确认后金额锁定；之后换版不影响锁定单", () => {
    const store = usePricingStore();
    asUser(store, "sales");
    store.createQuote({
      customer: "锁定测试",
      customerType: "普通客户",
      route: "杭州-合肥",
      service: "标准达",
      weight: 200,
      notes: ""
    });
    const q = store.quotes[0];
    const before = store.liveBreakdown(q)!.total;
    expect(store.lockQuote(q.id)).toBeNull();
    expect(q.status).toBe("已锁定");
    expect(q.locked!.breakdown.total).toBe(before);

    // 发布 V3 上调 10%
    asUser(store, "general_manager");
    expect(store.publishVersion(1.1, "测试换版")).toBeNull();
    expect(store.activeVersion.versionNo).toBe(3);
    expect(q.locked!.breakdown.versionNo).toBe(2);
    // 锁定单不能重算
    expect(store.recalcQuote(q.id)).toBe(false);
  });

  test("换版只影响未确认报价：显示落后并可重算", () => {
    const store = usePricingStore();
    const q1 = store.quotes.find((q) => q.id === "q-seed-1")!;
    expect(store.isStale(q1)).toBe(true); // V1 报价，V2 当前
    const oldBdTotal =
      store.findVersion(q1.quotedVersionId) &&
      store.liveBreakdown({ ...q1, quotedVersionId: store.activeVersion.id } as any)!.total;
    expect(store.recalcQuote(q1.id)).toBe(true);
    expect(q1.quotedVersionId).toBe(store.activeVersion.id);
    expect(store.isStale(q1)).toBe(false);
    assert.ok(oldBdTotal);
  });

  test("特价申请：原报价进入待批；同类只能由对应审批人处理；批准额不得超过申请额", () => {
    const store = usePricingStore();
    asUser(store, "sales");
    const q = store.quotes.find((x) => x.id === "q-seed-2")!; // 待确认，普通客户冷链95kg
    const err = store.requestSpecial(q.id, 0.06, "客户月均发货多"); // 二类
    expect(err).toBeNull();
    expect(q.status).toBe("特价待批");
    const req = store.requests[0];
    expect(req.category).toBe("二类(5%-10%)");

    // 区经理不能处理二类
    asUser(store, "regional_manager");
    const blocked = store.approveRequest(req.id, 0.06, "");
    expect(blocked).toContain("仅由");
    // 业务员不能审批
    asUser(store, "sales");
    expect(store.approveRequest(req.id, 0.06, "")).toBeTruthy();

    // 销售总监：批准 7% 应被拒（超过申请 6%）
    asUser(store, "sales_director");
    expect(store.approveRequest(req.id, 0.07, "")).toContain("不得高于");
    // 批准 5%（降额改批）
    expect(store.approveRequest(req.id, 0.05, "同意5%")).toBeNull();
    expect(req.status).toBe("已批准");
    expect(req.approvedDiscount!.rate).toBe(0.05);
    expect(q.status).toBe("特价待确认");

    // 客户确认后按特价锁定
    asUser(store, "sales");
    expect(store.lockQuote(q.id)).toBeNull();
    expect(q.status).toBe("已锁定");
    expect(q.locked!.kind).toBe("special");
    expect(q.locked!.specialDiscount!.rate).toBe(0.05);
  });

  test("驳回后原报价恢复常规报价", () => {
    const store = usePricingStore();
    asUser(store, "sales");
    const q = store.quotes.find((x) => x.id === "q-seed-2")!;
    store.requestSpecial(q.id, 0.03, "理由充分");
    const req = store.requests[0];
    asUser(store, "regional_manager");
    expect(store.rejectRequest(req.id, "幅度不同意")).toBeNull();
    expect(req.status).toBe("已驳回");
    expect(q.status).toBe("待确认");
  });

  test("申请到期作废，重算后重提，旧申请标记已重提", () => {
    const store = usePricingStore();
    asUser(store, "sales");
    const q = store.quotes.find((x) => x.id === "q-seed-2")!;
    store.requestSpecial(q.id, 0.04, "测试到期");
    const req = store.requests[0];
    // 快进 4 天
    store.setClockOffset(4);
    expect(req.status).toBe("已作废");
    expect(q.status).toBe("待确认");
    // 重新提交
    const err = store.resubmit(req.id, 0.04, "重算后理由");
    expect(err).toBeNull();
    expect(req.status).toBe("已重提");
    const nr = store.requests[0];
    expect(nr.status).toBe("待审批");
    expect(nr.breakdownAtRequest.versionNo).toBe(store.activeVersion.versionNo);
  });

  test("价表版本与审批经过留档", () => {
    const store = usePricingStore();
    const r4 = store.requests.find((r) => r.id === "r-seed-4")!;
    expect(r4.trail.length).toBeGreaterThanOrEqual(2);
    expect(store.versions.length).toBe(2);
    asUser(store, "general_manager");
    store.publishVersion(0.95, "淡季下调");
    expect(store.versions.length).toBe(3);
    expect(store.versions[store.versions.length - 1].active).toBe(false);
    expect(store.logs.filter((l) => l.module === "价表").length).toBeGreaterThanOrEqual(3);
  });

  test("业务员不能发布价表", () => {
    const store = usePricingStore();
    asUser(store, "sales");
    expect(store.publishVersion(1.1, "测试")).toContain("审批人");
  });
});

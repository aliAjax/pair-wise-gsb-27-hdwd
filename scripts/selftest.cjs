// 业务规则自测：用 esbuild 把 TS 转成 CJS 后在 Node 中跑（不依赖浏览器/DOM）
const { build } = require("esbuild");
const Module = require("module");
const fs = require("fs");
const path = require("path");

// --- 最小 DOM/localStorage/pinia 垫片 ---
const localStorageStore = {};
globalThis.localStorage = {
  getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; }
};
globalThis.crypto = require("crypto").webcrypto;
globalThis.window = { alert: (m) => { throw new Error("意外弹窗: " + m); }, confirm: () => true };
globalThis.setInterval = () => 0;

const piniaSrc = `
import { ref, computed } from "vue";
const map = new Map();
export function setActivePinia(p) { Object.assign(map, p); }
export function defineStore(id, setup) {
  return function useStore() {
    if (!map.has(id)) map.set(id, setup());
    return map.get(id);
  };
}
export { ref, computed };
`;

async function compile(entry, alias) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    treeShaking: false,
    external: [],
    plugins: alias
      ? [
          {
            name: "alias",
            setup(b) {
              b.onResolve({ filter: /^pinia$/ }, () => ({ path: "pinia.js", namespace: "pinia-ns" }));
              b.onLoad({ filter: /.*/, namespace: "pinia-ns" }, () => ({
                contents: piniaSrc,
                resolveDir: process.cwd(),
                loader: "js"
              }));
            }
          }
        ]
      : []
  });
  const code = result.outputFiles[0].text;
  const m = new Module(entry, module);
  m.filename = entry;
  m.paths = Module._nodeModulePaths(path.dirname(entry));
  m._compile(code, entry);
  return m.exports;
}

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("  ✓", name); }
  else { failed++; console.log("  ✗", name, extra ?? ""); }
}
function throws(fn, snippet) {
  try { fn(); } catch (e) {
    const ok = (e.message || "").includes(snippet);
    check(`拒绝：${snippet}`, ok, e.message);
    return;
  }
  check(`拒绝：${snippet}`, false, "未抛错");
}

(async () => {
  // 1) 计价引擎
  console.log("计价引擎");
  const pricing = await compile(path.resolve("src/pricing.ts"), false);
  const seedMod = await compile(path.resolve("src/seed.ts"), false);
  const seed = seedMod.buildSeed();
  const v1 = seed.versions.find((v) => v.version === 1);
  const v2 = seed.versions.find((v) => v.version === 2);
  const pB = pricing.calculate({ version: v1, route: "上海-南京", service: "冷链", weight: 180 });
  const pB2 = pricing.calculate({ version: v2, route: "上海-南京", service: "冷链", weight: 180 });
  check("明细含基础运费行", pB.lines.some((l) => l.kind === "base"));
  check("明细含附加费行", pB.lines.filter((l) => l.kind === "surcharge").length === 2);
  check("明细含折扣行", pB.lines.some((l) => l.kind === "discount"));
  const sum = pricing.round2(pB.baseAmount + pB.surchargeAmount + pB.standardDiscount);
  check("基础+附加+折扣=合计", sum === pB.finalAmount, `${sum} vs ${pB.finalAmount}`);
  check("v2 冷链更贵（燃油+操作费上调）", pB2.finalAmount > pB.finalAmount, `${pB.finalAmount} -> ${pB2.finalAmount}`);
  throws(() => pricing.calculate({ version: v1, route: "不存在", service: "冷链", weight: 10 }), "缺少适用费率");
  const special = pricing.calculate({ version: v2, route: "广州-长沙", service: "次日达", weight: 320, specialTarget: 1600 });
  check("特价目标生效", special.finalAmount === 1600);
  check("超额特价目标被夹到常规价", pricing.calculate({ version: v2, route: "广州-长沙", service: "次日达", weight: 320, specialTarget: 9999 }).finalAmount === pricing.calculate({ version: v2, route: "广州-长沙", service: "次日达", weight: 320 }).finalAmount);

  // 2) Store 业务规则
  console.log("Store 业务规则");
  const entry = path.resolve("scripts/.test-entry.ts");
  fs.writeFileSync(
    entry,
    'export { useFreightStore, SPECIAL_TTL_MS } from "../src/store";\nexport { setActivePinia } from "pinia";\n'
  );
  const storeMod = await compile(entry, true);
  fs.unlinkSync(entry);
  storeMod.setActivePinia(new Map());
  const storeRaw = storeMod.useFreightStore();
  const unwrap = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const store = new Proxy(storeRaw, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') return v.bind(t);
      return unwrap(v);
    },
    set(t, k, val) { t[k] = val; return true; }
  });

  check("初始 v2 为当前版本", store.activeVersion.version === 2);
  const quoteA = store.quotes.find((q) => q.id === "q-seed-a");
  const quoteB = store.quotes.find((q) => q.id === "q-seed-b");
  const quoteC = store.quotes.find((q) => q.id === "q-seed-c");
  const quoteD = store.quotes.find((q) => q.id === "q-seed-d");

  check("A 已确认不算旧", store.isStale(quoteA) === false);
  check("B v1 未确认判为旧金额", store.isStale(quoteB) === true);
  check("C v2 待批不算旧", store.isStale(quoteC) === false);
  check("D v2 重算后不算旧", store.isStale(quoteD) === false);
  const curB = store.currentPriceOf(quoteB);
  check("旧金额对比金额取 v2", curB && curB.versionNumber === 2);

  // 默认身份是业务员
  check("当前为业务员", store.role === "sales");
  throws(() => store.publishVersion(store.draftFromActive()), "仅限审批人");
  throws(() => store.decideSpecial({ applicationId: "sp-seed-c", approve: true, approvedAmount: 1600 }), "仅限审批人");

  // 已确认锁价：不可重算、不可特价
  throws(() => store.recalc("q-seed-a"), "已锁定");
  throws(() => store.submitSpecial({ quoteId: "q-seed-a", applyAmount: 1, reason: "x" }), "已客户确认锁定");

  // 旧金额报价：必须先重算才能确认/申请特价
  throws(() => store.confirmQuote("q-seed-b"), "先按当前价表重算");
  throws(() => store.submitSpecial({ quoteId: "q-seed-b", applyAmount: 1, reason: "x" }), "先「按当前价表重算」");

  const oldB = quoteB.price.finalAmount;
  store.recalc("q-seed-b");
  check("B 重算后版本变 v2", quoteB.price.versionNumber === 2);
  check("B 重算后金额变化", quoteB.price.finalAmount !== oldB);
  check("B 重算后不再旧", store.isStale(quoteB) === false);

  // 待批报价：业务员不能确认/删除/再申请
  throws(() => store.confirmQuote("q-seed-c"), "审批中");
  throws(() => store.submitSpecial({ quoteId: "q-seed-c", applyAmount: 100, reason: "x" }), "审批中");
  throws(() => store.removeQuote("q-seed-c"), "审批中");
  throws(() => store.recalc("q-seed-c"), "审批中");

  // 正常特价申请
  const stdD = quoteD.price.finalAmount;
  store.submitSpecial({ quoteId: "q-seed-d", applyAmount: stdD - 20, reason: "测试理由" });
  check("D 提交后进入待批", quoteD.status === "待批");
  const appD2 = store.applications.find((a) => a.quoteId === "q-seed-d" && a.status === "待审批");
  check("新申请 48h 有效", Math.abs(new Date(appD2.expiresAt).getTime() - new Date(appD2.createdAt).getTime() - storeMod.SPECIAL_TTL_MS) < 1000);
  throws(() => store.submitSpecial({ quoteId: "q-seed-d", applyAmount: stdD - 30, reason: "再次" }), "审批中");
  throws(() => store.submitSpecial({ quoteId: "q-seed-d", applyAmount: stdD + 1, reason: "高于常规" }), "审批中");

  // 切审批人
  store.switchRole("approver");
  check("当前为审批人", store.role === "approver");
  throws(() => store.createQuote({ customer: "x", route: "上海-南京", service: "标准达", weight: 10, notes: "" }), "仅限业务员");

  // 批准额不得超过申请额
  throws(() => store.decideSpecial({ applicationId: appD2.id, approve: true, approvedAmount: stdD }), "超过申请额");
  const target = stdD - 20;
  store.decideSpecial({ applicationId: appD2.id, approve: true, approvedAmount: target, decisionNote: "同意" });
  check("批准后报价回待确认", quoteD.status === "待确认");
  check("批准额写入应收", quoteD.price.finalAmount === target);
  check("批准来源标记", quoteD.source === "特价批准");
  check("关联申请留痕", quoteD.specialAppId === appD2.id);
  check("明细含特价折扣行", quoteD.price.lines.some((l) => l.label === "特价审批折扣"));
  check("重复审批被拒", (() => { try { store.decideSpecial({ applicationId: appD2.id, approve: false }); return false; } catch { return true; } })());

  // 客户确认锁价（D 走完 特价批准 -> 客户确认）
  store.switchRole("sales");
  const approvedAmountD = quoteD.price.finalAmount;
  store.confirmQuote("q-seed-d");
  check("D 确认后锁定", quoteD.status === "已确认");
  check("锁价后不判旧", store.isStale(quoteD) === false);
  check("锁价后当前价对比返回 null", store.currentPriceOf(quoteD) === null);

  // 驳回流程：C 驳回后回到待确认
  store.switchRole("approver");
  store.decideSpecial({ applicationId: "sp-seed-c", approve: false, decisionNote: "额度不足" });
  check("C 驳回后待确认", quoteC.status === "待确认");
  check("C 驳回后可重新申请（无在途）", !store.activeApplicationOf("q-seed-c"));

  // 另一笔 E：特价已批准、但客户尚未确认就遇换版
  store.switchRole("sales");
  const quoteE = store.createQuote({ customer: "测试客户E", route: "北京-济南", service: "标准达", weight: 70, notes: "" });
  store.submitSpecial({ quoteId: quoteE.id, applyAmount: quoteE.price.finalAmount - 15, reason: "先批准暂不确认" });
  const appE = store.activeApplicationOf(quoteE.id);
  store.switchRole("approver");
  store.decideSpecial({ applicationId: appE.id, approve: true });
  check("E 批准后回待确认", quoteE.status === "待确认" && quoteE.source === "特价批准");
  const approvedE = quoteE.price.finalAmount;

  // 过期作废：C 再提一笔，手工改为已过期
  store.switchRole("sales");
  store.submitSpecial({ quoteId: "q-seed-c", applyAmount: 1600, reason: "过期测试" });
  const appExp = store.activeApplicationOf("q-seed-c");
  appExp.expiresAt = new Date(Date.now() - 1000).toISOString();
  const swept = store.sweepExpired();
  check("过期申请被扫描出来", swept.includes(appExp.id));
  check("过期申请状态", appExp.status === "已过期");
  check("过期后报价退回待确认", quoteC.status === "待确认");

  // 换版：已确认（含特价批准后确认的）不受影响；未确认（含批准未确认）标记旧
  store.switchRole("approver");
  const lockedA = quoteA.price.finalAmount;
  const draft = store.draftFromActive();
  draft.note = "测试 v3";
  store.publishVersion(draft);
  check("发布后版本号为 3", store.activeVersion.version === 3);
  check("A 常规锁价金额不变", quoteA.price.finalAmount === lockedA);
  check("D 特价锁价金额不变（批准额）", quoteD.price.finalAmount === approvedAmountD);
  check("E 批准但未确认 -> 判为旧金额", store.isStale(quoteE));
  store.switchRole("sales");
  throws(() => store.confirmQuote(quoteE.id), "先按当前价表重算");
  store.recalc(quoteE.id);
  check("E 重算后回到 v3 常规价（不再是特价）", quoteE.price.versionNumber === 3 && quoteE.price.finalAmount !== approvedE && quoteE.source === "试算");
  check("E 旧批准记录仍留档", store.applications.some((a) => a.id === appE.id && a.status === "已批准"));
  check("E 重算后可按新常规价再申请特价", (() => {
    store.submitSpecial({ quoteId: quoteE.id, applyAmount: quoteE.price.finalAmount - 5, reason: "再次申请" });
    return quoteE.status === "待批" && store.activeApplicationOf(quoteE.id).quoteSnapshot.versionNumber === 3;
  })());
  check("未确认的 B 变旧（v2->v3）", store.isStale(quoteB));
  check("未确认的 C 变旧（v2->v3）", store.isStale(quoteC));
  check("旧版本仍归档可查", store.versions.some((v) => v.version === 1 && !v.active));

  // 审计留档
  check("留档有价表发布事件", store.events.some((e) => e.category === "价表" && e.detail.includes("v3")));
  check("留档有特价批准事件", store.events.some((e) => e.action === "批准特价申请"));
  check("留档有过期作废事件", store.events.some((e) => e.action === "申请过期作废"));
  check("留档有锁价事件", store.events.some((e) => e.action === "客户确认锁价"));
  check("删除报价不删审批留档", (() => {
    const nBefore = store.events.filter((e) => e.applicationId).length;
    store.switchRole("sales");
    store.removeQuote("q-seed-b");
    const nAfter = store.events.filter((e) => e.applicationId).length;
    return nBefore === nAfter && !store.quotes.find((q) => q.id === "q-seed-b");
  })());

  // 新报价永远走当前价表
  const q = store.createQuote({ customer: "新客户", route: "北京-济南", service: "标准达", weight: 40, notes: "" });
  check("新建报价按 v3 计价", q.price.versionNumber === 3);

  console.log(`\n${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

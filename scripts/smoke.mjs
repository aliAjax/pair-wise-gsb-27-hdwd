// 逻辑冒烟测试运行器：esbuild 打包后用 node:test 执行（无需浏览器）
import { build } from "esbuild";
import { webcrypto } from "node:crypto";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.crypto ??= webcrypto;

const outfile = join(tmpdir(), `pricing-smoke-${Date.now()}.mjs`);

await build({
  entryPoints: ["src/store.smoke.test.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
  alias: {
    // 测试无需真实消息组件
    "element-plus": new URL("./element-plus-stub.mjs", import.meta.url).pathname
  }
});

await import(pathToFileURL(outfile).href);

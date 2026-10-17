#!/usr/bin/env node
// DOM 桩端到端测试：用 vm 运行 index.html 主脚本，stub 掉 document/fetch 等浏览器 API。
// 场景 1：正常启动与城市切换；场景 2：某城数据文件缺失时显示采集中空态。
// 用法: node tools/dom-test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(path.join(root, "index.html"), "utf8");

const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const main = blocks.find(s => s.includes("const CATS"));
if (!main) { console.error("FAIL: main script block not found"); process.exit(1); }

let seq = 0;
function makeEl(id) {
  const el = {
    id, textContent: "", className: "", title: "",
    style: { setProperty() {}, display: "" },
    children: [], _html: "", _onclick: null,
    appendChild(c) { this.children.push(c); this._html += c.outerHTML; }
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html; },
    set(v) { this._html = String(v); this.children.length = 0; }
  });
  Object.defineProperty(el, "outerHTML", { get() { return this._html; } });
  Object.defineProperty(el, "onclick", {
    set(f) { this._onclick = f; },
    get() { return this._onclick; }
  });
  return el;
}

function runPage(fetchImpl) {
  const elements = {};
  const documentStub = {
    title: "",
    getElementById(id) { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; },
    createElement(tag) { return makeEl(tag + "#" + (++seq)); }
  };
  const store = {};
  const sandbox = {
    document: documentStub,
    window: { addEventListener() {}, scrollY: 0, scrollTo() {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    },
    location: { search: "" },
    history: { replaceState() {} },
    fetch: fetchImpl,
    URLSearchParams, console, setTimeout, clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(main, sandbox);
  return { sandbox, elements, documentStub, store };
}

const diskFetch = async (url) => {
  const p = String(url).split("?")[0];
  try {
    const text = readFileSync(path.join(root, p), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, status: 404, json: async () => { throw new Error("404"); } };
  }
};

const tick = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) console.log("PASS  " + name);
  else { failed++; console.log("FAIL  " + name + (extra !== undefined ? "  | " + extra : "")); }
};

// ---------- 场景 1：正常启动与城市切换 ----------
{
  const { sandbox, elements, documentStub, store } = runPage(diskFetch);
  await tick();
  const list = elements["list"];
  const nav = elements["cities"];
  check("启动: 渲染出 2 个城市按钮", nav && nav.children.length === 2, nav ? nav.children.length : "nav missing");
  check("启动: 默认城市为广州", elements["cityTitle"].textContent === "广州热门活动日报", elements["cityTitle"].textContent);
  check("启动: document.title 同步", documentStub.title === "广州热门活动日报", documentStub.title);
  check("启动: 列表含广州数据", /广东省博物馆/.test(list.innerHTML));
  check("启动: 列表不含深圳数据", !/世界之窗/.test(list.innerHTML));
  check("启动: 统计区已渲染", /本期共/.test(elements["stats"].innerHTML), elements["stats"].innerHTML);
  check("启动: 更新日期取数据 updated", elements["updateDate"].textContent.indexOf("数据更新于 20") === 0, elements["updateDate"].textContent);
  check("启动: 必去区已渲染", elements["picks"].innerHTML.indexOf("本周必去") >= 0);

  const szBtn = nav.children[1];
  check("切换: 第二个按钮是深圳", szBtn.textContent === "深圳", szBtn.textContent);
  await szBtn._onclick();
  await tick();
  check("切换: 标题变为深圳", elements["cityTitle"].textContent === "深圳热门活动日报", elements["cityTitle"].textContent);
  check("切换: 列表含深圳数据", /世界之窗/.test(list.innerHTML));
  check("切换: 列表不含广州数据", !/广东省博物馆/.test(list.innerHTML));
  check("切换: document.title 同步", documentStub.title === "深圳热门活动日报", documentStub.title);
  check("切换: 记忆当前城市", store["events-city"] === "sz", JSON.stringify(store));
  check("切换: 更新日期切到深圳数据", elements["updateDate"].textContent.indexOf("数据更新于 20") === 0);

  const gzBtn = nav.children[0];
  await gzBtn._onclick();
  await tick();
  check("回切: 广州数据恢复", /广东省博物馆/.test(list.innerHTML));
  check("回切: 标题恢复广州", elements["cityTitle"].textContent === "广州热门活动日报");
}

// ---------- 场景 2：深圳数据文件缺失 ----------
{
  const fetch404sz = async (url) => {
    if (String(url).indexOf("events-sz.json") >= 0) {
      return { ok: false, status: 404, json: async () => { throw new Error("404"); } };
    }
    return diskFetch(url);
  };
  const { elements } = runPage(fetch404sz);
  await tick();
  const list = elements["list"];
  check("缺数据: 广州仍正常渲染", /广东省博物馆/.test(list.innerHTML));
  const szBtn = elements["cities"].children[1];
  await szBtn._onclick();
  await tick();
  check("缺数据: 深圳显示采集中空态", /采集中/.test(list.innerHTML), list.innerHTML.slice(0, 60));
  check("缺数据: 深圳标题仍切换", elements["cityTitle"].textContent === "深圳热门活动日报");
}

console.log(failed ? "RESULT: FAIL (" + failed + ")" : "RESULT: PASS");
process.exit(failed ? 1 : 0);

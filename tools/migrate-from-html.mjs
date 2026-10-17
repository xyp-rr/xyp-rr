#!/usr/bin/env node
// 一次性迁移（2026-10-17）：把 index.html 内联的 EVENTS / SZ_EVENTS 抽取为
// data/events-<key>.json，并生成 data/cities.json 城市注册表；同时把页面改成
// 从 data/ 懒加载的多城结构。重复执行无副作用（备份只建一次）。
// 用法: node tools/migrate-from-html.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "index.html");
let html = readFileSync(htmlPath, "utf8");

// 1) 备份原文件（仅一次）
const stamp = new Date().toISOString().slice(0, 10);
const backup = path.join(root, "index.backup-" + stamp + ".html");
if (!existsSync(backup)) {
  copyFileSync(htmlPath, backup);
  console.log("backup ->", path.basename(backup));
} else {
  console.log("backup exists, skip:", path.basename(backup));
}

// 2) 抽取两个内联数组
function extractArray(name) {
  const start = html.indexOf("const " + name + " = [");
  if (start < 0) throw new Error(name + " declaration not found");
  const from = html.indexOf("[", start);
  const end = html.indexOf("\n];", from);
  if (end < 0) throw new Error(name + " terminator not found");
  const text = html.slice(from, end + 3); // 含结尾的 ];
  const arr = eval(text);
  if (!Array.isArray(arr)) throw new Error(name + " is not an array");
  return { arr, start, end: end + 3 };
}
const gz = extractArray("EVENTS");
const sz = extractArray("SZ_EVENTS");
console.log("extracted EVENTS =", gz.arr.length, ", SZ_EVENTS =", sz.arr.length);

// 3) 写数据文件
mkdirSync(path.join(root, "data"), { recursive: true });
const d = new Date();
const p = n => (n < 10 ? "0" + n : "" + n);
const updated = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
writeFileSync(path.join(root, "data", "events-gz.json"),
  JSON.stringify({ updated, items: gz.arr }, null, 2) + "\n");
writeFileSync(path.join(root, "data", "events-sz.json"),
  JSON.stringify({ updated, items: sz.arr }, null, 2) + "\n");
writeFileSync(path.join(root, "data", "cities.json"),
  JSON.stringify([
    { key: "gz", name: "广州", en: "GUANGZHOU" },
    { key: "sz", name: "深圳", en: "SHENZHEN" }
  ], null, 2) + "\n");
console.log("data/ written, updated =", updated);

// 4) 页面手术：删除内联数据区，替换为数据加载器
const loader = `/* ===== 多城数据加载 =====
   城市注册表 data/cities.json : [{"key":"gz","name":"广州","en":"GUANGZHOU"}, ...]
   活动数据   data/events-<key>.json : {"updated":"YYYY-MM-DD","items":[{...}, ...]}
   新增城市只需在 cities.json 追加一行，无需改本文件；数据文件就绪前显示采集中。 */
const DATA_BASE = "data";
const cityIndex = [];
const dataCache = {};
const updatedCache = {};
let current = "all";
let currentCity = null;

function curCity(){
  return cityIndex.find(x => x.key === currentCity) || cityIndex[0] || null;
}
function curEvents(){
  return dataCache[currentCity] || [];
}
function pending(){
  return dataCache[currentCity] === null || dataCache[currentCity] === undefined;
}

async function boot(){
  const box = document.getElementById("list");
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await fetch(DATA_BASE + "/cities.json", {cache: "no-store"});
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if(Array.isArray(j)) cityIndex.push.apply(cityIndex, j);
  } catch(e) {
    box.innerHTML = '<div class="empty">城市列表加载失败，请刷新重试</div>';
    return;
  }
  if(cityIndex.length === 0){
    box.innerHTML = '<div class="empty">尚未配置任何城市</div>';
    return;
  }
  let key = "";
  try {
    const q = new URLSearchParams(location.search).get("city");
    if(q && cityIndex.some(c => c.key === q)) key = q;
  } catch(e) {}
  if(!key){
    try {
      const saved = localStorage.getItem("events-city");
      if(saved && cityIndex.some(c => c.key === saved)) key = saved;
    } catch(e) {}
  }
  if(!key) key = cityIndex[0].key;
  currentCity = key;
  renderCities();
  renderFilters();
  await loadCity(key);
}

async function loadCity(key){
  if(!(key in dataCache)){
    try {
      const r = await fetch(DATA_BASE + "/events-" + key + ".json", {cache: "no-store"});
      if(!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      dataCache[key] = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []);
      updatedCache[key] = (j && j.updated) || "";
    } catch(e) {
      dataCache[key] = null;
    }
  }
  renderHero();
  renderPicks();
  renderList();
}
`;

const regionStart = html.indexOf("/* ===== 每日活动数据");
const citiesIdx = html.indexOf("const CITIES = [");
if (regionStart < 0 || citiesIdx < 0) throw new Error("data region markers not found");
const regionEnd = html.indexOf("];", citiesIdx) + 3;
html = html.slice(0, regionStart) + loader + html.slice(regionEnd);

// 5) 初始化调用改为 boot()
const initOld = "renderCities();\nrenderHero();\nrenderPicks();\nrenderFilters();\nrenderList();";
if (!html.includes(initOld)) throw new Error("init block not found");
html = html.replace(initOld, "boot();");

// 6) 标题与 meta 改为多城口径
const subs = [
  ["<title>广州热门活动日报</title>", "<title>多城热门活动日报</title>"],
  ['<meta name="description" content="广州近期热门活动、展览市集、户外赏花、花期预警与夜游推荐，每日自动更新。">',
   '<meta name="description" content="多城热门活动日报：展览市集、户外赏花、提前预告、花期预警与夜游推荐，每日 08:00 自动更新。">'],
  ['<meta property="og:title" content="广州热门活动日报">',
   '<meta property="og:title" content="多城热门活动日报">']
];
for (const [from, to] of subs) {
  if (!html.includes(from)) throw new Error("meta not found: " + from.slice(0, 40));
  html = html.replace(from, to);
}

writeFileSync(htmlPath, html);
console.log("index.html refactored, size =", html.length);

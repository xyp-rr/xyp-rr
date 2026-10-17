#!/usr/bin/env node
// 校验 data/ 下全部城市活动数据。error 必须修复；warn 仅提示不阻断。
// 用法: node tools/validate.mjs   （部署前由 deploy.sh 自动调用）
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const CAT_ORDER = ["exhibition", "market", "outdoor", "preview", "bloom", "night"];
const FIELDS = ["cat", "title", "date", "end", "venue", "area", "price", "desc", "top", "alert"];

let errors = 0, warns = 0;
const err = m => { errors++; console.log("ERROR  " + m); };
const warn = m => { warns++; console.log("WARN   " + m); };
const info = m => console.log("INFO   " + m);

const d0 = new Date();
const todayStr = d0.getFullYear() + "-" + String(d0.getMonth() + 1).padStart(2, "0") + "-" + String(d0.getDate()).padStart(2, "0");
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00").getTime());

// ---- 城市注册表 ----
const regPath = path.join(dataDir, "cities.json");
if (!existsSync(regPath)) {
  err("cities.json 不存在: " + regPath);
  process.exit(1);
}
let cities;
try {
  cities = JSON.parse(readFileSync(regPath, "utf8"));
} catch (e) {
  err("cities.json 不是合法 JSON: " + e.message);
  process.exit(1);
}
if (!Array.isArray(cities) || cities.length === 0) {
  err("cities.json 必须是非空数组");
  process.exit(1);
}
const keys = new Set();
for (const c of cities) {
  if (!c || typeof c.key !== "string" || !/^[a-z0-9_-]+$/.test(c.key)) {
    err("城市 key 非法（须为小写字母/数字/下划线/连字符）: " + JSON.stringify(c));
    continue;
  }
  if (keys.has(c.key)) err("城市 key 重复: " + c.key);
  keys.add(c.key);
  if (!c.name || !c.en) warn("城市缺少 name/en: " + c.key);
  const f = path.join(dataDir, "events-" + c.key + ".json");
  if (!existsSync(f)) err("缺少数据文件: data/events-" + c.key + ".json（城市 " + c.name + "）");
}

// ---- 孤儿数据文件 ----
for (const f of readdirSync(dataDir)) {
  const m = f.match(/^events-(.+)\.json$/);
  if (m && !keys.has(m[1])) warn("孤儿数据文件（未注册到 cities.json，不会部署展示）: " + f);
}

// ---- 逐城校验 ----
for (const c of cities) {
  const f = path.join(dataDir, "events-" + c.key + ".json");
  if (!existsSync(f)) continue;
  let doc;
  try {
    doc = JSON.parse(readFileSync(f, "utf8"));
  } catch (e) {
    err("[" + c.key + "] 不是合法 JSON: " + e.message);
    continue;
  }
  const items = Array.isArray(doc) ? doc : doc.items;
  if (!Array.isArray(items)) { err("[" + c.key + "] 缺少 items 数组"); continue; }
  if (!doc.updated) warn("[" + c.key + "] 缺少 updated 日期，页面将回退显示当天日期");
  else if (!validDate(doc.updated)) err("[" + c.key + "] updated 格式应为 YYYY-MM-DD: " + doc.updated);

  const titles = new Set();
  const catItems = {};
  const seenCats = [];
  let tops = 0;

  items.forEach((it, i) => {
    const at = "[" + c.key + " #" + (i + 1) + (it.title ? " " + it.title.slice(0, 18) : "") + "] ";
    if (Object.keys(it).join(",") !== FIELDS.join(",")) {
      err(at + "字段顺序不符，应为 " + FIELDS.join(","));
    }
    if (!CAT_ORDER.includes(it.cat)) err(at + "cat 非法: " + it.cat);
    if (!it.title || !it.date) err(at + "title/date 不能为空");
    if (typeof it.top !== "boolean") err(at + "top 必须为布尔值");
    else if (it.top) tops++;
    if (typeof it.alert !== "string") err(at + "alert 必须为字符串");
    for (const k of ["venue", "area", "price", "desc"]) {
      if (typeof it[k] !== "string") err(at + k + " 必须为字符串");
    }
    if (it.end !== "") {
      if (!validDate(it.end)) err(at + "end 格式应为 YYYY-MM-DD 或空串: " + JSON.stringify(it.end));
      else if (it.end < todayStr) err(at + "已过期（end=" + it.end + " < 今天 " + todayStr + "）");
    }
    if (titles.has(it.title)) err(at + "标题重复: " + it.title);
    titles.add(it.title);
    const n = Array.from(it.desc || "").length;
    if (n < 40 || n > 90) warn(at + "desc 长度 " + n + " 字，建议 40—90 字");
    if (/['`]/.test([it.title, it.date, it.venue, it.area, it.price, it.desc, it.alert].join(""))) {
      warn(at + "含英文单引号或反引号，建议改用中文标点");
    }
    (catItems[it.cat] = catItems[it.cat] || []).push(it);
    if (!seenCats.includes(it.cat)) seenCats.push(it.cat);
  });

  // 分类块顺序
  const expect = CAT_ORDER.filter(x => seenCats.includes(x));
  if (seenCats.join(",") !== expect.join(",")) {
    err("[" + c.key + "] 分类块顺序应为 展览→会展市集→户外赏花→提前预告→花期预警→夜游，实际: " + seenCats.join(","));
  }
  // 同分类 end 升序、空串排尾
  for (const cat of Object.keys(catItems)) {
    let prev = null;
    for (const it of catItems[cat]) {
      if (prev !== null) {
        if (prev === "" && it.end !== "") err("[" + c.key + "/" + cat + "] 无 end 的条目应排在该分类末尾: " + it.title);
        else if (prev !== "" && it.end !== "" && it.end < prev) {
          err("[" + c.key + "/" + cat + "] end 未按升序: " + it.title + " (" + it.end + " < " + prev + ")");
        }
      }
      prev = it.end;
    }
  }
  if (tops < 3 || tops > 5) warn("[" + c.key + "] 本周必去 " + tops + " 条，建议 3—5 条");

  const soon = items.filter(e => e.end && e.end >= todayStr && e.end <= plus7()).length;
  const byCat = CAT_ORDER.map(x => x + " " + (catItems[x] ? catItems[x].length : 0)).join(" / ");
  info("[" + c.key + "] " + items.length + " 条（" + byCat + "），必去 " + tops + "，7 天内截止 " + soon);
}

function plus7() {
  const t = new Date(d0.getTime() + 7 * 86400000);
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}

console.log(errors ? "RESULT: FAIL (" + errors + " errors, " + warns + " warns)" : "RESULT: PASS (" + warns + " warns)");
process.exit(errors ? 1 : 0);

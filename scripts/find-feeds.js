#!/usr/bin/env node
/**
 * Find video podcasts via PodcastIndex API and add them to feeds config.
 * Requires PODCASTINDEX_KEY and PODCASTINDEX_SECRET in .env
 *
 * Usage:
 *   node scripts/find-feeds.js search <term>           - search feeds by text
 *   node scripts/find-feeds.js find-video [--limit N]   - video feeds (medium=video)
 *   node scripts/find-feeds.js find-transcripts-chapters [--limit N]  - video feeds with both
 *   node scripts/find-feeds.js add <url> [title] [--target feeds/dev.md]
 */

import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_BASE = "https://api.podcastindex.org/api/1.0";
const CACHE_DIR = path.join(ROOT, "cache", "find-feeds");

const KEY = (process.env.PODCASTINDEX_KEY || "").trim();
const SECRET = (process.env.PODCASTINDEX_SECRET || "").trim();

function die(msg) {
  console.error("error:", msg);
  process.exit(2);
}

function cacheKey(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex").slice(0, 32);
}

function readCache(subdir, key) {
  const p = path.join(CACHE_DIR, subdir, key + ".json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(subdir, key, data) {
  const dir = path.join(CACHE_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, key + ".json"), JSON.stringify(data), "utf8");
}

function readRssCache(url) {
  const key = cacheKey(normUrl(url) || url);
  const p = path.join(CACHE_DIR, "rss", key + ".xml");
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function writeRssCache(url, xml) {
  const key = cacheKey(normUrl(url) || url);
  const dir = path.join(CACHE_DIR, "rss");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, key + ".xml"), xml, "utf8");
}

function podcastindexHeaders() {
  if (!KEY || !SECRET) die("Missing PODCASTINDEX_KEY or PODCASTINDEX_SECRET in .env");
  const ts = String(Math.floor(Date.now() / 1000));
  const auth = crypto.createHash("sha1").update(KEY + SECRET + ts, "utf8").digest("hex");
  return {
    "User-Agent": "actual-plays/video-podcasts",
    "X-Auth-Key": KEY,
    "X-Auth-Date": ts,
    Authorization: auth,
    Accept: "application/json",
  };
}

async function httpGetJson(url, { noCache = false } = {}) {
  const key = cacheKey(url);
  if (!noCache) {
    const cached = readCache("api", key);
    if (cached) return cached;
  }
  const res = await fetch(url, { headers: podcastindexHeaders(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  writeCache("api", key, data);
  return data;
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "feed";
}

function normUrl(u) {
  try {
    const url = new URL((u || "").trim());
    return url.origin + url.pathname + (url.search || "") + (url.hash || "");
  } catch {
    return "";
  }
}

function isVideoEnclosure(item) {
  const t = (item.enclosureType || item.enclosure_type || "").toLowerCase();
  const u = (item.enclosureUrl || item.enclosure_url || "").toLowerCase();
  if (t.startsWith("video/")) return true;
  if (t.includes("mpegurl") || u.endsWith(".m3u8") || u.includes(".m3u8?")) return true;
  if (/\.(mp4|m4v|mov|webm)(\?|$)/.test(u)) return true;
  return false;
}

function extractFeed(f) {
  const url = (f.url || f.feedUrl || "").trim();
  const title = (f.title || "").trim();
  return { url, title };
}

function extractFeedFromEpisode(it) {
  const url = (it.feedUrl || it.feedurl || it.feed_url || "").trim();
  const title = (it.feedTitle || it.feedtitle || it.feed_title || "").trim();
  return { url, title };
}

/**
 * Audit feed XML: video, transcripts, playable captions (vtt/srt), chapters.
 * Uses cache/find-feeds/rss/ for RSS bodies.
 * @returns {{ ok: boolean, hasVideo: boolean, hasTranscript: boolean, hasPlayableTranscript: boolean, hasChapters: boolean, failReasons: string[], stars: number, itemCount: number } | { ok: false, failReasons: string[], stars: 0 }}
 */
async function auditFeed(feedUrl, { noCache = false } = {}) {
  const fail = (reasons) => ({ ok: false, failReasons: reasons, stars: 0 });
  try {
    let xml = !noCache ? readRssCache(feedUrl) : null;
    if (!xml) {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "vodcasts/find-feeds", Accept: "application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return fail(["fetch:" + res.status]);
      xml = await res.text();
      writeRssCache(feedUrl, xml);
    }
    const hasTranscript = /<podcast:transcript[\s>][^>]*url\s*=/i.test(xml) || /<podcast:transcript\s+url\s*=/i.test(xml);
    const hasPlayableTranscript = /<podcast:transcript[^>]*(type\s*=\s*["'](text\/vtt|application\/x-subrip)|rel\s*=\s*["']captions["'])/i.test(xml) ||
      /type\s*=\s*["'](text\/vtt|application\/x-subrip)["'][^>]*url\s*=/i.test(xml);
    const hasChapters = /<podcast:chapters[\s>]/i.test(xml) || /<psc:chapters/i.test(xml);
    const hasVideo = /type\s*=\s*["']video\//i.test(xml) || /\.(mp4|m4v|mov|webm|m3u8)(\?|["'\s>])/i.test(xml);
    const itemCount = (xml.match(/<item\b/g) || []).length + (xml.match(/<entry\b/g) || []).length;

    const failReasons = [];
    if (!hasVideo) failReasons.push("no-video");
    if (!hasTranscript) failReasons.push("no-transcript");
    if (!hasPlayableTranscript && hasTranscript) failReasons.push("no-playable-transcript");
    if (!hasChapters) failReasons.push("no-chapters");

    let stars = 0;
    if (hasVideo) stars++;
    if (hasTranscript) stars++;
    if (hasPlayableTranscript) stars++;
    if (hasChapters) stars++;
    if (hasVideo && hasTranscript && hasChapters) stars++; // bonus for full vodcast support

    return {
      ok: hasVideo && hasTranscript && hasChapters,
      hasVideo,
      hasTranscript,
      hasPlayableTranscript,
      hasChapters,
      failReasons,
      stars: Math.min(5, stars),
      itemCount,
    };
  } catch (e) {
    return fail(["fetch-error:" + (e?.message || "unknown")]);
  }
}

/** Legacy: true if audit passes for transcript+chapters+(optional video) */
async function feedHasTranscriptsAndChapters(feedUrl, requireVideo = true, opts = {}) {
  const a = await auditFeed(feedUrl, opts);
  return a.ok && (requireVideo ? a.hasVideo : true);
}

function buildUrl(path, params) {
  const qs = new URLSearchParams(params).toString();
  return `${API_BASE}${path}${qs ? "?" + qs : ""}`;
}

async function cmdSearch(term, noCache = false) {
  const data = await httpGetJson(buildUrl("/search/byterm", { q: term }), { noCache });
  const feeds = [].concat(data.feeds || []).filter(Boolean);
  console.log(`Found ${feeds.length} feeds for "${term}":\n`);
  for (const f of feeds.slice(0, 20)) {
    const { url, title } = extractFeed(f);
    if (url) console.log(`${title || "(no title)"}\n  ${url}\n`);
  }
}

async function cmdFindVideo(limit = 20, noCache = false) {
  const data = await httpGetJson(buildUrl("/podcasts/bytag", { medium: "video" }), { noCache });
  const feeds = [].concat(data.feeds || data.feed || []).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const f of feeds) {
    const { url, title } = extractFeed(f);
    if (!url || seen.has(normUrl(url))) continue;
    seen.add(normUrl(url));
    out.push({ url, title });
    if (out.length >= limit) break;
  }
  console.log(`Found ${out.length} video feeds:\n`);
  for (const { url, title } of out) {
    console.log(`${title || "(no title)"}\n  ${url}\n`);
  }
}

async function cmdFindTranscriptsChapters(limit = 10, includeAudio = false, noCache = false) {
  const seen = new Set();
  const candidates = [];
  const add = (url, title) => {
    if (!url || seen.has(normUrl(url))) return;
    seen.add(normUrl(url));
    candidates.push({ url, title });
  };
  const opts = { noCache };
  const bytag = await httpGetJson(buildUrl("/podcasts/bytag", { medium: "video" }), opts);
  for (const f of [].concat(bytag.feeds || bytag.feed || []).filter(Boolean)) {
    const { url, title } = extractFeed(f);
    add(url, title);
  }
  const recent = await httpGetJson(buildUrl("/recent/episodes", { max: 500, fulltext: true, excludeBlank: true }), opts);
  for (const it of [].concat(recent.items || recent.episodes || []).filter(Boolean)) {
    if (!isVideoEnclosure(it)) continue;
    const { url, title } = extractFeedFromEpisode(it);
    add(url, title);
  }
  for (const term of ["video", "transcript", "chapters", "tech podcast", "video podcast"]) {
    const search = await httpGetJson(buildUrl("/search/byterm", { q: term }), opts);
    for (const f of [].concat(search.feeds || []).filter(Boolean)) {
      const { url, title } = extractFeed(f);
      add(url, title);
    }
  }

  console.log(`Auditing ${candidates.length} feeds (video + transcript + chapters)${includeAudio ? " [include-audio]" : ""}...\n`);

  const failCounts = {};
  const byStars = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const matches = [];

  for (const { url, title } of candidates) {
    const audit = await auditFeed(url, { noCache });
    if (!includeAudio && !audit.hasVideo) continue;

    for (const r of audit.failReasons) {
      failCounts[r] = (failCounts[r] || 0) + 1;
    }

    const entry = { url, title: title || "(no title)", ...audit };
    const stars = audit.stars || 1;
    if (stars >= 1 && stars <= 5) byStars[stars].push(entry);

    const ok = audit.ok && (includeAudio || audit.hasVideo);
    process.stdout.write(`  ${title || url.slice(0, 50)}... ${ok ? "✓" : "✗"} ${"★".repeat(stars)}${"☆".repeat(5 - stars)}\n`);
    if (ok) {
      matches.push({ url, title });
      if (matches.length >= limit) break;
    }
  }

  const potentialsPath = path.join(CACHE_DIR, "potentials.json");
  const potentials = {
    updated: new Date().toISOString(),
    total: candidates.length,
    failReasons: failCounts,
    byStars,
    matches: matches.map((m) => ({ url: m.url, title: m.title })),
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(potentialsPath, JSON.stringify(potentials, null, 2), "utf8");

  console.log(`\n--- Fail reasons ---`);
  for (const [reason, count] of Object.entries(failCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log(`\n--- Potentials by stars ---`);
  for (let s = 5; s >= 1; s--) {
    console.log(`  ${s}★: ${byStars[s].length} feeds`);
  }
  console.log(`\nFound ${matches.length} feeds with video + transcript + chapters. Potentials: ${potentialsPath}\n`);
  for (const { url, title } of matches) {
    console.log(`${title || "(no title)"}\n  ${url}\n`);
  }
}

function getExistingUrls(targetPath) {
  const p = path.resolve(ROOT, targetPath);
  if (!fs.existsSync(p)) return new Set();
  const text = fs.readFileSync(p, "utf8");
  const urls = [];
  const re = /^\s*-\s*url\s*:\s*(.+)$/gm;
  let m;
  while ((m = re.exec(text))) urls.push(normUrl(m[1].trim()));
  return new Set(urls.filter(Boolean));
}

async function cmdAdd(url, title, target = "feeds/dev.md") {
  const nurl = normUrl(url);
  if (!nurl) die("Invalid URL");
  const existing = getExistingUrls(target);
  if (existing.has(nurl)) {
    console.log("Feed already in config.");
    return;
  }
  const slug = slugify(title || url);
  const entry = `\n## ${slug}
- url: ${url}
- title: ${title || slug}
- category: vodcast

`;
  const p = path.resolve(ROOT, target);
  let text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  const feedsMarker = "# Feeds";
  const idx = text.indexOf(feedsMarker);
  if (idx === -1) die(`No "# Feeds" section in ${target}`);
  const trimmed = text.trimEnd();
  text = trimmed + (trimmed.endsWith("\n") ? "" : "\n") + entry;
  fs.writeFileSync(p, text);
  console.log(`Added ${title || slug} to ${target}`);
}

async function main() {
  const args = process.argv.slice(2);
  const noCache = args.includes("--no-cache");
  const cleanArgs = args.filter((a) => a !== "--no-cache");
  const cmd = cleanArgs[0];
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(`
Usage:
  node scripts/find-feeds.js search <term>
  node scripts/find-feeds.js find-video [--limit N]
  node scripts/find-feeds.js find-transcripts-chapters [--limit N] [--include-audio]
  node scripts/find-feeds.js add <url> [title] [--target feeds/dev.md]

  --no-cache    bypass cache (API + RSS)
  Cache: cache/find-feeds/{api,rss}/
  Potentials: cache/find-feeds/potentials.json (audit results, 1-5★ by features)
`);
    return;
  }
  if (cmd === "search") {
    const term = cleanArgs[1] || "video";
    await cmdSearch(term, noCache);
    return;
  }
  if (cmd === "find-video") {
    const limitIdx = cleanArgs.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(cleanArgs[limitIdx + 1], 10) || 20 : 20;
    await cmdFindVideo(limit, noCache);
    return;
  }
  if (cmd === "find-transcripts-chapters") {
    const limitIdx = cleanArgs.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(cleanArgs[limitIdx + 1], 10) || 10 : 10;
    const includeAudio = cleanArgs.includes("--include-audio");
    await cmdFindTranscriptsChapters(limit, includeAudio, noCache);
    return;
  }
  if (cmd === "add") {
    const targetIdx = cleanArgs.indexOf("--target");
    const target = targetIdx >= 0 ? cleanArgs[targetIdx + 1] : "feeds/dev.md";
    const rest = targetIdx >= 0 ? cleanArgs.slice(0, targetIdx) : cleanArgs;
    const url = rest[1];
    const title = rest.slice(2).join(" ").trim() || "";
    if (!url) die("Usage: add <url> [title] [--target feeds/dev.md]");
    await cmdAdd(url, title, target);
    return;
  }
  die(`Unknown command: ${cmd}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

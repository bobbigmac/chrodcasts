function normalizeWhitespace(s) {
  return String(s ?? "").replace(/\\s+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
}

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((a) => {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      if (n === "style") el.removeAttribute(a.name);
    });
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer");
    }
  });
  return doc.body.innerHTML;
}

function textFromXml(el) {
  return el ? normalizeWhitespace(el.textContent || "") : "";
}

function attr(el, name) {
  return el?.getAttribute?.(name) ?? "";
}

function parseTimeToSeconds(v) {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\\d+(\\.\\d+)?$/.test(s)) return Math.max(0, Number(s));
  const parts = s.split(":").map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [a, b, c] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
  return Math.max(0, a * 3600 + b * 60 + c);
}

function pickBestEnclosure(cands) {
  const norm = cands
    .map((c) => ({
      url: c.url || "",
      type: (c.type || "").toLowerCase(),
    }))
    .filter((c) => c.url);

  const score = (c) => {
    const u = c.url.toLowerCase();
    const t = c.type;
    let s = 0;
    if (t.startsWith("video/")) s += 50;
    if (u.includes(".m3u8")) s += 45;
    if (u.match(/\\.(mp4|m4v|mov|webm)(\\?|$)/)) s += 40;
    if (t.includes("mpegurl")) s += 35;
    if (t.startsWith("audio/")) s += 5;
    return s;
  };

  norm.sort((a, b) => score(b) - score(a));
  const best = norm[0] || null;
  const hasVideo = norm.some(
    (c) => c.type.startsWith("video/") || c.url.toLowerCase().includes(".m3u8") || /\\.(mp4|m4v|mov|webm)(\\?|$)/.test(c.url.toLowerCase())
  );
  const isVideo =
    best && (best.type.startsWith("video/") || best.url.toLowerCase().includes(".m3u8") || /\\.(mp4|m4v|mov|webm)(\\?|$)/.test(best.url.toLowerCase()));
  return best ? { ...best, hasVideoInFeed: hasVideo, pickedIsVideo: isVideo } : null;
}

export function parseFeedXml(xmlText, source) {
  let xml = new DOMParser().parseFromString(xmlText, "text/xml");
  if (xml.querySelector("parsererror")) {
    xml = new DOMParser().parseFromString(xmlText, "text/html");
  }
  const isAtom = !!xml.querySelector("feed > entry");

  const channelTitle =
    textFromXml(xml.querySelector("channel > title")) || textFromXml(xml.querySelector("feed > title")) || source.title || source.id;

  const items = isAtom ? [...xml.querySelectorAll("feed > entry")] : [...xml.querySelectorAll("channel > item")];

  const parsed = [];
  let idx = 0;
  for (const item of items) {
    const title = textFromXml(item.querySelector("title")) || "(untitled)";
    const guid = textFromXml(item.querySelector("guid")) || textFromXml(item.querySelector("id"));
    const link =
      attr(item.querySelector("link[rel='alternate']"), "href") ||
      textFromXml(item.querySelector("link")) ||
      attr(item.querySelector("link"), "href") ||
      "";
    const dateStr = textFromXml(item.querySelector("pubDate")) || textFromXml(item.querySelector("published")) || textFromXml(item.querySelector("updated")) || "";
    const date = dateStr ? new Date(dateStr) : null;
    const desc = textFromXml(item.querySelector("content\\:encoded")) || textFromXml(item.querySelector("description")) || textFromXml(item.querySelector("summary")) || "";
    const durationRaw = textFromXml(item.querySelector("itunes\\:duration")) || attr(item.querySelector("itunes\\:duration"), "value") || "";
    const durationSec = parseTimeToSeconds(durationRaw);

    const enclosures = [];
    if (isAtom) {
      item.querySelectorAll("link[rel='enclosure']").forEach((l) => {
        enclosures.push({ url: attr(l, "href"), type: attr(l, "type") });
      });
    } else {
      item.querySelectorAll("enclosure").forEach((e) => {
        enclosures.push({ url: attr(e, "url"), type: attr(e, "type") });
      });
    }
    item.querySelectorAll("media\\:content").forEach((m) => {
      enclosures.push({ url: attr(m, "url"), type: attr(m, "type") });
    });

    const media = pickBestEnclosure(enclosures);

    const psc = item.querySelector("psc\\:chapters");
    const pscChapters = psc
      ? [...psc.querySelectorAll("psc\\:chapter")]
          .map((ch) => ({
            t: parseTimeToSeconds(attr(ch, "start")),
            name: attr(ch, "title") || textFromXml(ch) || "Chapter",
          }))
          .filter((c) => Number.isFinite(c.t))
      : [];
    const podcastChapters = item.querySelector("podcast\\:chapters");
    const podcastChaptersUrl = podcastChapters ? attr(podcastChapters, "url") : "";
    const podcastChaptersType = podcastChapters ? attr(podcastChapters, "type") || "application/json" : "";

    const transcripts = [];
    item.querySelectorAll("podcast\\:transcript").forEach((t) => {
      const url = attr(t, "url");
      const type = (attr(t, "type") || "").toLowerCase();
      const rel = (attr(t, "rel") || "").toLowerCase();
      const lang = attr(t, "language") || "en";
      if (!url || !type) return;
      const isCaptions = rel === "captions";
      const isPlayable = type === "text/vtt" || type === "application/x-subrip";
      transcripts.push({ url, type, lang, isCaptions, isPlayable });
    });
    transcripts.sort((a, b) => {
      if (a.isPlayable !== b.isPlayable) return a.isPlayable ? -1 : 1;
      if (a.isCaptions !== b.isCaptions) return a.isCaptions ? -1 : 1;
      return 0;
    });

    idx += 1;
    const id = (guid || media?.url || link || `${title}#${idx}`).slice(0, 240);

    parsed.push({
      id,
      title,
      link,
      date,
      dateText: date && !Number.isNaN(date.valueOf()) ? date.toISOString().slice(0, 10) : "",
      descriptionHtml: desc ? sanitizeHtml(desc) : "",
      channelTitle,
      durationSec: Number.isFinite(durationSec) ? durationSec : null,
      media: media?.url ? { url: media.url, type: media.type || "", hasVideoInFeed: media.hasVideoInFeed, pickedIsVideo: media.pickedIsVideo } : null,
      chaptersInline: pscChapters.length ? pscChapters : null,
      chaptersExternal: podcastChaptersUrl ? { url: podcastChaptersUrl, type: podcastChaptersType } : null,
      transcripts: transcripts.filter((t) => t.isPlayable),
    });
  }

  return { channelTitle, episodes: parsed };
}


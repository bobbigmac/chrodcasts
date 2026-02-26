function parseTimeParam(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Number(s));
  // Allow hh:mm:ss or mm:ss
  const parts = s.split(":").map((x) => x.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [a, b, c] = parts.length === 3 ? nums : [0, nums[0], nums[1]];
  return Math.max(0, a * 3600 + b * 60 + c);
}

export function getRouteFromUrl() {
  const u = new URL(window.location.href);
  const sp = u.searchParams;
  const feed = sp.get("feed") || sp.get("channel") || sp.get("c") || "";
  const ep = sp.get("ep") || sp.get("episode") || sp.get("e") || "";
  const t = parseTimeParam(sp.get("t") || sp.get("time"));
  return {
    feed: feed || null,
    ep: ep || null,
    t: Number.isFinite(t) ? t : null,
  };
}

export function setRouteInUrl({ feed, ep } = {}, { replace = true } = {}) {
  const u = new URL(window.location.href);
  u.hash = "";
  const sp = u.searchParams;
  if (feed) sp.set("feed", String(feed));
  else sp.delete("feed");
  if (ep) sp.set("ep", String(ep));
  else sp.delete("ep");
  // Never persist t during normal navigation; keep it for share links only.
  sp.delete("t");
  sp.delete("time");
  const next = u.toString();
  try {
    if (replace) history.replaceState({}, "", next);
    else history.pushState({}, "", next);
  } catch {}
}

export function buildShareUrl({ feed, ep, t } = {}) {
  const u = new URL(window.location.href);
  u.hash = "";
  u.search = "";
  if (feed) u.searchParams.set("feed", String(feed));
  if (ep) u.searchParams.set("ep", String(ep));
  if (t != null && Number.isFinite(Number(t))) u.searchParams.set("t", String(Math.max(0, Math.floor(Number(t)))));
  return u.toString();
}


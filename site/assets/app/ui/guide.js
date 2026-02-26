import { html, useEffect, useMemo, useRef, useSignal } from "../runtime/vendor.js";

const CATEGORY_ORDER = ["church", "university", "fitness", "bible", "twit", "podcastindex", "other", "needs-rss"];
const MS_PER_MIN = 60 * 1000;

// Fixed guide scale (no compression).
const PX_PER_MIN = 6;
const VIRTUAL_HOURS = 24;
const VIRTUAL_MIN = VIRTUAL_HOURS * 60;
const HORIZON_PX = VIRTUAL_MIN * PX_PER_MIN;

// Must match CSS grid left column width.
const CHAN_W_PX = 240;

const GUIDE_HEADER_H_PX = 46;
const GUIDE_ROW_H_PX = 56;
const ROW_OVERSCAN = 6;
const TIME_BUFFER_MIN = 90;

const RECENTER_MARGIN_PX = 1600;
const RECENTER_SHIFT_MIN = Math.floor(VIRTUAL_MIN / 2);

function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(sec)}s`;
}

function buildSourcesFlat(sources) {
  const groups = new Map();
  for (const s of sources || []) {
    const cat = s.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  }
  const cats = [...groups.keys()].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)) || a.localeCompare(b)
  );
  const flat = [];
  for (const cat of cats) {
    const list = groups
      .get(cat)
      .slice()
      .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
    flat.push(...list);
  }
  return flat;
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function mod(a, b) {
  const m = a % b;
  return m < 0 ? m + b : m;
}

function roundToHalfHour(ts) {
  const d = new Date(Number(ts) || Date.now());
  d.setSeconds(0);
  d.setMilliseconds(0);
  const m = d.getMinutes();
  d.setMinutes(Math.floor(m / 30) * 30);
  return d.getTime();
}

function fmtClock(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(ts));
  } catch {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}

function escSel(v) {
  const s = String(v || "");
  try {
    return globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  } catch {
    return s.replace(/["\\]/g, "\\$&");
  }
}

function bsearchCum(cum, off) {
  // `cum` length is n+1, monotonic, cum[0]=0, cum[n]=cycleSec.
  let lo = 0;
  let hi = cum.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const a = cum[mid];
    const b = cum[mid + 1];
    if (off < a) hi = mid - 1;
    else if (off >= b) lo = mid + 1;
    else return mid;
  }
  return clamp(lo, 0, Math.max(0, cum.length - 2));
}

export function GuidePanel({ isOpen, sources, player }) {
  const currentSourceId = player.currentSourceId.value;
  const currentEpisodeId = player.currentEpisodeId.value;
  const episodesBySource = player.sourceEpisodes.value || {};
  const sourcesFlat = useMemo(() => buildSourcesFlat(sources.value || []), [sources.value]);

  const focusSourceIdx = useSignal(Math.max(0, sourcesFlat.findIndex((s) => s.id === currentSourceId)));
  const focusTs = useSignal(Date.now());
  // Guide "epoch" for schedules; stays fixed while the panel is open.
  const guideZeroTs = useSignal(roundToHalfHour(Date.now()));
  const trackStartTs = useSignal(roundToHalfHour(Date.now()));
  const scrollRef = useRef(null);
  const loadingIdsRef = useRef(new Set());

  const DEFAULT_EP_SEC = 30 * 60;
  const MAX_EP_SEC = 6 * 3600;

  const estimateDurSec = (sourceId, ep) => {
    const ds = Number(ep?.durationSec);
    if (Number.isFinite(ds) && ds > 0) return Math.min(MAX_EP_SEC, ds);
    // We intentionally do NOT use learned durations here to avoid twitchy relayout.
    return DEFAULT_EP_SEC;
  };

  const scheduleCacheRef = useRef(new Map());
  const getSchedule = (sourceId) => {
    if (!sourceId) return null;
    const epsMap = player.sourceEpisodes.value || {};
    const epsRef = epsMap[sourceId] || null;
    if (!epsRef) return null;
    const prev = scheduleCacheRef.current.get(sourceId) || null;
    if (prev && prev.epsRef === epsRef) return prev.schedule;

    const playable = (epsRef || []).filter((ep) => ep.media?.url);
    if (!playable.length) {
      scheduleCacheRef.current.set(sourceId, { epsRef, schedule: null });
      return null;
    }
    const dursSec = playable.map((ep) => estimateDurSec(sourceId, ep));
    const cum = [0];
    for (let i = 0; i < dursSec.length; i++) cum.push(cum[cum.length - 1] + dursSec[i]);
    const cycleSec = cum[cum.length - 1] || 0;
    const schedule = cycleSec > 0 ? { playable, dursSec, cum, cycleSec } : null;
    scheduleCacheRef.current.set(sourceId, { epsRef, schedule });
    return schedule;
  };

  const programAt = (schedule, ts) => {
    if (!schedule || !Number.isFinite(ts)) return null;
    const cycleSec = schedule.cycleSec;
    if (!Number.isFinite(cycleSec) || cycleSec <= 0) return null;
    const relSec = (ts - guideZeroTs.value) / 1000;
    const off = mod(relSec, cycleSec);
    const cycleBaseSec = relSec - off;
    const idx = bsearchCum(schedule.cum, off);
    const startRelSec = cycleBaseSec + schedule.cum[idx];
    const startTs = guideZeroTs.value + startRelSec * 1000;
    const durSec = schedule.dursSec[idx];
    const endTs = startTs + durSec * 1000;
    return { idx, ep: schedule.playable[idx], startTs, endTs, durSec };
  };

  const blocksForRange = (schedule, startTs, endTs) => {
    const out = [];
    if (!schedule) return out;
    const first = programAt(schedule, startTs);
    if (!first) return out;
    let idx = first.idx;
    let curTs = first.startTs;
    let guard = 0;
    while (curTs < endTs && guard < 2000) {
      const ep = schedule.playable[idx];
      const durSec = schedule.dursSec[idx];
      const nextTs = curTs + durSec * 1000;
      out.push({ idx, ep, durSec, startTs: curTs, endTs: nextTs });
      curTs = nextTs;
      idx = (idx + 1) % schedule.playable.length;
      guard++;
    }
    return out;
  };

  // Scroll state (virtualization).
  const viewportW = useSignal(0);
  const viewportH = useSignal(0);
  const scrollLeftPx = useSignal(0);
  const scrollTopPx = useSignal(0);

  const getTrackViewport = (el) => {
    const sl = Math.max(0, el?.scrollLeft || 0);
    const vw = Math.max(0, el?.clientWidth || 0);
    const gutterPx = Math.max(0, CHAN_W_PX - sl);
    const trackViewportW = Math.max(0, vw - gutterPx);
    const trackLeftPx = Math.max(0, sl - CHAN_W_PX);
    const trackRightPx = trackLeftPx + trackViewportW;
    return { sl, vw, gutterPx, trackViewportW, trackLeftPx, trackRightPx };
  };

  const jumpToPlaying = async ({ alignNow = true } = {}) => {
    const srcId = player.current.value.source?.id || currentSourceId || null;
    if (!srcId) return;
    const srcIdx = Math.max(0, sourcesFlat.findIndex((s) => s.id === srcId));
    focusSourceIdx.value = srcIdx;

    const epsMap0 = player.sourceEpisodes.value || {};
    if (!epsMap0[srcId]) {
      try {
        await player.loadSourceEpisodes(srcId);
      } catch {}
    }

    const schedule = getSchedule(srcId);
    const epId = player.current.value.episode?.id || currentEpisodeId || null;
    const tSec = Number(player.playback?.value?.time || 0);
    const nowTs = Date.now();

    if (alignNow && schedule && epId) {
      const idx = schedule.playable.findIndex((ep) => ep?.id === epId);
      if (idx >= 0) {
        const durSec = schedule.dursSec[idx] || 0;
        const posSec = clamp(Number.isFinite(tSec) ? tSec : 0, 0, Math.max(0, durSec - 0.25));
        const offSec = (schedule.cum[idx] || 0) + posSec;
        guideZeroTs.value = nowTs - offSec * 1000;
        trackStartTs.value = nowTs - (VIRTUAL_MIN / 2) * MS_PER_MIN;
        focusTs.value = nowTs;
      } else {
        trackStartTs.value = nowTs - (VIRTUAL_MIN / 2) * MS_PER_MIN;
        focusTs.value = nowTs;
      }
    } else {
      trackStartTs.value = nowTs - (VIRTUAL_MIN / 2) * MS_PER_MIN;
      focusTs.value = nowTs;
    }

    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      try {
        const { trackViewportW } = getTrackViewport(el);
        const x = ((focusTs.value - trackStartTs.value) / MS_PER_MIN) * PX_PER_MIN;
        const targetLeft = Math.round(CHAN_W_PX + x - trackViewportW * 0.28);
        const max = Math.max(0, el.scrollWidth - el.clientWidth);
        el.scrollLeft = clamp(targetLeft, 0, max);

        const rowTop = GUIDE_HEADER_H_PX + srcIdx * GUIDE_ROW_H_PX;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = clamp(Math.round(rowTop - (el.clientHeight || 1) * 0.35), 0, maxTop);
      } catch {}
    });
  };

  useEffect(() => {
    if (!isOpen.value) return;
    // Start "at" what is currently playing (doesn't need to live-update).
    guideZeroTs.value = roundToHalfHour(Date.now());
    trackStartTs.value = guideZeroTs.value;
    focusSourceIdx.value = Math.max(0, sourcesFlat.findIndex((s) => s.id === currentSourceId));
    focusTs.value = Date.now();
    if (currentSourceId && !episodesBySource[currentSourceId]) {
      player.loadSourceEpisodes(currentSourceId).catch(() => {});
    }

    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        try {
          viewportW.value = el.clientWidth || 0;
          viewportH.value = el.clientHeight || 0;
          el.scrollLeft = Math.round(el.scrollLeft || 0);
          el.scrollTop = Math.round(el.scrollTop || 0);
          scrollLeftPx.value = el.scrollLeft;
          scrollTopPx.value = el.scrollTop;
          // Keep focus row visible on open.
          const rowTop = GUIDE_HEADER_H_PX + focusSourceIdx.value * GUIDE_ROW_H_PX;
          const targetTop = clamp(rowTop - Math.round((viewportH.value || 1) * 0.3), 0, Math.max(0, el.scrollHeight - el.clientHeight));
          el.scrollTop = targetTop;
          scrollTopPx.value = el.scrollTop;
        } catch {}
      });
    }

    // Best effort: jump to the playing episode + timestamp once data is available.
    setTimeout(() => jumpToPlaying({ alignNow: true }), 0);
  }, [isOpen.value, currentSourceId, sourcesFlat.length]);

  // Ensure focused row is loaded (lazy load as the user navigates).
  useEffect(() => {
    if (!isOpen.value) return;
    const src = sourcesFlat[focusSourceIdx.value];
    if (src && !episodesBySource[src.id]) player.loadSourceEpisodes(src.id).catch(() => {});
  }, [isOpen.value, focusSourceIdx.value, sourcesFlat.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (!isOpen.value) return;
      if (e.key === "Escape") {
        isOpen.value = false;
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const k = String(e.key || "");
      const isArrow = k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight";
      const isSelect = k === "Enter" || k === "OK" || k === "Select";
      if (!isArrow && !isSelect) return;

      e.preventDefault();
      try {
        e.stopPropagation();
      } catch {}

      if (k === "ArrowUp") {
        focusSourceIdx.value = Math.max(0, focusSourceIdx.value - 1);
        return;
      }
      if (k === "ArrowDown") {
        focusSourceIdx.value = Math.min(Math.max(0, sourcesFlat.length - 1), focusSourceIdx.value + 1);
        return;
      }

      if (k === "ArrowLeft") {
        const src = sourcesFlat[focusSourceIdx.value];
        const schedule = getSchedule(src?.id);
        if (!schedule) {
          focusTs.value = focusTs.value - 30 * MS_PER_MIN;
          return;
        }
        const cur = programAt(schedule, focusTs.value);
        focusTs.value = (cur?.startTs || focusTs.value) - 1000;
        return;
      }
      if (k === "ArrowRight") {
        const src = sourcesFlat[focusSourceIdx.value];
        const schedule = getSchedule(src?.id);
        if (!schedule) {
          focusTs.value = focusTs.value + 30 * MS_PER_MIN;
          return;
        }
        const cur = programAt(schedule, focusTs.value);
        focusTs.value = (cur?.endTs || focusTs.value) + 1000;
        return;
      }

      if (isSelect) {
        const src = sourcesFlat[focusSourceIdx.value];
        if (!src) return;
        const schedule = getSchedule(src.id);
        const prog = schedule ? programAt(schedule, focusTs.value) : null;
        const ep = prog?.ep || null;
        if (!ep?.id) return;
        (async () => {
          await player.selectSource(src.id, { preserveEpisode: false, skipAutoEpisode: true, autoplay: true });
          await player.selectEpisode(ep.id, { autoplay: true });
          isOpen.value = false;
        })();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const shiftTrackStart = (deltaMin) => {
    const el = scrollRef.current;
    if (!el) return;
    if (!Number.isFinite(deltaMin) || deltaMin === 0) return;
    const px = deltaMin * PX_PER_MIN;
    trackStartTs.value = trackStartTs.value + deltaMin * MS_PER_MIN;
    el.scrollLeft = Math.round((el.scrollLeft || 0) - px);
    scrollLeftPx.value = el.scrollLeft;
  };

  const ensureFocusVisible = () => {
    const el = scrollRef.current;
    if (!el) return;

    // Vertical.
    const rowTop = GUIDE_HEADER_H_PX + focusSourceIdx.value * GUIDE_ROW_H_PX;
    const rowBottom = rowTop + GUIDE_ROW_H_PX;
    const top = el.scrollTop || 0;
    const bottom = top + (el.clientHeight || 0);
    const marginY = 12;
    if (rowTop < top + GUIDE_HEADER_H_PX + marginY || rowBottom > bottom - marginY) {
      const targetTop = clamp(rowTop - Math.round((el.clientHeight || 1) * 0.35), 0, Math.max(0, el.scrollHeight - el.clientHeight));
      el.scrollTop = Math.round(targetTop);
      scrollTopPx.value = el.scrollTop;
    }

    // Horizontal (keep focus time within view).
    const { trackViewportW, trackLeftPx } = getTrackViewport(el);
    const viewStart = trackStartTs.value + (trackLeftPx / PX_PER_MIN) * MS_PER_MIN;
    const viewEnd = viewStart + (trackViewportW / PX_PER_MIN) * MS_PER_MIN;
    const marginMin = 25;
    const leftLimit = viewStart + marginMin * MS_PER_MIN;
    const rightLimit = viewEnd - marginMin * MS_PER_MIN;
    const t = focusTs.value;
    if (t < leftLimit || t > rightLimit) {
      const x = ((t - trackStartTs.value) / MS_PER_MIN) * PX_PER_MIN;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      const target = clamp(Math.round(CHAN_W_PX + x - trackViewportW * 0.28), 0, max);
      el.scrollLeft = Math.round(target);
      scrollLeftPx.value = el.scrollLeft;
    }
  };

  useEffect(() => {
    if (!isOpen.value) return;
    ensureFocusVisible();
  }, [isOpen.value, focusSourceIdx.value, focusTs.value]);

  // Note: we do not force DOM focus on hover/state updates; it can cause scroll jitter on some platforms.

  // Drag-to-pan inside the guide grid (touch + mouse).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let down = null;
    const onDown = (e) => {
      if (!isOpen.value) return;
      if (e.pointerType && e.pointerType !== "mouse") return; // touch devices already pan natively
      if (e.button != null && e.button !== 0) return;
      if (e.target?.closest?.(".guideGridEp")) return;
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      el.classList.add("dragging");
      try {
        e.preventDefault();
      } catch {}
    };
    const onMove = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      el.scrollLeft = down.sl - dx;
      el.scrollTop = down.st - dy;
    };
    const onUp = (e) => {
      if (!down || e.pointerId !== down.id) return;
      down = null;
      el.classList.remove("dragging");
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {}
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const currentSource = (sources.value || []).find((s) => s.id === currentSourceId) || null;
  const currentEpTitle = player.current.value.episode?.title || "—";

  const focusedSource = sourcesFlat[focusSourceIdx.value] || null;
  const focusedSchedule = getSchedule(focusedSource?.id);
  const focusedProg = focusedSchedule ? programAt(focusedSchedule, focusTs.value) : null;
  const focusedEp = focusedProg?.ep || null;
  const focusedTimeRange = focusedProg ? `${fmtClock(focusedProg.startTs)} – ${fmtClock(focusedProg.endTs)}` : "";

  const timeTicks = useMemo(() => {
    const out = [];
    const start = trackStartTs.value;
    // Tick density: aim for <= ~140 ticks.
    let tickStepMin = 30;
    while ((VIRTUAL_MIN / tickStepMin) > 140) tickStepMin *= 2;
    for (let m = 0; m <= VIRTUAL_MIN; m += tickStepMin) {
      const x = Math.round(m * PX_PER_MIN);
      out.push({ m, x, label: fmtClock(start + m * MS_PER_MIN) });
    }
    return out;
  }, [trackStartTs.value]);

  const viewStartTs = useMemo(() => {
    const trackLeftPx = Math.max(0, (scrollLeftPx.value || 0) - CHAN_W_PX);
    return trackStartTs.value + (trackLeftPx / PX_PER_MIN) * MS_PER_MIN;
  }, [trackStartTs.value, scrollLeftPx.value]);
  const viewEndTs = useMemo(() => {
    const sl = Math.max(0, scrollLeftPx.value || 0);
    const gutterPx = Math.max(0, CHAN_W_PX - sl);
    const trackViewportW = Math.max(0, (viewportW.value || 0) - gutterPx);
    return viewStartTs + (trackViewportW / PX_PER_MIN) * MS_PER_MIN;
  }, [viewStartTs, viewportW.value, scrollLeftPx.value]);
  const renderStartTs = viewStartTs - TIME_BUFFER_MIN * MS_PER_MIN;
  const renderEndTs = viewEndTs + TIME_BUFFER_MIN * MS_PER_MIN;

  const visibleRange = useMemo(() => {
    const top = scrollTopPx.value || 0;
    const startRow = clamp(Math.floor((top - GUIDE_HEADER_H_PX) / GUIDE_ROW_H_PX) - ROW_OVERSCAN, 0, Math.max(0, sourcesFlat.length - 1));
    const rowsVisible = Math.ceil(((viewportH.value || 0) + GUIDE_ROW_H_PX) / GUIDE_ROW_H_PX) + ROW_OVERSCAN * 2;
    const endRow = clamp(startRow + rowsVisible, 0, sourcesFlat.length);
    return { startRow, endRow };
  }, [scrollTopPx.value, viewportH.value, sourcesFlat.length]);

  const visibleSources = useMemo(
    () => sourcesFlat.slice(visibleRange.startRow, visibleRange.endRow),
    [sourcesFlat, visibleRange.startRow, visibleRange.endRow]
  );

  // Keep scroll state up to date and re-center the virtual window as needed.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        viewportW.value = el.clientWidth || 0;
        viewportH.value = el.clientHeight || 0;
        scrollLeftPx.value = el.scrollLeft || 0;
        scrollTopPx.value = el.scrollTop || 0;

        const { sl, trackViewportW, trackLeftPx } = getTrackViewport(el);
        const maxTrack = Math.max(0, HORIZON_PX - trackViewportW);
        if (maxTrack <= 0) return;

        // If the channel column is visible, don't re-center left; let "pulling left" reveal channels first.
        const allowLeftRecenter = sl >= CHAN_W_PX;
        if (allowLeftRecenter && trackLeftPx < RECENTER_MARGIN_PX) shiftTrackStart(-RECENTER_SHIFT_MIN);
        else if (trackLeftPx > maxTrack - RECENTER_MARGIN_PX) shiftTrackStart(RECENTER_SHIFT_MIN);
      });
    };
    const onResize = () => {
      viewportW.value = el.clientWidth || 0;
      viewportH.value = el.clientHeight || 0;
    };
    onResize();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      try {
        el.removeEventListener("scroll", onScroll);
      } catch {}
      try {
        window.removeEventListener("resize", onResize);
      } catch {}
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Lazy-load episodes for channels as they come into view (slow/steady).
  useEffect(() => {
    if (!isOpen.value) return;
    const loadingRef = loadingIdsRef.current;
    let canceled = false;
    const pump = async () => {
      const missing = [];
      for (let i = visibleRange.startRow; i < visibleRange.endRow; i++) {
        const src = sourcesFlat[i];
        if (!src) continue;
        if (episodesBySource[src.id]) continue;
        if (loadingRef.has(src.id)) continue;
        missing.push(src.id);
        if (missing.length >= 3) break;
      }
      for (const id of missing) {
        if (canceled) return;
        loadingRef.add(id);
        try {
          await player.loadSourceEpisodes(id);
        } catch {
          loadingRef.delete(id);
        }
      }
    };
    const t = setTimeout(pump, 120);
    return () => {
      canceled = true;
      clearTimeout(t);
    };
  }, [isOpen.value, visibleRange.startRow, visibleRange.endRow, sourcesFlat, Object.keys(episodesBySource).length]);

  return html`
    <div id="guidePanel" class="guidePanel" aria-hidden=${isOpen.value ? "false" : "true"}>
      <div class="guidePanel-inner">
        <div
          class="guideGridScroll"
          id="guideGrid"
          ref=${scrollRef}
          style=${{ "--guide-horizon": `${HORIZON_PX}px`, "--guide-row-h": `${GUIDE_ROW_H_PX}px` }}
          role="application"
          aria-label="TV guide"
        >
          <div class="guideGridHeaderRow">
            <div
              class="guideGridCorner"
              role="button"
              tabIndex=${0}
              title="Jump to what's playing"
              onClick=${() => jumpToPlaying({ alignNow: true })}
              onKeyDown=${(e) => {
                if (e.key === "Enter") jumpToPlaying({ alignNow: true });
              }}
            >
              <div class="guideGridCornerTop">All Channels</div>
              <div class="guideGridCornerSub">Today ${fmtClock(viewStartTs)}</div>
            </div>
            <div class="guideGridTimeAxis" style=${{ width: `${HORIZON_PX}px` }}>
              ${timeTicks.map((t) => {
                return html`
                  <div class="guideGridTick" style=${{ left: `${t.x}px` }}>
                    <span class="guideGridTickLabel">${t.label}</span>
                  </div>
                `;
              })}
            </div>
          </div>

          <div class="guideGridBody">
            <div class="guideGridSpacer" style=${{ height: `${visibleRange.startRow * GUIDE_ROW_H_PX}px` }} aria-hidden="true"></div>
            ${visibleSources.map((src, vi) => {
              const i = visibleRange.startRow + vi;
              const eps = episodesBySource[src.id] || null;
              const feat = src.features || {};
              const ccLikely = !!feat.hasPlayableTranscript || (!!eps && eps.some((ep) => (ep.transcripts || []).length));

              const schedule = getSchedule(src.id);
              const blocks = schedule ? blocksForRange(schedule, renderStartTs, renderEndTs) : [];

              const rowClass =
                "guideGridRow" +
                (i === focusSourceIdx.value ? " focused" : "") +
                (currentSourceId === src.id ? " playing" : "");

              const chanNo = String(101 + i).padStart(3, "0");

              return html`
                <div class=${rowClass} data-source-id=${src.id}>
                  <div
                    class="guideGridChannelCell"
                    role="button"
                    tabIndex=${0}
                    data-navitem="1"
                    onClick=${() => {
                      focusSourceIdx.value = i;
                      if (!episodesBySource[src.id]) player.loadSourceEpisodes(src.id).catch(() => {});
                    }}
                    onKeyDown=${(e) => {
                      if (e.key === "Enter") {
                        focusSourceIdx.value = i;
                        if (!episodesBySource[src.id]) player.loadSourceEpisodes(src.id).catch(() => {});
                      }
                    }}
                  >
                    <div class="guideGridChanNo mono">${chanNo}</div>
                    <div class="guideGridChanMeta">
                      <div class="guideGridChanName">${src.title || src.id}</div>
                      <div class="guideGridChanBadges">
                        ${ccLikely ? html`<span class="guideBadge guideBadge-cc" title="Captions likely available">CC</span>` : ""}
                      </div>
                    </div>
                  </div>
                  <div class="guideGridTrack" style=${{ width: `${HORIZON_PX}px` }}>
                    ${eps
                      ? schedule
                        ? blocks.map((b) => {
                            const ep = b.ep;
                            const durSec = b.durSec;
                            const x = Math.round(((b.startTs - trackStartTs.value) / MS_PER_MIN) * PX_PER_MIN);
                            const w0 = Math.round((durSec / 60) * PX_PER_MIN);
                            const w = Math.max(28, w0);
                            const active = currentSourceId === src.id && currentEpisodeId === ep.id;
                            const epHasCc = (ep.transcripts || []).length > 0;
                            const maxSec =
                              typeof player.getProgressMaxSec === "function"
                                ? player.getProgressMaxSec(src.id, ep.id)
                                : typeof player.getProgressSec === "function"
                                  ? player.getProgressSec(src.id, ep.id)
                                  : 0;
                            const pct = durSec > 0 && maxSec > 0 ? Math.min(100, (Math.max(0, maxSec) / durSec) * 100) : 0;
                            const isFocused =
                              i === focusSourceIdx.value &&
                              focusedProg &&
                              Math.abs(Number(focusedProg.startTs) - Number(b.startTs)) < 500 &&
                              focusedProg.ep?.id === ep.id;
                            const dur = fmtDuration(Number(ep.durationSec) > 0 ? Number(ep.durationSec) : durSec) || (ep.dateText || "");
                            return html`
                              <button
                                class=${"guideGridEp" + (active ? " active" : "") + (isFocused ? " focused" : "")}
                                style=${{ left: `${x}px`, width: `${w}px` }}
                                data-ep-id=${ep.id}
                              data-prog-start=${String(b.startTs)}
                              data-source-id=${src.id}
                              data-navitem="1"
                              aria-label=${`${ep.title || "Episode"}${epHasCc ? " (CC)" : ""}`}
                              onPointerEnter=${() => {
                                focusSourceIdx.value = i;
                                focusTs.value = Number(b.startTs) + 1000;
                              }}
                              onClick=${async () => {
                                await player.selectSource(src.id, { preserveEpisode: false, skipAutoEpisode: true, autoplay: true });
                                await player.selectEpisode(ep.id, { autoplay: true });
                                isOpen.value = false;
                              }}
                              >
                                <div class="guideGridEpProgress" style=${{ width: `${pct}%` }} aria-hidden="true"></div>
                                <div class="guideGridEpTop">
                                  <span class="guideGridEpTitle">${ep.title || "Episode"}</span>
                                  ${epHasCc ? html`<span class="guideGridEpBadge guideBadge guideBadge-cc" title="Captions available">CC</span>` : ""}
                                </div>
                                <div class="guideGridEpMeta">
                                  <span class="guideGridEpDur">${dur}</span>
                                </div>
                              </button>
                            `;
                          })
                        : html`
                            <button class="guideGridEp guideGridEpLoad" style=${{ left: "0px", width: "260px" }} disabled>
                              No playable videos
                            </button>
                          `
                      : html`
                          <button
                            class="guideGridEp guideGridEpLoad"
                            style=${{ left: "0px", width: "220px" }}
                            onClick=${async () => {
                              await player.loadSourceEpisodes(src.id);
                            }}
                          >
                            Loading…
                          </button>
                        `}
                  </div>
                </div>
              `;
            })}
            <div
              class="guideGridSpacer"
              style=${{ height: `${Math.max(0, (sourcesFlat.length - visibleRange.endRow) * GUIDE_ROW_H_PX)}px` }}
              aria-hidden="true"
            ></div>
          </div>
        </div>
        <div class="guidePanel-episodes" id="guideEpisodes">
          <div class="guideNowLabel">
            ${focusedSource ? focusedSource.title || focusedSource.id : "—"} ${focusedTimeRange ? html`<span class="guideNowSep">•</span>` : ""}
            ${focusedTimeRange}
          </div>
          <div class="guideNowEp">${focusedEp ? focusedEp.title || "—" : "—"}</div>
          <div class="guideNowSub">${currentSource ? `Playing: ${currentEpTitle}` : ""}</div>
        </div>
      </div>
      <button
        id="btnCloseGuide"
        class="guidePanel-close"
        title="Close"
        data-navitem="1"
        data-keyhint="G — Close"
        onClick=${() => (isOpen.value = false)}
      >
        ✕
      </button>
    </div>
  `;
}

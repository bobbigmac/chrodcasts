// Ported from `video-podcasts/history.js`, wrapped so it can be mounted from the controller.

const SHORT_THRESHOLD_SEC = 30;

function videoKey(sourceId, episodeId) {
  return `${sourceId}::${episodeId}`;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

export function createHistory({ storageKey }) {
  let entries = [];
  let current = null;
  let subscribers = [];
  let panelEl = null;
  let panelInstance = null;
  let containerEl = null;

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "[]");
      entries = Array.isArray(raw) ? raw : [];
    } catch {
      entries = [];
    }
  }
  function save() {
    localStorage.setItem(storageKey, JSON.stringify(entries));
    subscribers.forEach((fn) => fn());
  }
  function subscribe(fn) {
    subscribers.push(fn);
    return () => {
      subscribers = subscribers.filter((f) => f !== fn);
    };
  }

  function startSegment({ sourceId, episodeId, episodeTitle, channelTitle, startTime }) {
    if (current && videoKey(current.sourceId, current.episodeId) !== videoKey(sourceId, episodeId)) {
      entries.unshift({ ...current });
      save();
    }
    current = {
      sourceId,
      episodeId,
      episodeTitle: episodeTitle || "",
      channelTitle: channelTitle || "",
      start: startTime ?? 0,
      end: startTime ?? 0,
      at: Date.now(),
    };
    subscribers.forEach((fn) => fn());
  }

  function updateEnd(time) {
    if (current && Number.isFinite(time)) {
      current.end = Math.max(current.start, time);
      subscribers.forEach((fn) => fn());
    }
  }

  function markCurrentHadSleep() {
    if (current) {
      current.hadSleep = true;
      subscribers.forEach((fn) => fn());
    }
  }

  function finalize() {
    if (current) {
      entries.unshift({ ...current });
      save();
      current = null;
      subscribers.forEach((fn) => fn());
    }
  }

  function getEntries() {
    return [...entries];
  }

  function getCurrent() {
    return current ? { ...current } : null;
  }

  function clear() {
    entries = [];
    save();
  }

  function clearShort(thresholdSec = SHORT_THRESHOLD_SEC) {
    entries = entries.filter((e) => e.end - e.start >= thresholdSec);
    save();
  }

  function combine() {
    if (entries.length < 2) return;
    const out = [];
    let run = null;
    for (const e of entries) {
      const key = videoKey(e.sourceId, e.episodeId);
      if (run && videoKey(run.sourceId, run.episodeId) === key) {
        run.start = Math.min(run.start, e.start);
        run.end = Math.max(run.end, e.end);
        if (e.hadSleep) run.hadSleep = true;
      } else {
        run = { ...e };
        out.push(run);
      }
    }
    entries = out;
    save();
  }

  function render(container, { onEntryClick, onRestart, onContinue, fmtTime }) {
    if (!container) return;

    const header = document.createElement("div");
    header.className = "historyHeader";
    header.innerHTML = `
      <span>History</span>
      <div class="historyActions">
        <button class="historyBtn" data-action="combine" title="Combine same video">Combine</button>
        <button class="historyBtn" data-action="clearShort" title="Remove short segments">Clear short</button>
        <button class="historyBtn" data-action="clear" title="Clear all">Clear</button>
        <button class="historyBtn historyBtnClose">✕</button>
      </div>
    `;

    const list = document.createElement("div");
    list.className = "historyList";

    function renderList() {
      list.innerHTML = "";
      const all = getCurrent() ? [getCurrent(), ...getEntries()] : getEntries();
      for (let i = 0; i < all.length; i++) {
        const e = all[i];
        const isCurrent = i === 0 && getCurrent();
        const el = document.createElement("div");
        el.className = "historyEntry" + (isCurrent ? " historyEntryCurrent" : "") + (e.hadSleep ? " historyEntryHadSleep" : "");
        const title = (e.episodeTitle || "Episode").slice(0, 50) + ((e.episodeTitle || "").length > 50 ? "…" : "");
        const sub = (e.channelTitle || "").slice(0, 30);
        const range = `${fmtTime(e.start)} → ${fmtTime(e.end)}`;
        el.innerHTML = `
          <button class="historyEntryBtn historyEntryBtnRestart" title="Restart segment">↺</button>
          <button class="historyEntryBtn historyEntryBtnContinue" title="Continue from before end">→</button>
          <div class="historyEntryTitle">${escapeHtml(title)}</div>
          <div class="historyEntrySub">${escapeHtml(sub)} · ${range}</div>
        `;
        el.querySelector(".historyEntryBtnRestart")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onRestart?.(e);
        });
        el.querySelector(".historyEntryBtnContinue")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onContinue?.(e);
        });
        el.addEventListener("click", (ev) => {
          if (ev.target.closest(".historyEntryBtn")) return;
          onEntryClick?.(e);
        });
        list.appendChild(el);
      }
    }

    header.querySelector("[data-action=clear]")?.addEventListener("click", () => {
      clear();
      renderList();
    });
    header.querySelector("[data-action=clearShort]")?.addEventListener("click", () => {
      clearShort();
      renderList();
    });
    header.querySelector("[data-action=combine]")?.addEventListener("click", () => {
      combine();
      renderList();
    });

    const unsub = subscribe(renderList);
    renderList();

    container.innerHTML = "";
    container.appendChild(header);
    container.appendChild(list);

    return {
      closeBtn: header.querySelector(".historyBtnClose"),
      destroy: () => {
        unsub();
      },
    };
  }

  function open() {
    if (panelEl) panelEl.setAttribute("aria-hidden", "false");
  }
  function close() {
    if (panelEl) panelEl.setAttribute("aria-hidden", "true");
  }

  function mount(container, { player }) {
    containerEl = container;
    panelEl = document.getElementById("historyPanel");
    panelInstance = render(container, {
      fmtTime: player.fmtTime,
      onEntryClick: (e) => player.loadSourceAndEpisode(e.sourceId, e.episodeId, { autoplay: true }),
      onRestart: (e) => player.loadSourceAndEpisode(e.sourceId, e.episodeId, { autoplay: true, startAt: e.start }),
      onContinue: (e) => player.loadSourceAndEpisode(e.sourceId, e.episodeId, { autoplay: true, startAt: Math.max(0, (e.end || 0) - 5) }),
    });
    panelInstance?.closeBtn?.addEventListener("click", () => close());
    return panelInstance;
  }

  load();

  return {
    startSegment,
    updateEnd,
    markCurrentHadSleep,
    finalize,
    getEntries,
    getCurrent,
    open,
    close,
    mount,
  };
}


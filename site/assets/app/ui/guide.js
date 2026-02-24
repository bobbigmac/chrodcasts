export function createGuide({ env, store, els, log, player }) {
  let sources = [];
  let episodesBySource = {};
  let currentSourceId = null;
  let currentEpisodeId = null;

  let sourcesFlat = [];
  let guideFocusSourceIdx = 0;
  let guideFocusEpIdx = 0;
  let guideObserver = null;
  let guideLoadingSources = new Set();

  const CATEGORY_ORDER = ["church", "university", "fitness", "bible", "twit", "podcastindex", "other", "needs-rss"];

  store.subscribe((s) => {
    sources = s.sources || [];
    currentSourceId = s.current?.sourceId || null;
    currentEpisodeId = s.current?.episodeId || null;
    episodesBySource = player.getCurrent().episodesBySource || {};
    buildSourcesFlat();
  });

  function buildSourcesFlat() {
    const groups = new Map();
    for (const s of sources) {
      const cat = s.category || "other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(s);
    }
    const cats = [...groups.keys()].sort((a, b) => (CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)) || a.localeCompare(b));
    sourcesFlat = [];
    for (const cat of cats) {
      const list = groups.get(cat).slice().sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
      sourcesFlat.push(...list);
    }
  }

  function fmtDuration(sec) {
    if (!Number.isFinite(sec) || sec < 0) return null;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h${m}m`;
    if (m > 0) return `${m}m`;
    return `${Math.floor(sec)}s`;
  }

  function renderEpStrip(epStrip, src, eps) {
    epStrip.innerHTML = "";
    const playable = eps.filter((e) => e.media?.url && e.media?.pickedIsVideo);
    for (let j = 0; j < playable.length; j++) {
      const ep = playable[j];
      const block = document.createElement("button");
      block.className = "guideEpBlock" + (currentEpisodeId === ep.id ? " active" : "");
      block.dataset.epIdx = String(j);
      block.dataset.epId = ep.id;
      block.dataset.sourceId = src.id;

      const titleEl = document.createElement("span");
      titleEl.className = "guideEpBlockTitle";
      titleEl.textContent = (ep.title || "Episode").slice(0, 24) + ((ep.title || "").length > 24 ? "…" : "");

      const meta = document.createElement("span");
      meta.className = "guideEpBlockMeta";
      meta.textContent = fmtDuration(ep.durationSec) || (ep.dateText || "");

      block.append(titleEl, meta);
      block.addEventListener("click", async () => {
        await player.loadSource(src.id, { preserveEpisode: false, skipAutoEpisode: true });
        await player.loadEpisode(ep.id, { autoplay: true });
        closeGuide();
      });
      epStrip.appendChild(block);
    }
  }

  function updateGuideRow(row, src, eps) {
    const epStrip = row.querySelector(".guideEpStrip");
    if (!epStrip) return;
    renderEpStrip(epStrip, src, eps);
    row.dataset.loaded = "true";
    updateGuideFocus();
  }

  function setupGuideObserver() {
    if (guideObserver) guideObserver.disconnect();
    const container = els.guideFeeds;
    if (!container) return;
    guideObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const row = e.target;
          const sourceId = row.dataset.sourceId;
          if (!sourceId || row.dataset.loaded === "true" || guideLoadingSources.has(sourceId)) continue;
          const src = sources.find((s) => s.id === sourceId);
          if (!src || episodesBySource[sourceId]) continue;
          guideLoadingSources.add(sourceId);
          player
            .loadSourceEpisodes(sourceId)
            .then((eps) => {
              guideLoadingSources.delete(sourceId);
              if (els.guidePanel?.getAttribute("aria-hidden") === "false" && row.isConnected) {
                updateGuideRow(row, src, eps);
              }
            })
            .catch(() => guideLoadingSources.delete(sourceId));
        }
      },
      { root: container, rootMargin: "80px", threshold: 0.01 }
    );
  }

  function renderGuide() {
    if (!els.guideFeeds || !els.guideEpisodes) return;
    els.guideFeeds.innerHTML = "";
    els.guideEpisodes.innerHTML = "";
    if (!sourcesFlat.length) return;

    for (let i = 0; i < sourcesFlat.length; i++) {
      const src = sourcesFlat[i];
      const isFocused = i === guideFocusSourceIdx;
      const eps = episodesBySource[src.id] ?? null;

      const row = document.createElement("div");
      row.className = "guideChannelRow" + (isFocused ? " focused" : "") + (currentSourceId === src.id ? " playing" : "");
      row.dataset.sourceIdx = String(i);
      row.dataset.sourceId = src.id;

      const chName = document.createElement("div");
      chName.className = "guideChannelName";
      chName.textContent = src.title || src.id;

      const epStrip = document.createElement("div");
      epStrip.className = "guideEpStrip";

      if (eps) {
        renderEpStrip(epStrip, src, eps);
        row.dataset.loaded = "true";
      } else {
        const loadBtn = document.createElement("button");
        loadBtn.className = "guideEpBlock guideEpLoad";
        loadBtn.textContent = "…";
        loadBtn.addEventListener("click", async () => {
          const loaded = await player.loadSourceEpisodes(src.id);
          if (els.guidePanel?.getAttribute("aria-hidden") === "false") updateGuideRow(row, src, loaded);
        });
        epStrip.appendChild(loadBtn);
      }

      row.append(chName, epStrip);
      row.addEventListener("click", (e) => {
        if (e.target.closest(".guideEpBlock")) return;
        guideFocusSourceIdx = i;
        if (!episodesBySource[src.id]) player.loadSourceEpisodes(src.id).then((loaded) => updateGuideRow(row, src, loaded));
      });
      els.guideFeeds.appendChild(row);
    }

    const nowLabel = document.createElement("div");
    nowLabel.className = "guideNowLabel";
    const currentSource = sources.find((s) => s.id === currentSourceId);
    nowLabel.textContent = currentSource ? currentSource.title || currentSource.id : "—";
    const nowEp = player.getCurrent().episode ? player.getCurrent().episode.title || "—" : "—";
    const nowEpEl = document.createElement("div");
    nowEpEl.className = "guideNowEp";
    nowEpEl.textContent = String(nowEp).slice(0, 60) + (String(nowEp).length > 60 ? "…" : "");
    els.guideEpisodes.append(nowLabel, nowEpEl);

    setupGuideObserver();
    [...els.guideFeeds.querySelectorAll(".guideChannelRow[data-loaded!='true']")].forEach((row) => guideObserver?.observe(row));
    updateGuideFocus();
  }

  function updateGuideFocus() {
    [...(els.guideFeeds?.querySelectorAll?.(".guideChannelRow") || [])].forEach((row, i) => {
      row.classList.toggle("focused", i === guideFocusSourceIdx);
    });
    const row = els.guideFeeds?.querySelector?.(".guideChannelRow.focused");
    row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    const blocks = row?.querySelectorAll?.(".guideEpBlock:not(.guideEpLoad)") || [];
    blocks.forEach((b, j) => b.classList.toggle("focused", j === guideFocusEpIdx));
  }

  function openGuide() {
    els.guidePanel?.setAttribute("aria-hidden", "false");
    guideFocusSourceIdx = Math.max(0, sourcesFlat.findIndex((s) => s.id === currentSourceId));
    guideFocusEpIdx = 0;
    renderGuide();
  }

  function closeGuide() {
    els.guidePanel?.setAttribute("aria-hidden", "true");
    guideObserver?.disconnect?.();
    guideObserver = null;
  }

  function handleGuideKey(e) {
    if (els.guidePanel?.getAttribute("aria-hidden") !== "false") return false;
    const k = e.key;
    if (k === "Escape") {
      closeGuide();
      return true;
    }
    if (k === "ArrowUp") {
      e.preventDefault();
      guideFocusSourceIdx = Math.max(0, guideFocusSourceIdx - 1);
      guideFocusEpIdx = 0;
      const src = sourcesFlat[guideFocusSourceIdx];
      if (src && !episodesBySource[src.id]) {
        const row = els.guideFeeds?.querySelector?.(`[data-source-id="${src.id}"]`);
        player.loadSourceEpisodes(src.id).then((eps) => row?.isConnected && updateGuideRow(row, src, eps));
      } else updateGuideFocus();
      return true;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      guideFocusSourceIdx = Math.min(sourcesFlat.length - 1, guideFocusSourceIdx + 1);
      guideFocusEpIdx = 0;
      const src = sourcesFlat[guideFocusSourceIdx];
      if (src && !episodesBySource[src.id]) {
        const row = els.guideFeeds?.querySelector?.(`[data-source-id="${src.id}"]`);
        player.loadSourceEpisodes(src.id).then((eps) => row?.isConnected && updateGuideRow(row, src, eps));
      } else updateGuideFocus();
      return true;
    }
    if (k === "ArrowLeft") {
      e.preventDefault();
      guideFocusEpIdx = Math.max(0, guideFocusEpIdx - 1);
      updateGuideFocus();
      return true;
    }
    if (k === "ArrowRight") {
      e.preventDefault();
      const eps = episodesBySource[sourcesFlat[guideFocusSourceIdx]?.id] || [];
      const playable = eps.filter((ep) => ep.media?.url && ep.media?.pickedIsVideo);
      guideFocusEpIdx = Math.min(Math.max(0, playable.length - 1), guideFocusEpIdx + 1);
      updateGuideFocus();
      return true;
    }
    return false;
  }

  function attachUiHandlers() {
    els.btnChannel?.addEventListener("click", () => openGuide());
    els.btnCloseGuide?.addEventListener("click", () => closeGuide());
    document.addEventListener("keydown", (e) => {
      if (handleGuideKey(e)) return;
    });
    els.btnRandom?.addEventListener("click", async () => {
      if (!sourcesFlat.length) return;
      let attempts = 0;
      const tryOne = async () => {
        const src = sourcesFlat[Math.floor(Math.random() * sourcesFlat.length)];
        await player.loadSource(src.id, { preserveEpisode: false, pickRandomEpisode: true });
        const playable = (player.getCurrent().episodes || []).filter((e) => e.media?.url && e.media?.pickedIsVideo);
        if (!playable.length && ++attempts < 3) await tryOne();
      };
      await tryOne();
    });
  }

  attachUiHandlers();

  return {
    refresh: () => {
      buildSourcesFlat();
      renderGuide();
    },
  };
}


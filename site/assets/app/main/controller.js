import { createHistory } from "../state/history.js";
import { createPlayer } from "../player/player.js";
import { createGuide } from "../ui/guide.js";
import { createDetails } from "../ui/details.js";

export function createAppController({ env, store, log }) {
  const els = {
    video: document.getElementById("video"),
    htmlRoot: document.getElementById("htmlRoot"),
    guideBar: document.getElementById("guideBar"),
    btnPlay: document.getElementById("btnPlay"),
    btnChannel: document.getElementById("btnChannel"),
    btnRandom: document.getElementById("btnRandom"),
    btnCC: document.getElementById("btnCC"),
    btnTheme: document.getElementById("btnTheme"),
    btnHistory: document.getElementById("btnHistory"),
    btnDetails: document.getElementById("btnDetails"),
    guideNow: document.getElementById("guideNow"),
    guideTime: document.getElementById("guideTime"),
    guideSeek: document.getElementById("guideSeek"),
    guideSeekFill: document.getElementById("guideSeekFill"),
    btnSeekBack: document.getElementById("btnSeekBack"),
    btnSeekFwd: document.getElementById("btnSeekFwd"),
    btnSleep: document.getElementById("btnSleep"),
    sleepMenu: document.getElementById("sleepMenu"),
    progress: document.getElementById("progress"),
    progressFill: document.getElementById("progressFill"),
    guidePanel: document.getElementById("guidePanel"),
    guideFeeds: document.getElementById("guideFeeds"),
    guideEpisodes: document.getElementById("guideEpisodes"),
    btnCloseGuide: document.getElementById("btnCloseGuide"),
    detailsPanel: document.getElementById("detailsPanel"),
    btnCloseDetails: document.getElementById("btnCloseDetails"),
    epTitle: document.getElementById("epTitle"),
    epSub: document.getElementById("epSub"),
    epDesc: document.getElementById("epDesc"),
    chapters: document.getElementById("chapters"),
    btnClearLog: document.getElementById("btnClearLog"),
    historyPanel: document.getElementById("historyPanel"),
    historyPanelContent: document.getElementById("historyPanelContent"),
  };

  const history = createHistory({ storageKey: "vodcasts_history_v1" });

  const player = createPlayer({ env, store, els, log, history });
  const guide = createGuide({ env, store, els, log, player, history });
  const details = createDetails({ env, store, els, log, player });

  els.btnHistory?.addEventListener("click", () => {
    const isOpen = document.getElementById("historyPanel")?.getAttribute("aria-hidden") === "false";
    if (isOpen) history.close();
    else history.open();
  });
  els.btnDetails?.addEventListener("click", () => {
    const isOpen = els.detailsPanel?.getAttribute("aria-hidden") === "false";
    if (isOpen) details.close();
    else details.open();
  });
  const THEME_KEY = "vodcasts_theme_v1";
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme && els.htmlRoot) els.htmlRoot.dataset.theme = savedTheme;
  els.btnTheme?.addEventListener("click", () => {
    const cur = els.htmlRoot?.dataset?.theme || "modern";
    const next = cur === "modern" ? "dos" : "modern";
    if (els.htmlRoot) els.htmlRoot.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  });

  els.btnClearLog?.addEventListener("click", () => log.clear());

  // Expose panels.
  history.mount(els.historyPanelContent, { player });

  // Guide bar idle fade.
  const GUIDE_IDLE_MS = 3000;
  let guideBarIdleTo = Date.now() + GUIDE_IDLE_MS;
  const resetGuideBarIdle = () => {
    guideBarIdleTo = Date.now() + GUIDE_IDLE_MS;
    els.guideBar?.classList.remove("idle");
  };
  const tickIdle = () => {
    if (Date.now() > guideBarIdleTo) els.guideBar?.classList.add("idle");
    requestAnimationFrame(tickIdle);
  };
  tickIdle();
  ["mousemove", "mousedown", "keydown", "touchstart"].forEach((ev) =>
    document.addEventListener(ev, resetGuideBarIdle, { passive: true })
  );

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.guidePanel?.getAttribute("aria-hidden") === "false") els.btnCloseGuide?.click();
    if (els.detailsPanel?.getAttribute("aria-hidden") === "false") details.close();
    if (document.getElementById("historyPanel")?.getAttribute("aria-hidden") === "false") history.close();
  });

  store.subscribe(() => {
    const cur = player.getCurrent();
    const srcTitle = cur.source?.title || cur.source?.id || "—";
    if (els.btnChannel) els.btnChannel.textContent = srcTitle;
    const epTitle = cur.episode?.title || "—";
    if (els.guideNow) els.guideNow.textContent = epTitle;
    details.refresh();
    // Only repaint the guide when it is open (otherwise it feels jumpy).
    if (els.guidePanel?.getAttribute("aria-hidden") === "false") guide.refresh();
  });

  return { player, guide, details, history };
}

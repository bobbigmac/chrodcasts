import { createComments } from "../vod/timed_comments.js";

export function createDetails({ env, store, els, log, player }) {
  const comments = createComments({ env, els, log, player });
  let isOpen = false;

  function open() {
    isOpen = true;
    els.detailsPanel?.setAttribute("aria-hidden", "false");
    refresh();
  }

  function close() {
    isOpen = false;
    els.detailsPanel?.setAttribute("aria-hidden", "true");
  }

  function refresh() {
    const cur = player.getCurrent();
    const ep = cur.episode;
    if (els.epTitle) els.epTitle.textContent = ep?.title || "—";
    if (els.epSub) els.epSub.textContent = ep ? `${ep.channelTitle || cur.source?.title || ""}${ep.dateText ? " · " + ep.dateText : ""}` : "—";
    if (els.epDesc) els.epDesc.innerHTML = ep?.descriptionHtml || "";
    if (isOpen) comments.setEpisode(cur.source, ep);
  }

  els.btnCloseDetails?.addEventListener("click", () => close());

  return { open, close, refresh };
}

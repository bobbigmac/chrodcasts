import { html } from "../runtime/vendor.js";

function titleShort(s, n) {
  const t = String(s || "Episode");
  return t.slice(0, n) + (t.length > n ? "…" : "");
}

export function HistoryPanel({ isOpen, history, player }) {
  const all = history.all.value || [];

  return html`
    <div id="historyPanel" class="historyPanel" aria-hidden=${isOpen.value ? "false" : "true"}>
      <div id="historyPanelContent" class="historyPanelContent">
        <div class="historyHeader">
          <span>History</span>
          <div class="historyActions">
            <button class="historyBtn" title="Combine same video" onClick=${() => history.combine()}>Combine</button>
            <button class="historyBtn" title="Remove short segments" onClick=${() => history.clearShort()}>Clear short</button>
            <button class="historyBtn" title="Clear all" onClick=${() => history.clear()}>Clear</button>
            <button class="historyBtn historyBtnClose" onClick=${() => (isOpen.value = false)}>✕</button>
          </div>
        </div>

        <div class="historyList">
          ${all.map((e, idx) => {
            const isCurrent = idx === 0 && history.current.value;
            const cls =
              "historyEntry" +
              (isCurrent ? " historyEntryCurrent" : "") +
              (e.hadSleep ? " historyEntryHadSleep" : "");
            const range = `${player.fmtTime(e.start)} → ${player.fmtTime(e.end)}`;
            return html`
              <div
                class=${cls}
                onClick=${(ev) => {
                  if (ev.target.closest(".historyEntryBtn")) return;
                  player.selectSourceAndEpisode(e.sourceId, e.episodeId, { autoplay: true });
                  isOpen.value = false;
                }}
              >
                <button
                  class="historyEntryBtn historyEntryBtnRestart"
                  title="Restart segment"
                  onClick=${(ev) => {
                    ev.stopPropagation();
                    player.selectSourceAndEpisode(e.sourceId, e.episodeId, { autoplay: true, startAt: e.start });
                    isOpen.value = false;
                  }}
                >
                  ↺
                </button>
                <button
                  class="historyEntryBtn historyEntryBtnContinue"
                  title="Continue from before end"
                  onClick=${(ev) => {
                    ev.stopPropagation();
                    player.selectSourceAndEpisode(e.sourceId, e.episodeId, { autoplay: true, startAt: Math.max(0, (e.end || 0) - 5) });
                    isOpen.value = false;
                  }}
                >
                  →
                </button>
                <div class="historyEntryTitle">${titleShort(e.episodeTitle, 50)}</div>
                <div class="historyEntrySub">${titleShort(e.channelTitle, 30)} · ${range}</div>
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}


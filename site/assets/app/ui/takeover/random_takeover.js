import { html } from "../../runtime/vendor.js";

export function RandomTakeover({ player, takeover }) {
  const curSourceId = player.current.value.source?.id || null;
  const curTitle = player.current.value.source?.title || curSourceId || "—";

  return html`
    <div class="guideBarTakeover" role="dialog" aria-label="Random options" onPointerDownCapture=${() => takeover.bump()} onKeyDownCapture=${() => takeover.bump()}>
      <div class="guideBarTakeoverHeader">
        <div class="guideBarTakeoverTitle">Random</div>
        <button class="guideBtn" title="Done" onClick=${() => takeover.close()}>Done</button>
      </div>
      <div class="guideBarTakeoverBody">
        <button
          class="guideBtn"
          title="Random episode from any channel"
          onClick=${async () => {
            await player.playRandom();
            takeover.close();
          }}
        >
          Any channel
        </button>
        <button
          class="guideBtn"
          disabled=${!curSourceId}
          aria-disabled=${curSourceId ? "false" : "true"}
          title=${curSourceId ? `Random episode from ${curTitle}` : "Pick a channel first"}
          onClick=${async () => {
            if (!curSourceId) return;
            await player.selectSource(curSourceId, { preserveEpisode: false, pickRandomEpisode: true, autoplay: true });
            takeover.close();
          }}
        >
          This channel
        </button>
      </div>
    </div>
  `;
}


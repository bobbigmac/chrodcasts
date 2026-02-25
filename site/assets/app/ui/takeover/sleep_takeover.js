import { html } from "../../runtime/vendor.js";

export function SleepTakeover({ player, takeover }) {
  const sleep = player.sleep.value;
  const opts = [5, 15, 30, 60];

  return html`
    <div class="guideBarTakeover" role="dialog" aria-label="Sleep timer" onPointerDownCapture=${() => takeover.bump()} onKeyDownCapture=${() => takeover.bump()}>
      <div class="guideBarTakeoverHeader">
        <div class="guideBarTakeoverTitle">Sleep</div>
        <button class="guideBtn" title="Done" onClick=${() => takeover.close()}>Done</button>
      </div>
      <div class="guideBarTakeoverBody">
        ${sleep.active ? html`<div class="takeoverHint">Remaining: ${sleep.label || "—"}</div>` : ""}
        <div class="takeoverOpts">
          ${opts.map(
            (mins) => html`
              <button
                class="guideBtn"
                title=${`Sleep ${mins} min`}
                onClick=${() => {
                  player.setSleepTimerMins(mins);
                  takeover.close();
                }}
              >
                ${mins === 60 ? "1 hr" : `${mins} min`}
              </button>
            `
          )}
          ${sleep.active
            ? html`
                <button
                  class="guideBtn"
                  title="Turn off sleep timer"
                  onClick=${() => {
                    player.clearSleepTimer();
                    takeover.close();
                  }}
                >
                  Off
                </button>
              `
            : ""}
        </div>
      </div>
    </div>
  `;
}


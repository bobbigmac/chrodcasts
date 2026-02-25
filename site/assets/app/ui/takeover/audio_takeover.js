import { html } from "../../runtime/vendor.js";

export function AudioTakeover({ takeover }) {
  return html`
    <div class="guideBarTakeover" role="dialog" aria-label="Audio" onPointerDownCapture=${() => takeover.bump()} onKeyDownCapture=${() => takeover.bump()}>
      <div class="guideBarTakeoverHeader">
        <div class="guideBarTakeoverTitle">Audio</div>
        <button class="guideBtn" title="Done" onClick=${() => takeover.close()}>Done</button>
      </div>
      <div class="guideBarTakeoverBody">
        <div class="takeoverHint">Coming soon: EQ, normalization, audio boost</div>
      </div>
    </div>
  `;
}


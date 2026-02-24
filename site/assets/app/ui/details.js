import { html } from "../runtime/vendor.js";
import { TimedComments } from "../vod/timed_comments.js";
import { LogPanel } from "./log.js";

export function DetailsPanel({ isOpen, env, player, log }) {
  const cur = player.current.value;
  const ep = cur.episode;
  const chapters = player.chapters.value || [];

  return html`
    <div id="detailsPanel" class="detailsPanel" aria-hidden=${isOpen.value ? "false" : "true"}>
      <div class="detailsHeader">
        <span>Details</span>
        <button id="btnCloseDetails" class="guideBtn" onClick=${() => (isOpen.value = false)}>✕</button>
      </div>
      <div class="detailsContent">
        <div id="epTitle" class="detailsTitle">${ep?.title || "—"}</div>
        <div id="epSub" class="detailsSub">
          ${ep ? `${ep.channelTitle || cur.source?.title || ""}${ep.dateText ? " · " + ep.dateText : ""}` : "—"}
        </div>
        <div id="epDesc" class="detailsDesc" dangerouslySetInnerHTML=${{ __html: ep?.descriptionHtml || "" }}></div>

        <div class="detailsSplit">
          <div class="detailsChapters">
            <div class="detailsChaptersTitle">Chapters</div>
            <div id="chapters" class="chapters">
              ${chapters.map(
                (ch) => html`
                  <div
                    class="ch"
                    onClick=${() => {
                      player.seekToTime(ch.t || 0);
                      player.play({ userGesture: true });
                    }}
                  >
                    <div class="chName">${ch.name || "Chapter"}</div>
                    <div class="chTime">${player.fmtTime(ch.t)}</div>
                  </div>
                `
              )}
            </div>
          </div>
          <div class="detailsComments">
            <div class="detailsCommentsTitle">Comments</div>
            <div id="commentsPanel" class="commentsPanel">
              <${TimedComments} env=${env} player=${player} isActive=${isOpen.value} />
            </div>
          </div>
        </div>

        <${LogPanel} log=${log} />
      </div>
    </div>
  `;
}

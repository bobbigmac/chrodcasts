import { html, useEffect, useMemo, useRef, useSignal, useSignalEffect } from "../runtime/vendor.js";
import { GuidePanel } from "../ui/guide.js";
import { DetailsPanel } from "../ui/details.js";
import { HistoryPanel } from "../ui/history.js";
import { StatusToast } from "../ui/status_toast.js";

export function App({ env, log, sources, player, history }) {
  const guideOpen = useSignal(false);
  const detailsOpen = useSignal(false);
  const historyOpen = useSignal(false);
  const sleepMenuOpen = useSignal(false);
  const toast = useSignal({ show: false, msg: "", level: "info", ms: 2200 });

  const videoRef = useRef(null);
  const guideBarRef = useRef(null);
  const progressRef = useRef(null);

  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    const updatePos = (clientX) => {
      const r = el.getBoundingClientRect();
      const pct = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
      el.style.setProperty("--scrubber-x", `${pct}%`);
    };
    const onMove = (e) => {
      const x = e.touches ? e.touches[0]?.clientX : e.clientX;
      if (x != null) updatePos(x);
    };
    const onLeave = () => el.style.removeProperty("--scrubber-x");
    el.addEventListener("mousemove", onMove, { passive: true });
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onLeave);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      player.attachVideo(videoRef.current);
      log.info("Video ready");
    }
  }, []);

  // Theme
  useEffect(() => {
    const THEME_KEY = "vodcasts_theme_v1";
    const htmlRoot = document.getElementById("htmlRoot") || document.documentElement;
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) htmlRoot.dataset.theme = savedTheme;
  }, []);

  const toggleTheme = () => {
    const THEME_KEY = "vodcasts_theme_v1";
    const htmlRoot = document.getElementById("htmlRoot") || document.documentElement;
    const cur = htmlRoot?.dataset?.theme || "modern";
    const next = cur === "modern" ? "dos" : "modern";
    if (htmlRoot) htmlRoot.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  };

  // Escape closes panels.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (guideOpen.value) guideOpen.value = false;
      if (detailsOpen.value) detailsOpen.value = false;
      if (historyOpen.value) historyOpen.value = false;
      if (sleepMenuOpen.value) sleepMenuOpen.value = false;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the sleep menu.
  useEffect(() => {
    const onClick = () => {
      if (sleepMenuOpen.value) sleepMenuOpen.value = false;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Brief status toast (mirrors the latest log entry).
  useSignalEffect(() => {
    const list = log.entries.value || [];
    const last = list[list.length - 1];
    if (!last) return;
    toast.value = { show: true, msg: last.msg, level: last.level || "info", ms: 2200 };
  });

  // Guide bar idle fade.
  useEffect(() => {
    const el = guideBarRef.current;
    if (!el) return;
    const GUIDE_IDLE_MS = 3000;
    let idleTo = Date.now() + GUIDE_IDLE_MS;
    const reset = () => {
      idleTo = Date.now() + GUIDE_IDLE_MS;
      el.classList.remove("idle");
    };
    const tick = () => {
      if (Date.now() > idleTo) el.classList.add("idle");
      requestAnimationFrame(tick);
    };
    tick();
    ["mousemove", "mousedown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
    return () => {
      ["mousemove", "mousedown", "keydown", "touchstart"].forEach((ev) => document.removeEventListener(ev, reset));
    };
  }, []);

  const cur = player.current.value;
  const pb = player.playback.value;
  const cap = player.captions.value;
  const sleep = player.sleep.value;
  const audioBlocked = player.audioBlocked.value;
  const rateLabel = useMemo(() => {
    const r = Number(pb.rate) > 0 ? Number(pb.rate) : 1;
    return (Math.round(r * 100) / 100).toString().replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1") + "x";
  }, [pb.rate]);

  useEffect(() => {
    if (!cur?.source?.id) return;
    const s = cur.source.title || cur.source.id;
    const e = cur.episode?.title ? ` — ${cur.episode.title}` : "";
    log.info(`Now: ${s}${e}`);
  }, [cur?.source?.id, cur?.episode?.id]);

  const srcTitle = cur.source?.title || cur.source?.id || "—";
  const epTitle = cur.episode?.title || "—";
  const timeLabel = useMemo(() => {
    const curT = pb.time || 0;
    const dur = pb.duration;
    return `${player.fmtTime(curT)}${Number.isFinite(dur) ? " / " + player.fmtTime(dur) : ""}`;
  }, [pb.time, pb.duration, cur.episode?.id]);

  const pct = useMemo(() => {
    const dur = pb.duration;
    if (!Number.isFinite(dur) || dur <= 0) return 0;
    return Math.min(100, (pb.time / dur) * 100);
  }, [pb.time, pb.duration]);

  const onSeekBarClick = (ev, el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const pct01 = Math.min(1, Math.max(0, x / r.width));
    player.seekToPct(pct01);
  };

  return html`
    <div class="app-inner">
      <${StatusToast} toast=${toast} />
      <div class="player" id="player">
        <video id="video" playsinline ref=${videoRef}></video>
        <div
          class=${"playPauseOverlay" + (pb.paused ? " visible" : "")}
          onClick=${(e) => { e.stopPropagation(); player.togglePlay(); }}
          aria-hidden=${pb.paused ? "false" : "true"}
        >
          <span class="playPauseIcon">
            <span class="iconPause">❚❚</span>
            <span class="iconPlay">▶</span>
          </span>
        </div>
        <div class="progress" id="progress" ref=${progressRef} title="Seek" onClick=${(e) => { e.stopPropagation(); onSeekBarClick(e, e.currentTarget); }}>
          <div class="progressFill" id="progressFill" style=${{ width: `${pct}%` }}></div>
        </div>
      </div>

      <div
        class="guideBar"
        id="guideBar"
        ref=${guideBarRef}
        onClick=${(e) => {
          e.stopPropagation();
          if (sleepMenuOpen.value) sleepMenuOpen.value = false;
        }}
      >
        <div class="guideBar-inner">
          <div class="guideBar-row1">
            <button id="btnSeekBack" class="guideBtn guideBtnSeek" title="-10s" onClick=${() => player.seekBy(-10)}>−10</button>
            <button id="btnSeekFwd" class="guideBtn guideBtnSeek" title="+30s" onClick=${() => player.seekBy(30)}>+30</button>
            <div class="guideNowBlock" title="Channels" onClick=${() => (guideOpen.value = true)}>
              <div class="guideChannel" id="guideChannel">${srcTitle}</div>
              <div class="guideNow" id="guideNow">${epTitle}</div>
            </div>
          <button
            id="btnCC"
            class=${"guideBtn" + (cap.showing ? " active" : "")}
            title="Subtitles"
            aria-label="Subtitles"
            style=${{ display: cap.available ? "" : "none" }}
            onClick=${() => player.toggleCaptions()}
          >
            CC
          </button>
          <button id="btnPlay" class="guideBtn" title="Play/Pause" onClick=${() => player.togglePlay()}>
            ${pb.paused ? "▶" : "❚❚"}
          </button>
          <div
            class=${"volumeControl" + (audioBlocked ? " audioBlocked" : "") + (pb.muted && !audioBlocked ? " muted" : "")}
            title=${audioBlocked ? "Click video or Play to enable sound (browser restriction)" : pb.muted ? "Muted" : "Volume"}
          >
            <button class="volumeBtn volumeUp" title="Volume up" onClick=${() => player.volumeUp()}>+</button>
            <span class="volumeLevel" data-state=${audioBlocked ? "blocked" : pb.muted ? "muted" : "on"}>
              ${audioBlocked ? "blocked" : pb.muted ? "M" : Math.round((pb.volume ?? 1) * 100)}
            </span>
            <button class="volumeBtn volumeDown" title="Volume down" onClick=${() => player.volumeDown()}>−</button>
            ${audioBlocked ? html`<span class="volumeHint">Tap to unmute</span>` : ""}
          </div>
          </div>
          <div class="guideBar-row2">
          <button id="btnRandom" class="guideBtn" title="Random" onClick=${() => player.playRandom()}>Random</button>
          <div class="speedControl" title="Playback speed">
            <button class="speedBtn speedDown" title="Slower" onClick=${() => player.rateDown()}>−</button>
            <button class="speedBtn speedLevel" title="Click to toggle 1× / last speed" onClick=${() => player.toggleRate()}>${rateLabel}</button>
            <button class="speedBtn speedUp" title="Faster" onClick=${() => player.rateUp()}>+</button>
          </div>
          <div class="guideBar-sleep">
            <button
              id="btnSleep"
              class="guideBtn"
              title="Sleep timer"
              onClick=${(e) => {
                e.stopPropagation();
                if (sleep.active) return player.clearSleepTimer();
                sleepMenuOpen.value = !sleepMenuOpen.value;
              }}
            >
              ${sleep.label || "Sleep"}
            </button>
            <div
              id="sleepMenu"
              class="sleepMenu"
              aria-hidden=${sleepMenuOpen.value ? "false" : "true"}
              onClick=${(e) => e.stopPropagation()}
            >
              ${[5, 15, 30, 60].map(
                (mins) => html`
                  <button
                    class="sleepOpt"
                    data-mins=${String(mins)}
                    onClick=${(e) => {
                      e.stopPropagation();
                      player.setSleepTimerMins(mins);
                      sleepMenuOpen.value = false;
                    }}
                  >
                    ${mins === 60 ? "1 hr" : `${mins} min`}
                  </button>
                `
              )}
            </div>
          </div>
          <button id="btnTheme" class="guideBtn" title="Theme" onClick=${toggleTheme}>Theme</button>
          </div>
        </div>
      </div>

      <${GuidePanel} isOpen=${guideOpen} sources=${sources} player=${player} />
      <${HistoryPanel} isOpen=${historyOpen} history=${history} player=${player} />
      <${DetailsPanel} isOpen=${detailsOpen} env=${env} player=${player} log=${log} />

      <button id="btnHistory" class="cornerBtn cornerBtnLeft" title="History" onClick=${() => (historyOpen.value = !historyOpen.value)}>
        ☰
      </button>
      <button id="btnDetails" class="cornerBtn" title="Details" onClick=${() => (detailsOpen.value = !detailsOpen.value)}>⋯</button>
    </div>
  `;
}

// Supabase timed comments (ported from `video-podcasts/supabase-timed-comments.html`).

function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function stableContentId(source, episode) {
  const sid = source?.id || "unknown";
  const eid = episode?.id || "unknown";
  return `vodcasts:${sid}:${eid}`;
}

function ensureHcaptchaLoaded() {
  return new Promise((resolve) => {
    if (window.hcaptcha) return resolve();
    window.onHCaptchaLoad = function () {
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://js.hcaptcha.com/1/api.js?onload=onHCaptchaLoad&render=explicit";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  });
}

export function createComments({ env, els, log, player }) {
  const site = env.site || {};
  const cfg = site.comments || {};

  const statusEl = document.getElementById("commentsStatus");
  const listEl = document.getElementById("commentsList");
  const form = document.getElementById("commentsForm");
  const nameEl = document.getElementById("commentName");
  const bodyEl = document.getElementById("commentBody");
  const btn = document.getElementById("commentSubmit");
  const tlabel = document.getElementById("commentTime");
  const captchaWrap = document.getElementById("commentsCaptchaWrap");
  const captchaBtn = document.getElementById("captchaBtn");

  let supabase = null;
  let contentId = null;
  let anonReady = false;
  let channelSub = null;
  let captchaWidgetId = null;
  let captchaDoneResolve = null;
  let captchaDonePromise = null;

  const setStatus = (s) => {
    if (statusEl) statusEl.textContent = s;
  };

  function render(rows) {
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const r of rows) {
      const div = document.createElement("div");
      div.className = "commentRow";

      const meta = document.createElement("div");
      meta.className = "commentMeta";

      const t = document.createElement("span");
      t.className = "commentTime";
      t.textContent = fmtTime(r.t_seconds);
      t.title = "jump to time";
      t.onclick = () => {
        const v = els.video;
        v.currentTime = r.t_seconds;
        v.play().catch(() => {});
      };

      const who = document.createElement("span");
      who.textContent = r.name ? r.name : "anon";

      const when = document.createElement("span");
      when.textContent = new Date(r.created_at).toLocaleString();

      meta.append(t, who, when);

      const body = document.createElement("div");
      body.className = "commentBody";
      body.textContent = r.body;

      div.append(meta, body);
      listEl.appendChild(div);
    }
  }

  async function load() {
    if (!supabase || !contentId) return;
    const { data, error } = await supabase
      .from("timed_comments")
      .select("id,t_seconds,name,body,created_at")
      .eq("content_id", contentId)
      .order("t_seconds", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    render(data ?? []);
  }

  async function ensureClient() {
    if (supabase) return supabase;
    if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) return null;
    const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    supabase = mod.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return supabase;
  }

  async function initCaptchaIfNeeded() {
    if (!cfg?.hcaptchaSitekey) return null;
    if (captchaWidgetId) return captchaWidgetId;
    await ensureHcaptchaLoaded();
    if (!captchaWrap) return null;
    captchaWrap.hidden = false;
    captchaDonePromise = new Promise((r) => {
      captchaDoneResolve = r;
    });
    captchaWidgetId = hcaptcha.render("hcaptcha-container", {
      sitekey: cfg.hcaptchaSitekey,
      size: "invisible",
      callback: (token) => captchaDoneResolve(token),
      "error-callback": () => captchaDoneResolve(null),
    });
    return captchaWidgetId;
  }

  async function ensureAnon() {
    const sb = await ensureClient();
    if (!sb) return;
    const { data: sess } = await sb.auth.getSession();
    if (sess?.session) return;

    if (cfg?.hcaptchaSitekey) {
      await initCaptchaIfNeeded();
      setStatus("click Continue…");
      captchaBtn.onclick = () => {
        captchaBtn.disabled = true;
        setStatus("verifying…");
        hcaptcha.execute(captchaWidgetId);
      };
      const token = await captchaDonePromise;
      captchaBtn.style.display = "none";
      if (!token) throw new Error("Captcha required");
      const { error } = await sb.auth.signInAnonymously({ options: { captchaToken: token } });
      if (error) throw error;
      return;
    }

    const { error } = await sb.auth.signInAnonymously();
    if (error) throw error;
  }

  function attachForm() {
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!anonReady || !supabase || !contentId) return;
      btn.disabled = true;
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const payload = {
          content_id: contentId,
          t_seconds: Math.max(0, Math.floor(els.video.currentTime || 0)),
          name: nameEl.value.trim() || null,
          body: bodyEl.value.trim(),
          user_id: userData.user.id,
        };
        if (!payload.body) return;
        const { error } = await supabase.from("timed_comments").insert(payload);
        if (error) throw error;
        bodyEl.value = "";
        await load();
      } finally {
        btn.disabled = false;
      }
    });
  }

  function wireVideoTimeLabel() {
    els.video?.addEventListener("timeupdate", () => {
      if (tlabel) tlabel.textContent = fmtTime(els.video.currentTime);
    });
  }

  attachForm();
  wireVideoTimeLabel();

  async function startForContent(newContentId) {
    contentId = newContentId;
    anonReady = false;

    if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey) {
      if (form) form.hidden = true;
      if (captchaWrap) captchaWrap.hidden = true;
      setStatus("comments disabled");
      return;
    }

    try {
      setStatus("signing in…");
      await ensureAnon();
      anonReady = true;
      if (form) form.hidden = false;
      if (btn) btn.disabled = false;
      setStatus("loading…");
      await load();
      setStatus(contentId);

      channelSub?.unsubscribe?.();
      channelSub = supabase
        .channel(`timed_comments:${contentId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "timed_comments", filter: `content_id=eq.${contentId}` }, () => load())
        .subscribe();
    } catch (err) {
      console.error(err);
      setStatus("error (check console)");
    }
  }

  return {
    setEpisode: (source, episode) => {
      if (!source?.id || !episode?.id) {
        setStatus("select an episode");
        if (form) form.hidden = true;
        if (captchaWrap) captchaWrap.hidden = true;
        return;
      }
      const next = stableContentId(source, episode);
      if (next === contentId) return;
      startForContent(next);
    },
  };
}

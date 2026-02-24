export function createLogger(containerEl) {
  const LOG_MAX = 200;
  const entries = [];

  function append(msg, level = "info") {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const entry = { ts, msg: String(msg), level };
    entries.push(entry);
    if (entries.length > LOG_MAX) entries.shift();
    if (!containerEl) return;
    const div = document.createElement("div");
    div.className = `logEntry ${level}`;
    div.textContent = `[${ts}] ${msg}`;
    containerEl.appendChild(div);
    containerEl.scrollTop = containerEl.scrollHeight;
  }

  return {
    entries: () => entries.slice(),
    info: (m) => append(m, "info"),
    warn: (m) => append(m, "warn"),
    error: (m) => append(m, "error"),
    clear: () => {
      entries.splice(0, entries.length);
      if (containerEl) containerEl.innerHTML = "";
    },
  };
}


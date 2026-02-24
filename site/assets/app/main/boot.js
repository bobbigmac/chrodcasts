import { getEnv } from "../runtime/env.js";
import { createLogger } from "../runtime/log.js";
import { createStore } from "../runtime/store.js";
import { loadSources } from "../vod/sources.js";
import { createAppController } from "./controller.js";

export async function bootApp() {
  const env = getEnv();
  const log = createLogger(document.getElementById("logOutput"));
  const store = createStore({
    env,
    sources: [],
    current: { sourceId: null, episodeId: null },
    ui: { theme: "modern" },
  });

  const sources = await loadSources(env);
  store.update((s) => ({ ...s, sources }));

  createAppController({ env, store, log });
}


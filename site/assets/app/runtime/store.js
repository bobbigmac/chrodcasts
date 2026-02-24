export function createStore(initialState) {
  let state = initialState;
  const subs = new Set();

  function getState() {
    return state;
  }

  function update(updater) {
    const next = typeof updater === "function" ? updater(state) : updater;
    state = next;
    for (const fn of subs) fn(state);
  }

  function subscribe(fn) {
    subs.add(fn);
    try {
      fn(state);
    } catch (_e) {}
    return () => subs.delete(fn);
  }

  return { getState, update, subscribe };
}

const VIEW_KEY = "spotidraft.homeViewMode";

export function loadHomeViewMode() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === "list") return "list";
    return "grid";
  } catch {
    return "grid";
  }
}

export function saveHomeViewMode(mode) {
  const next = mode === "list" ? "list" : "grid";
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

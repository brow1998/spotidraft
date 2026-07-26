const KEY = "spotidraft.sidebarCollapsed";

/** Sidebar starts open; the choice sticks once the user makes one. */
export function loadSidebarCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* best effort */
  }
}

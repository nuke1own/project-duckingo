(function () {
  const KEY = "duckingo.sidebarCollapsed";
  const app = document.getElementById("app");
  const btn = document.getElementById("sidebar-toggle");
  const menuBtn = document.getElementById("menu-btn");
  if (!app) return;

  const apply = (collapsed) => {
    app.classList.toggle("sidebar-collapsed", collapsed);
    if (btn) {
      btn.setAttribute("aria-expanded", String(!collapsed));
      btn.setAttribute("aria-label", collapsed ? "Expand tools" : "Collapse tools");
      btn.textContent = collapsed ? "›" : "‹";
    }
    try {
      localStorage.setItem(KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  try {
    apply(localStorage.getItem(KEY) === "1");
  } catch {
    apply(false);
  }

  btn?.addEventListener("click", () => apply(!app.classList.contains("sidebar-collapsed")));
  menuBtn?.addEventListener("click", () => {
    const open = app.classList.toggle("nav-open");
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });
  const close = () => {
    app.classList.remove("nav-open");
    menuBtn?.setAttribute("aria-expanded", "false");
    menuBtn?.setAttribute("aria-label", "Open menu");
  };
  app.querySelectorAll(".nav__link, .tool-item").forEach((link) => link.addEventListener("click", close));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
})();

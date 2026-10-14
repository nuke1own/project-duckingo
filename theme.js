(() => {
  const KEY = "duckingo.theme.v2";
  const root = document.documentElement;
  const current = () => root.dataset.theme === "dark" ? "dark" : "light";
  const preferred = () => {
    try { return localStorage.getItem(KEY) || "light"; } catch { return "light"; }
  };
  const apply = (theme, persist = true) => {
    root.dataset.theme = theme;
    if (persist) {
      try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    }
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      const dark = theme === "dark";
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      const label = button.querySelector(".theme-toggle__label");
      if (label) label.textContent = dark ? "Light" : "Dark";
      const icon = button.querySelector("[aria-hidden]");
      if (icon) icon.textContent = dark ? "☀" : "◐";
    });
  };

  const ensureControl = () => {
    const inner = document.querySelector(".nav__inner");
    if (!inner || document.getElementById("theme-toggle")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle";
    button.id = "theme-toggle";
    button.innerHTML = '<span aria-hidden="true">◐</span><span class="theme-toggle__label">Dark</span>';
    inner.insertBefore(button, inner.querySelector(".nav__links"));
  };

  let observer = null;
  const bindControls = () => {
    ensureControl();
    apply(current(), false);
    document.querySelectorAll(".theme-toggle:not([data-theme-bound])").forEach((button) => {
      button.dataset.themeBound = "true";
      button.addEventListener("click", () => apply(current() === "dark" ? "light" : "dark"));
    });
    if (document.querySelector(".theme-toggle")) observer?.disconnect();
  };
  apply(preferred(), false);
  bindControls();
  observer = new MutationObserver(bindControls);
  observer.observe(document.body, { childList: true, subtree: true });
})();

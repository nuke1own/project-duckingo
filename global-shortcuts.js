(() => {
  const isModifier = (event) => event.metaKey || event.ctrlKey;
  const focusChat = () => {
    const input = document.getElementById("composer-input");
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  };

  document.addEventListener("keydown", (event) => {
    if (isModifier(event) && event.key.toLowerCase() === "k") {
      if (focusChat()) event.preventDefault();
      return;
    }
    if (isModifier(event) && event.shiftKey && event.key.toLowerCase() === "n") {
      const newChat = document.getElementById("new-chat-btn");
      if (newChat) {
        event.preventDefault();
        newChat.click();
      }
      return;
    }
    if (event.altKey && /^[1-5]$/.test(event.key)) {
      const link = document.querySelectorAll(".nav__link")[Number(event.key) - 1];
      if (link instanceof HTMLElement) {
        event.preventDefault();
        link.click();
      }
    }
  });
})();

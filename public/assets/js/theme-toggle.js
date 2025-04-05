(() => {
  // <stdin>
  var themeToggleBtn = document.getElementById("theme-toggle-btn");
  var currentTheme = document.documentElement.getAttribute("data-theme");
  themeToggleBtn.textContent = currentTheme === "dark" ? "\u2734" : "\u263E";
  themeToggleBtn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "light");
      themeToggleBtn.textContent = "\u263E";
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      themeToggleBtn.textContent = "\u2734";
      localStorage.setItem("theme", "dark");
    }
  });
})();

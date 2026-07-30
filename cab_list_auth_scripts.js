({
  scripts: [...document.scripts]
    .map((script) => script.src)
    .filter((src) => /sam|auth|login/i.test(src)),
  storageKeys: {
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  },
  cookiesPresent: document.cookie
    .split(";")
    .map((entry) => entry.split("=")[0].trim())
    .filter(Boolean),
});

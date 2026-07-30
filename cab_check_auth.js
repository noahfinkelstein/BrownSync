({
  url: location.href,
  bodyClass: document.body.className,
  sam: {
    mode: typeof sam !== "undefined" ? sam.auth.getMode() : null,
    hasToken: typeof sam !== "undefined" && Boolean(sam.auth.token),
    authenticated: typeof sam !== "undefined" ? sam.user.isAuthenticated() : false,
    authWindowOpen:
      typeof sam !== "undefined" && Boolean(sam.auth.authWindow && !sam.auth.authWindow.closed),
  },
  signInVisible: [...document.querySelectorAll("a, button")].some((element) =>
    /sign in/i.test(element.textContent || ""),
  ),
});

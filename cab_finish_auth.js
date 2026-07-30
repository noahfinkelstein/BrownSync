await sam.user.fetch();
({
  authenticated: sam.user.isAuthenticated(),
  bodyClass: document.body.className,
});

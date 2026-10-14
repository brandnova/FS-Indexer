// Runs before the page is painted, so the chosen theme never flashes.
(function () {
  try {
    var t = localStorage.getItem('fsagent.theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) { /* private mode: follow the system */ }
})();
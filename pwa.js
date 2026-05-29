/* Twin — PWA bootstrap (non-module, sets globals like voice.js)
 * Phase 1: register the service worker for offline + installability.
 * Phase 2 (push subscription helpers) will be added here.
 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      console.warn('[pwa] service worker registration failed:', err);
    });
  });
})();

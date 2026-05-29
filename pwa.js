/* Twin — PWA bootstrap (non-module, sets window globals like voice.js)
 * - Registers the service worker for offline + installability.
 * - Exposes window.twinPush for subscribe/unsubscribe.
 */
(function () {
  const VAPID_PUBLIC_KEY = 'BAct4wJ6xKi6ZCENBdGF14cNs3lI5F8QkOq-mraGOkIEh45BFLHb4NkZ6hoywyzZeH4FzEz1k1RX1fPgGveyvws';
  const WORKER_URL = 'https://task-intake-worker.ntsarapaeva.workers.dev';

  // Register service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('[pwa] sw registration failed:', err);
      });
    });
  }

  function getDeviceId() {
    let id = localStorage.getItem('pushDeviceId');
    if (!id) {
      id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('pushDeviceId', id);
    }
    return id;
  }

  function urlB64ToUint8(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }

  window.twinPush = {
    async subscribe() {
      if (!('PushManager' in window)) { alert('Push notifications not supported in this browser.'); return false; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Notification permission denied. Please allow it in browser settings.'); return false; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY)
        });
        await fetch(WORKER_URL + '/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: getDeviceId(), subscription: sub.toJSON() })
        });
        return true;
      } catch (e) {
        console.error('[pwa] subscribe failed:', e);
        alert('Failed to subscribe: ' + e.message);
        return false;
      }
    },

    async unsubscribe() {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
        await fetch(WORKER_URL + '/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: getDeviceId() })
        });
        return true;
      } catch (e) {
        console.error('[pwa] unsubscribe failed:', e);
        return false;
      }
    },

    async isSubscribed() {
      if (!('PushManager' in window)) return false;
      try {
        const reg = await navigator.serviceWorker.ready;
        return !!(await reg.pushManager.getSubscription());
      } catch (_) { return false; }
    }
  };
})();

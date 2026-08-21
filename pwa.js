(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(
        './service-worker.js',
        { scope: './' }
      );

      // Ask a newly-installed worker to activate as soon as possible.
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;

        worker.addEventListener('statechange', () => {
          if (
            worker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    } catch (error) {
      console.warn('Draft War Room PWA registration failed:', error);
    }
  });
})();

(() => {
  const sessions = window.BALLET_EVENT_CONTENT?.sessions ?? {};

  document.querySelectorAll('[data-session]').forEach((button) => {
    const url = sessions[button.dataset.session];
    if (typeof url !== 'string' || !url.trim()) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(url, window.location.href);
    } catch {
      return;
    }

    if (!['https:', 'http:'].includes(parsedUrl.protocol)) return;

    const link = document.createElement('a');
    link.className = button.className;
    link.href = parsedUrl.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${button.textContent.trim()} — comprar ingresso`);
    link.innerHTML = button.innerHTML;
    button.replaceWith(link);
  });

  const viewport = document.querySelector('.viewport');
  viewport?.setAttribute('aria-busy', 'true');

  const waitForImage = async (image) => {
    if (!image.complete) {
      await new Promise((resolve) => {
        const settle = () => {
          image.removeEventListener('load', settle);
          image.removeEventListener('error', settle);
          resolve();
        };
        image.addEventListener('load', settle, { once: true });
        image.addEventListener('error', settle, { once: true });
        if (image.complete) settle();
      });
    }

    if (image.naturalWidth > 0 && typeof image.decode === 'function') {
      await image.decode().catch(() => {});
    }
  };

  Promise.all(Array.from(document.images, waitForImage)).finally(() => {
    document.documentElement.classList.remove('is-loading');
    viewport?.setAttribute('aria-busy', 'false');
    document.querySelector('.page-loader')?.setAttribute('hidden', '');
  });
})();

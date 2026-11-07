(() => {
  const consentKey = 'alusa.cookie-consent.v1';
  const anonymousKey = 'alusa.anonymous-id';
  const consentEvent = 'alusa-cookie-consent-updated';
  const policyVersion = '2026-05-27';
  const pixelId = '1081285171574725';
  const consentBanner = document.querySelector('[data-cookie-consent]');

  const readConsent = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(consentKey) || 'null');
      return value?.policyVersion === policyVersion ? value : null;
    } catch { return null; }
  };

  const loadPixel = () => {
    if (readConsent()?.categories?.marketing !== true || window.fbq) return;
    const queue = [];
    const fbq = (...args) => queue.push(args);
    fbq.queue = queue;
    fbq.loaded = true;
    fbq.version = '2.0';
    window.fbq = fbq;
    window._fbq = fbq;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
    fbq('init', pixelId);
    fbq('track', 'PageView');
  };

  const storedConsent = readConsent();
  if (!storedConsent) consentBanner?.removeAttribute('hidden');
  else loadPixel();

  const persistConsent = async (marketing, decision) => {
    const acceptedAll = decision === 'ACCEPT_ALL';
    const categories = {
      essential: true,
      analytics: acceptedAll,
      marketing,
      preferences: acceptedAll,
    };
    const stored = { policyVersion, categories, decidedAt: new Date().toISOString() };
    try { window.localStorage.setItem(consentKey, JSON.stringify(stored)); } catch {}
    window.dispatchEvent(new CustomEvent(consentEvent, { detail: stored }));
    consentBanner?.setAttribute('hidden', '');
    let anonymousId;
    try {
      anonymousId = window.localStorage.getItem(anonymousKey);
      if (!anonymousId) {
        anonymousId = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        window.localStorage.setItem(anonymousKey, anonymousId);
      }
    } catch {}
    await fetch('/api/privacy/cookie-consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anonymousId, categories, decision, policyVersion }),
    }).catch(() => undefined);
  };

  document.querySelector('[data-cookie-accept]')?.addEventListener('click', () => {
    void persistConsent(true, 'ACCEPT_ALL');
  });
  document.querySelector('[data-cookie-reject]')?.addEventListener('click', () => {
    void persistConsent(false, 'REJECT_NON_ESSENTIAL');
  });
  window.addEventListener(consentEvent, loadPixel);

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

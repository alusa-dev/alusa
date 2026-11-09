(() => {
  const consentKey = 'alusa.cookie-consent.v1';
  const anonymousKey = 'alusa.anonymous-id';
  const consentEvent = 'alusa-cookie-consent-updated';
  const policyVersion = '2026-05-27';
  const pixelId = '1081285171574725';
  const consentBanner = document.querySelector('[data-cookie-consent]');
  const manageCookiesLink = document.querySelector('[data-cookie-manage]');

  const readConsent = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(consentKey) || 'null');
      return value?.policyVersion === policyVersion ? value : null;
    } catch { return null; }
  };

  const loadPixel = () => {
    if (readConsent()?.categories?.marketing !== true) {
      if (window.fbq) window.fbq('consent', 'revoke');
      return;
    }
    if (window.fbq) {
      window.fbq('consent', 'grant');
      return;
    }
    const queue = [];
    const fbq = (...args) => {
      if (fbq.callMethod) fbq.callMethod.apply(fbq, args);
      else queue.push(args);
    };
    fbq.push = fbq;
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
  if (!storedConsent) {
    consentBanner?.removeAttribute('hidden');
    manageCookiesLink?.setAttribute('hidden', '');
  } else {
    manageCookiesLink?.removeAttribute('hidden');
    loadPixel();
  }

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
    manageCookiesLink?.removeAttribute('hidden');
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

    const allowedParams = new URLSearchParams();
    let count = 0;
    for (const [key, value] of new URLSearchParams(window.location.search)) {
      if (count >= 7 || value.length > 1024) continue;
      const isUtm = /^utm_[a-z0-9_]{1,32}$/.test(key) && value.length <= 200 && /^[\p{L}\p{N} ._~:/+-]{1,200}$/u.test(value);
      const isFbclid = key === 'fbclid' && /^[A-Za-z0-9_-]{1,1024}$/.test(value);
      if (!isUtm && !isFbclid) continue;
      allowedParams.append(key, value);
      count += 1;
    }
    for (const [key, value] of allowedParams) parsedUrl.searchParams.set(key, value);
    button.href = parsedUrl.href;
    button.setAttribute('aria-label', `${button.textContent.trim()} — comprar ingresso`);
    button.addEventListener('click', () => {
      if (readConsent()?.categories?.marketing === true && typeof window.fbq === 'function') {
        window.fbq('trackCustom', 'SelectSession', { session: button.dataset.session });
      }
    });
  });
})();

(() => {
  const consentKey = 'alusa.cookie-consent.v1';
  const anonymousKey = 'alusa.anonymous-id';
  const consentEvent = 'alusa-cookie-consent-updated';
  const policyVersion = '2026-05-27';
  const pixelId = '1081285171574725';
  const consentBanner = document.querySelector('[data-cookie-consent]');
  const manageCookiesLink = document.querySelector('[data-cookie-manage]');
  const syncStatusMessage = document.querySelector('[data-cookie-sync-status]');
  const retryButton = document.querySelector('[data-cookie-retry]');
  const consentButtons = [...document.querySelectorAll('[data-cookie-accept], [data-cookie-reject]')];

  const readConsent = () => {
    try {
      const value = JSON.parse(window.localStorage.getItem(consentKey) || 'null');
      return value?.policyVersion === policyVersion ? value : null;
    } catch { return null; }
  };

  const loadPixel = () => {
    const consent = readConsent();
    if (consent?.syncStatus !== 'SYNCED' || consent?.categories?.marketing !== true) {
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
  if (storedConsent?.syncStatus === 'SYNCED') {
    manageCookiesLink?.removeAttribute('hidden');
    consentBanner?.setAttribute('hidden', '');
  } else {
    if (storedConsent) {
      storedConsent.syncStatus = 'FAILED';
      try { window.localStorage.setItem(consentKey, JSON.stringify(storedConsent)); } catch {}
      if (syncStatusMessage) {
        syncStatusMessage.textContent = 'Sua escolha continua aplicada neste navegador, mas ainda não foi confirmada no servidor. O marketing permanece desativado até a confirmação.';
        syncStatusMessage.removeAttribute('hidden');
      }
      retryButton?.removeAttribute('hidden');
    }
    consentBanner?.removeAttribute('hidden');
    manageCookiesLink?.setAttribute('hidden', '');
  }
  loadPixel();

  const saveConsent = async (stored) => {
    const pending = { ...stored, syncStatus: 'PENDING' };
    try { window.localStorage.setItem(consentKey, JSON.stringify(pending)); } catch {}
    window.dispatchEvent(new CustomEvent(consentEvent, { detail: pending }));
    if (syncStatusMessage) {
      syncStatusMessage.textContent = 'Salvando suas preferências…';
      syncStatusMessage.removeAttribute('hidden');
    }
    retryButton?.setAttribute('hidden', '');
    consentButtons.forEach((button) => { button.disabled = true; });
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
    let syncStatus = 'SYNCED';
    try {
      const response = await fetch('/api/privacy/cookie-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anonymousId, categories: stored.categories, decision: stored.decision, policyVersion }),
      });
      if (!response.ok) throw new Error('COOKIE_CONSENT_SYNC_FAILED');
    } catch {
      syncStatus = 'FAILED';
    }
    const saved = { ...pending, syncStatus };
    try { window.localStorage.setItem(consentKey, JSON.stringify(saved)); } catch {}
    window.dispatchEvent(new CustomEvent(consentEvent, { detail: saved }));
    consentButtons.forEach((button) => { button.disabled = false; });
    if (syncStatus === 'SYNCED') {
      syncStatusMessage?.setAttribute('hidden', '');
      retryButton?.setAttribute('hidden', '');
      consentBanner?.setAttribute('hidden', '');
      manageCookiesLink?.removeAttribute('hidden');
    } else {
      if (syncStatusMessage) {
        syncStatusMessage.textContent = 'Não foi possível confirmar suas preferências no servidor. Sua escolha continua aplicada neste navegador, mas o marketing permanece desativado até a confirmação.';
      }
      retryButton?.removeAttribute('hidden');
      consentBanner?.removeAttribute('hidden');
    }
    return syncStatus === 'SYNCED';
  };

  const persistConsent = (marketing, decision) => {
    const acceptedAll = decision === 'ACCEPT_ALL';
    const stored = {
      policyVersion,
      categories: { essential: true, analytics: acceptedAll, marketing, preferences: acceptedAll },
      decidedAt: new Date().toISOString(),
      decision,
    };
    return saveConsent(stored);
  };

  document.querySelector('[data-cookie-accept]')?.addEventListener('click', () => {
    void persistConsent(true, 'ACCEPT_ALL');
  });
  document.querySelector('[data-cookie-reject]')?.addEventListener('click', () => {
    void persistConsent(false, 'REJECT_NON_ESSENTIAL');
  });
  retryButton?.addEventListener('click', () => {
    const stored = readConsent();
    if (stored) void saveConsent({ ...stored, decision: stored.decision ?? 'SAVE_PREFERENCES' });
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

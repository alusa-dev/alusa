// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const landingScript = readFileSync(resolve(process.cwd(), 'public/amagiadouniverso/landing.js'), 'utf8');
const landingHtml = readFileSync(resolve(process.cwd(), 'public/amagiadouniverso/index.html'), 'utf8');
const consentKey = 'alusa.cookie-consent.v1';

describe('A Magia do Universo landing', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <section data-cookie-consent hidden><button data-cookie-accept></button><button data-cookie-reject></button></section>
      <a data-cookie-manage href="/preferencias-de-cookies">Gerenciar cookies</a>
      <a class="session-card" data-session="first" href="https://alusa.app/m/map_58c37147e01c496f92bc6f5f">18h00</a>
      <a class="session-card" data-session="second" href="https://alusa.app/m/map_dc0c9a1a841941138d558b3d">20h00</a>`;
    window.BALLET_EVENT_CONTENT = {
      sessions: {
        first: 'https://alusa.app/m/map_58c37147e01c496f92bc6f5f',
        second: 'https://alusa.app/m/map_dc0c9a1a841941138d558b3d',
      },
    };
    window.history.replaceState(null, '', '/?utm_source=instagram&utm_campaign=evento%202026&fbclid=Ab_123-xy&gclid=discard-me&utm_bad=bad%3Cvalue%3E');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  it('ships visible session anchors and responsive versioned artwork without a page-load gate', () => {
    const page = new DOMParser().parseFromString(landingHtml, 'text/html');
    const links = [...page.querySelectorAll<HTMLAnchorElement>('.session-card')];
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe('https://alusa.app/m/map_58c37147e01c496f92bc6f5f');
    expect(links[1].href).toBe('https://alusa.app/m/map_dc0c9a1a841941138d558b3d');
    expect(links.every((link) => !link.hasAttribute('disabled') && !link.hasAttribute('target'))).toBe(true);
    expect(page.querySelector('.page-loader')).toBeNull();
    expect(page.querySelector('.scene__background')?.getAttribute('src')).toContain('background-v2.webp');
    expect(landingHtml).toContain('Compre seu ingresso: escolha a sessão e selecione seus lugares.');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    delete window.BALLET_EVENT_CONTENT;
  });

  it('keeps session links usable in the same tab and forwards only bounded, validated campaign parameters', () => {
    window.eval(landingScript);

    const first = document.querySelector<HTMLAnchorElement>('[data-session="first"]')!;
    expect(first.getAttribute('href')).toContain('utm_source=instagram');
    expect(first.getAttribute('href')).toContain('utm_campaign=evento+2026');
    expect(first.getAttribute('href')).toContain('fbclid=Ab_123-xy');
    expect(first.getAttribute('href')).not.toContain('gclid');
    expect(first.getAttribute('href')).not.toContain('utm_bad');
    expect(first.hasAttribute('target')).toBe(false);
    expect(first.href).toBe('https://alusa.app/m/map_58c37147e01c496f92bc6f5f?utm_source=instagram&utm_campaign=evento+2026&fbclid=Ab_123-xy');
    expect(document.querySelector('[data-cookie-consent]')).not.toHaveAttribute('hidden');
    expect(document.querySelector('[data-cookie-manage]')).toHaveAttribute('hidden');
  });

  it('stores the consent decision and does not load Meta Pixel after rejecting marketing', async () => {
    window.eval(landingScript);
    document.querySelector<HTMLButtonElement>('[data-cookie-reject]')!.click();
    await Promise.resolve();

    const consent = JSON.parse(localStorage.getItem(consentKey) ?? 'null');
    expect(consent.categories.marketing).toBe(false);
    expect(document.querySelector('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toBeNull();
    expect(document.querySelector('[data-cookie-manage]')).not.toHaveAttribute('hidden');
    expect(fetch).toHaveBeenCalledWith('/api/privacy/cookie-consent', expect.objectContaining({ method: 'POST' }));
  });

  it('tracks session selection only with marketing consent and never blocks the link', () => {
    localStorage.setItem(consentKey, JSON.stringify({
      policyVersion: '2026-05-27',
      categories: { essential: true, analytics: false, marketing: true, preferences: false },
    }));
    window.eval(landingScript);
    const pixel = window as Window & { fbq?: ((...args: unknown[]) => void) & { queue?: unknown[][] } };
    const link = document.querySelector<HTMLAnchorElement>('[data-session="first"]')!;
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    link.click();

    expect(pixel.fbq?.queue).toContainEqual(['trackCustom', 'SelectSession', { session: 'first' }]);
    expect(link.href).toContain('/m/map_58c37147e01c496f92bc6f5f');
  });
});

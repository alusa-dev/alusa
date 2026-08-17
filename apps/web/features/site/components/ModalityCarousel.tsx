'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from '@/features/site/components/icons/icons';

const modalities = [
  'Escolas de dança',
  'Escolas de música',
  'Escolas de idiomas',
  'Cursos livres',
  'Escolas de artes',
  'Reforço escolar',
] as const;

export function ModalityCarousel() {
  const frameRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const initialScrollLeftRef = useRef(0);
  const [canScrollPrevious, setCanScrollPrevious] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    initialScrollLeftRef.current = viewport.scrollLeft;

    const updateScrollState = () => {
      const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
      const maskDistance = 88;
      const scrollOffset = Math.max(viewport.scrollLeft - initialScrollLeftRef.current, 0);
      const rightMaskOpacity = Math.min(Math.max(maxScrollLeft - viewport.scrollLeft, 0) / maskDistance, 1);
      const leftMaskOpacity = maxScrollLeft > 0 && viewport.scrollLeft >= maxScrollLeft - 4 ? 1 : 0;

      frameRef.current?.style.setProperty('--carousel-left-mask', String(leftMaskOpacity));
      frameRef.current?.style.setProperty('--carousel-right-mask', String(rightMaskOpacity));
      setCanScrollPrevious(scrollOffset > 4);
      setCanScrollNext(viewport.scrollLeft < maxScrollLeft - 4);
    };

    updateScrollState();
    viewport.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);

    return () => {
      viewport.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, []);

  const moveCarousel = (direction: 'previous' | 'next') => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const firstCard = viewport.querySelector<HTMLElement>('.figma-modality-card');
    const cardStep = (firstCard?.getBoundingClientRect().width ?? viewport.clientWidth * 0.82) + 16;

    viewport.scrollBy({
      left: direction === 'next' ? cardStep : -cardStep,
      behavior: 'smooth',
    });
  };

  return (
    <section className="figma-section figma-section-modalities" aria-labelledby="modalities-title">
      <div className="figma-container">
        <div className="figma-carousel-header">
          <h2 id="modalities-title">
            Uma Alusa para diferentes
            <br />
            formas de ensinar.
          </h2>
          <div className="figma-carousel-controls" aria-label="Navegação das modalidades">
            {canScrollPrevious && (
              <button
                type="button"
                className="figma-carousel-arrow"
                aria-label="Modalidades anteriores"
                onClick={() => moveCarousel('previous')}
              >
                <ArrowLeft className="figma-carousel-arrow-icon" aria-hidden="true" />
              </button>
            )}
            {canScrollNext && (
              <button
                type="button"
                className="figma-carousel-arrow"
                aria-label="Próximas modalidades"
                onClick={() => moveCarousel('next')}
              >
                <ArrowRight className="figma-carousel-arrow-icon" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div ref={frameRef} className="figma-carousel-frame">
          <div
            ref={viewportRef}
            className="figma-carousel-viewport"
            tabIndex={0}
            role="region"
            aria-label="Modalidades atendidas pela Alusa"
          >
            <div className="figma-carousel-track">
              {modalities.map((modality) => (
                <article className="figma-modality-card" key={modality}>
                  <p>{modality}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

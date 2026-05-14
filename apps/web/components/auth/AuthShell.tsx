"use client";
import React from 'react';
import { cn } from '@/lib/utils';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

interface AuthShellProps {
    children: React.ReactNode;
    heroImageSrc?: string;
    heroContent?: React.ReactNode;
}

/** Wordmark no tom brand-primary (#19143A) — máscara sobre o SVG roxo original */
function AlusaWordmarkBrandDark({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                'inline-block h-8 w-auto max-w-full shrink-0 bg-brand-primary aspect-[1555.6/473.48]',
                '[mask-image:url("/brand/logo.svg")] [mask-size:contain] [mask-repeat:no-repeat] [mask-position:left_center]',
                '[-webkit-mask-image:url("/brand/logo.svg")] [-webkit-mask-size:contain] [-webkit-mask-repeat:no-repeat] [-webkit-mask-position:left_center]',
                className
            )}
            role="img"
            aria-label="Alusa"
        />
    );
}

const defaultHeroContent = (
    <div className="max-w-[360px]">
        <p className="text-3xl font-normal leading-tight text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.28)]">
            Uma forma simples e organizada de cuidar da gestão da sua escola, do cadastro ao financeiro.
        </p>
    </div>
);

export default function AuthShell({
    children,
    heroImageSrc = '/images/image-login.jpg',
    heroContent = defaultHeroContent,
}: AuthShellProps) {
    return (
        <div className="auth-mobile-viewport flex w-full overflow-hidden bg-white lg:min-h-screen">
            {/* Esquerda: desktop */}
            <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-screen lg:w-1/2 lg:flex-shrink-0 lg:overflow-hidden">
                <img
                    src={heroImageSrc}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60" />
                <div className="absolute inset-0 z-10 flex flex-col justify-start px-12 py-12 xl:px-14 xl:py-14">
                    <div className="flex flex-col gap-16">
                        <div>
                            <img
                                src="/brand/logo.svg"
                                alt="Alusa"
                                className="h-8 brightness-0 invert"
                            />
                        </div>
                        {heroContent}
                    </div>
                </div>
                <AsaasSeal
                    variant="negativo-branco"
                    className="absolute bottom-12 left-12 z-20 xl:bottom-14 xl:left-14"
                />
            </aside>
            {/* Direita: mobile + desktop */}
            <section className="auth-mobile-viewport flex min-h-0 flex-1 flex-col bg-white lg:flex-none lg:w-1/2 lg:min-h-screen">
                <div className="auth-mobile-scroll flex min-h-0 flex-1 flex-col overflow-y-auto px-4 lg:overflow-visible lg:px-0 lg:pb-0">
                    <div className="flex min-h-0 flex-1 flex-col justify-start lg:min-h-screen lg:justify-center lg:px-8 lg:py-16">
                        <header className="shrink-0 lg:hidden">
                            <div className="flex w-full items-center justify-start pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
                                <AlusaWordmarkBrandDark />
                            </div>
                            <div className="-mx-4 border-b border-gray-200" aria-hidden="true" />
                        </header>
                        <div className="flex w-full flex-1 flex-col items-center justify-center pt-6 lg:flex-none lg:items-center lg:justify-center lg:pt-0">
                            {children}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

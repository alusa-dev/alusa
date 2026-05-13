"use client";
import React from 'react';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

interface AuthShellProps {
    children: React.ReactNode;
    heroImageSrc?: string;
    heroContent?: React.ReactNode;
}

const defaultHeroContent = (
    <div className="max-w-[360px]">
        <p className="text-3xl font-normal leading-tight text-white drop-shadow-[0_6px_18px_rgba(0,0,0,0.28)]">
            Uma forma simples e organizada de cuidar da gestão da sua escola, do cadastro ao financeiro.
        </p>
    </div>
);

export default function AuthShell({ children, heroImageSrc = '/images/image-login.jpg', heroContent = defaultHeroContent }: AuthShellProps) {
    return (
        <div className="flex min-h-screen w-full">
            {/* Esquerda: área fill da imagem — sticky, cobre a viewport inteira */}
            <div className="hidden lg:block lg:w-1/2 sticky top-0 h-screen overflow-hidden flex-shrink-0">
                <img
                    src={heroImageSrc}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover"
                />
                {/* Overlay gradiente */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60 pointer-events-none" />
                <div className="absolute inset-0 z-10 flex flex-col justify-between px-12 py-12 xl:px-14 xl:py-14">
                    <div className="flex flex-col gap-16">
                        {/* Logo no topo */}
                        <div>
                            <img
                                src="/brand/logo.svg"
                                alt="Alusa"
                                className="h-12 w-auto brightness-0 invert"
                            />
                        </div>
                        {heroContent}
                    </div>

                    {/* Selo na base */}
                    <div>
                        <AsaasSeal variant="negativo-branco" />
                    </div>
                </div>
            </div>

            {/* Direita: painel branco com formulário */}
            <div className="flex min-h-screen w-full flex-col bg-white lg:w-1/2">
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-8 lg:py-16">
                    <div className="flex w-full flex-col items-center">
                        {/* Mobile: logo centralizada; paddings laterais iguais vêm do px-8 acima */}
                        <div className="mb-8 flex w-full justify-center lg:hidden">
                            <img src="/brand/logo.svg" alt="Alusa" className="h-12 w-auto" />
                        </div>
                        <div className="flex w-full flex-col items-center">{children}</div>
                    </div>
                </div>

                <footer className="flex shrink-0 justify-center px-8 pb-8 pt-2 lg:hidden" aria-label="Parceria de pagamentos">
                    <AsaasSeal variant="negativo-preto" />
                </footer>
            </div>
        </div>
    );
}

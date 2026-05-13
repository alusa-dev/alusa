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
            {/* Esquerda: desktop igual ao histórico — imagem, logo h-8, selo Asaas na base */}
            <div className="hidden lg:block lg:w-1/2 sticky top-0 h-screen overflow-hidden flex-shrink-0">
                <img
                    src={heroImageSrc}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/60 pointer-events-none" />
                <div className="absolute inset-0 z-10 flex flex-col justify-between px-12 py-12 xl:px-14 xl:py-14">
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
                    <div>
                        <AsaasSeal variant="negativo-branco" />
                    </div>
                </div>
            </div>

            {/* Direita: mobile — scroll + bloco à esquerda + logo no fluxo; desktop — coluna branca, bloco de auth centralizado */}
            <div className="flex min-h-screen w-full flex-col bg-white lg:w-1/2">
                <div
                    className={
                        'flex min-h-0 flex-1 flex-col overflow-y-auto ' +
                        'px-5 pt-[max(0px,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] min-[400px]:px-6 min-[400px]:pb-6 ' +
                        'lg:overflow-visible lg:px-0 lg:pb-0 lg:pt-0'
                    }
                >
                    <div
                        className={
                            'flex flex-1 flex-col items-stretch justify-center ' +
                            'lg:min-h-screen lg:px-8 lg:py-16'
                        }
                    >
                        <div className="-mt-1 mb-5 flex w-full justify-start min-[400px]:mb-6 lg:hidden">
                            <img
                                src="/brand/logo.svg"
                                alt="Alusa"
                                className="h-10 w-auto min-[400px]:h-11"
                            />
                        </div>
                        <div className="flex w-full flex-col items-stretch lg:items-center">{children}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

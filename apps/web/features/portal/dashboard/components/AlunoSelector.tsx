'use client';

import { useState, useEffect } from 'react';
import { User, ChevronDown } from '@/components/icons/icons';
import type { PortalResponsavelAlunoDTO } from '@/features/portal/dtos';
import { DASHBOARD_SECTION_CARD_CLASSNAME } from '@/app/(app)/dashboard/components/utils';

interface AlunoSelectorProps {
  onAlunoSelect: (_alunoId: string | null) => void;
}

export function AlunoSelector({ onAlunoSelect }: AlunoSelectorProps) {
  const [alunos, setAlunos] = useState<PortalResponsavelAlunoDTO[]>([]);
  const [selectedAlunoId, setSelectedAlunoId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAlunos() {
      try {
        const response = await fetch('/api/portal/responsavel/alunos');
        if (response.ok) {
          const data = await response.json();
          setAlunos(data.alunos || []);
          
          // Selecionar o primeiro aluno por padrão
          if (data.alunos && data.alunos.length > 0) {
            const firstAlunoId = data.alunos[0].id;
            setSelectedAlunoId(firstAlunoId);
            onAlunoSelect(firstAlunoId);
          }
        }
      } catch (error) {
        console.error('Erro ao carregar alunos:', error);
      } finally {
        setLoading(false);
      }
    }

    loadAlunos();
  }, [onAlunoSelect]);

  const selectedAluno = alunos.find((a) => a.id === selectedAlunoId);

  const handleSelect = (alunoId: string) => {
    setSelectedAlunoId(alunoId);
    onAlunoSelect(alunoId);
    setIsOpen(false);
  };

  const handleViewAll = () => {
    setSelectedAlunoId(null);
    onAlunoSelect(null);
    setIsOpen(false);
  };

  if (loading) {
    return (
      <div
        className={`${DASHBOARD_SECTION_CARD_CLASSNAME} animate-pulse rounded-2xl bg-white p-4 alusa-dark:bg-[color:var(--color-bg-card)]`}
      >
        <div className="h-12 rounded-xl bg-gray-100 alusa-dark:bg-white/5" />
      </div>
    );
  }

  if (alunos.length === 0) {
    return null;
  }

  if (alunos.length === 1) {
    // Se houver apenas um aluno, mostrar apenas como info, sem dropdown
    return (
      <div
        className={`${DASHBOARD_SECTION_CARD_CLASSNAME} flex items-center gap-3 rounded-2xl bg-white p-4 alusa-dark:bg-[color:var(--color-bg-card)]`}
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f2e9fc] text-[#542a88] alusa-dark:bg-white/10 alusa-dark:text-violet-200">
          {alunos[0].foto ? (
            <img
              src={alunos[0].foto}
              alt={alunos[0].nome}
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <User className="h-6 w-6" />
          )}
        </div>
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
            Visualizando dados de
          </p>
          <p className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
            {alunos[0].nome}
          </p>
          {alunos[0].idade && (
            <p className="text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
              {alunos[0].idade} anos
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${DASHBOARD_SECTION_CARD_CLASSNAME} overflow-visible rounded-2xl bg-white alusa-dark:bg-[color:var(--color-bg-card)]`}
    >
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-gray-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/35 alusa-dark:hover:bg-white/[0.04]"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f2e9fc] font-semibold text-[#542a88] alusa-dark:bg-white/10 alusa-dark:text-violet-200">
            {selectedAluno?.foto ? (
              <img
                src={selectedAluno.foto}
                alt={selectedAluno.nome}
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : selectedAluno ? (
              selectedAluno.nome.charAt(0).toUpperCase()
            ) : (
              <User className="h-6 w-6" />
            )}
          </div>
          <div className="flex-1 text-left">
            <p className="text-xs font-medium text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
              {selectedAluno ? 'Visualizando dados de' : 'Todos os alunos'}
            </p>
            <p className="text-base font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
              {selectedAluno ? selectedAluno.nome : `${alunos.length} alunos`}
            </p>
            {selectedAluno?.idade && (
              <p className="text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                {selectedAluno.idade} anos
              </p>
            )}
          </div>
          <ChevronDown
            className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {/* Dropdown */}
        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute left-0 right-0 top-full z-20 max-h-96 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
              {/* Opção "Todos os alunos" */}
              <button
                onClick={handleViewAll}
                className={`flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-violet-50/70 alusa-dark:hover:bg-white/[0.04] ${
                  !selectedAlunoId ? 'bg-violet-50/70 alusa-dark:bg-white/[0.04]' : ''
                }`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#f2e9fc] text-[#542a88] alusa-dark:bg-white/10 alusa-dark:text-violet-200">
                  <User className="h-6 w-6" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                    Todos os alunos
                  </p>
                  <p className="text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                    Visualizar dados consolidados
                  </p>
                </div>
              </button>

              <div className="border-t border-gray-200 alusa-dark:border-[color:var(--color-border-default)]" />

              {/* Lista de alunos */}
              {alunos.map((aluno) => (
                <button
                  key={aluno.id}
                  onClick={() => handleSelect(aluno.id)}
                  className={`flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-violet-50/70 alusa-dark:hover:bg-white/[0.04] ${
                    selectedAlunoId === aluno.id ? 'bg-violet-50/70 alusa-dark:bg-white/[0.04]' : ''
                  }`}
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f2e9fc] font-semibold text-[#542a88] alusa-dark:bg-white/10 alusa-dark:text-violet-200">
                    {aluno.foto ? (
                      <img
                        src={aluno.foto}
                        alt={aluno.nome}
                        className="h-12 w-12 rounded-full object-cover"
                      />
                    ) : (
                      aluno.nome.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
                      {aluno.nome}
                    </p>
                    {aluno.idade && (
                      <p className="text-sm text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
                        {aluno.idade} anos
                      </p>
                    )}
                  </div>
                  {selectedAlunoId === aluno.id && (
                    <div className="h-2 w-2 rounded-full bg-violet-600" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { User, ChevronDown } from '@/components/icons/icons';
import type { PortalResponsavelAlunoDTO } from '@/features/portal/dtos';

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
      <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
        <div className="h-12 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (alunos.length === 0) {
    return null;
  }

  if (alunos.length === 1) {
    // Se houver apenas um aluno, mostrar apenas como info, sem dropdown
    return (
      <div className="bg-gradient-to-br from-violet-500 to-violet-600 rounded-xl p-4 text-white">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
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
            <p className="text-sm font-medium text-white/80">Visualizando dados de</p>
            <p className="text-lg font-semibold">{alunos[0].nome}</p>
            {alunos[0].idade && (
              <p className="text-sm text-white/80">{alunos[0].idade} anos</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors"
        >
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white font-bold">
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
            <p className="text-sm font-medium text-gray-600">
              {selectedAluno ? 'Visualizando dados de' : 'Todos os alunos'}
            </p>
            <p className="text-lg font-semibold text-gray-900">
              {selectedAluno ? selectedAluno.nome : `${alunos.length} alunos`}
            </p>
            {selectedAluno?.idade && (
              <p className="text-sm text-gray-500">{selectedAluno.idade} anos</p>
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
            <div className="absolute top-full left-0 right-0 z-20 bg-white border border-gray-200 rounded-b-xl shadow-lg max-h-96 overflow-y-auto">
              {/* Opção "Todos os alunos" */}
              <button
                onClick={handleViewAll}
                className={`w-full p-4 flex items-center gap-3 hover:bg-violet-50 transition-colors ${
                  !selectedAlunoId ? 'bg-violet-50' : ''
                }`}
              >
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white">
                  <User className="h-6 w-6" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900">Todos os alunos</p>
                  <p className="text-sm text-gray-500">Visualizar dados consolidados</p>
                </div>
              </button>

              <div className="border-t border-gray-200" />

              {/* Lista de alunos */}
              {alunos.map((aluno) => (
                <button
                  key={aluno.id}
                  onClick={() => handleSelect(aluno.id)}
                  className={`w-full p-4 flex items-center gap-3 hover:bg-violet-50 transition-colors ${
                    selectedAlunoId === aluno.id ? 'bg-violet-50' : ''
                  }`}
                >
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white font-bold">
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
                    <p className="font-semibold text-gray-900">{aluno.nome}</p>
                    {aluno.idade && (
                      <p className="text-sm text-gray-500">{aluno.idade} anos</p>
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



'use client';

import { BLOCKING_MAP_DOCUMENT_DIAGNOSTIC_TYPES, validateEventMapDocument, validateEventMapIntegrity, type EventMapDTO } from '@alusa/domain';

import { CreatorIcon } from '@/components/icons/hugeicons';

export function MapReviewPanel({ map }: { map: EventMapDTO }) {
  const documentValidation = map.document ? validateEventMapDocument(map.document) : { valid: true, diagnostics: [] };
  const integrity = validateEventMapIntegrity(map);
  const errors = [
    ...documentValidation.diagnostics.filter((diagnostic) => BLOCKING_MAP_DOCUMENT_DIAGNOSTIC_TYPES.includes(diagnostic.type)).map((diagnostic) => diagnostic.message),
    ...integrity.errors.filter((error) => error.severity === 'error').map((error) => error.message),
  ];
  const warnings = [
    ...documentValidation.diagnostics.filter((diagnostic) => !BLOCKING_MAP_DOCUMENT_DIAGNOSTIC_TYPES.includes(diagnostic.type)).map((diagnostic) => diagnostic.message),
    ...integrity.errors.filter((error) => error.severity === 'warning').map((error) => error.message),
  ];
  const canPublish = errors.length === 0 && warnings.length === 0;

  return (
    <aside className="absolute right-4 top-24 z-20 flex max-h-[calc(100%-8rem)] w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg shadow-slate-300/30 backdrop-blur">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <CreatorIcon name={canPublish ? 'success' : 'warning'} size={16} className={canPublish ? 'text-emerald-600' : 'text-amber-600'} />
          <h2 className="text-sm font-semibold text-slate-950">Revisão do mapa</h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">Confira a estrutura antes de publicar para venda.</p>
      </div>

      <div className="min-h-0 space-y-3 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-slate-50 p-3"><span className="block text-slate-500">Setores</span><strong className="text-slate-950">{map.counts.sections}</strong></div>
          <div className="rounded-lg bg-slate-50 p-3"><span className="block text-slate-500">Assentos</span><strong className="text-slate-950">{map.counts.seats}</strong></div>
        </div>

        {errors.length === 0 && warnings.length === 0 ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
            Tudo pronto. O preview público não exibirá a grade, os controles ou a planta de referência.
          </div>
        ) : null}

        {errors.length > 0 ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold text-red-800">Impedimentos</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-red-700">{errors.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
          </div>
        ) : null}
        {warnings.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-800">Atenção</p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-700">{warnings.map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

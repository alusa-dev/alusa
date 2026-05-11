'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CobrancaActionsMenu } from '@/components/financeiro/CobrancaActionsMenu';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';

// Helper para formatar tipo de cobrança
function formatarTipo(tipo: string): string {
  const tiposFormatados: Record<string, string> = {
    MENSALIDADE: 'Mensalidade',
    TAXA_MATRICULA: 'Taxa de Matrícula',
    EXTRA: 'Extra',
    AVULSA: 'Avulsa',
  };
  return tiposFormatados[tipo] || tipo;
}

interface ChargeRow {
  id: string;
  tipo: string;
  status: string;
  valor: number;
  vencimento: string | null;
  aluno: { id: string; nome: string };
  matriculaId: string | null;
  asaasPaymentId?: string | null;
  formaPagamento?: string;
  atrasado?: boolean;
  origin?: 'ACADEMIC' | 'STANDALONE';
  description?: string | null;
}

interface ApiResponse {
  data: ChargeRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function ChargesTable() {
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [tipoFilters, setTipoFilters] = useState<string[]>([]);
  const inFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const fetchData = useCallback(async (silent = false) => {
    const requestKey = JSON.stringify({ page, pageSize, debounced, statusFilters, tipoFilters });
    const inFlight = inFlightRef.current;
    if (inFlight?.key === requestKey) {
      return inFlight.promise;
    }

    const trackedPromise = (async () => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (debounced) params.set('q', debounced);
        statusFilters.forEach((status) => params.append('status', status));
        tipoFilters.forEach((tipo) => params.append('tipo', tipo));
        router.replace(`/financeiro/cobrancas?${params.toString()}`);
        const res = await fetch(`/api/financeiro/cobrancas?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const json: ApiResponse = await res.json();
        setRows(json.data);
        setTotal(json.total);
      } catch (e) {
        setError((e as Error).message);
      }
    })();

    inFlightRef.current = { key: requestKey, promise: trackedPromise };
    trackedPromise.finally(() => {
      if (inFlightRef.current?.promise === trackedPromise) {
        inFlightRef.current = null;
      }
      if (!silent) setLoading(false);
    });
    return trackedPromise;
  }, [page, pageSize, debounced, statusFilters, tipoFilters, router]);

  // Inicializa filtros da URL
  useEffect(() => {
    const s = searchParams?.getAll('status') || [];
    const t = searchParams?.getAll('tipo') || [];
    const q = searchParams?.get('q') || '';
    if (s.length) setStatusFilters(s);
    if (t.length) setTipoFilters(t);
    if (q) setSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    void fetchData().catch(() => undefined);
  }, [fetchData]);

  useLiveRefresh(
    () => fetchData(true),
    {
      enabled: !loading,
      intervalMs: 45_000,
      minIntervalMs: 10_000,
    },
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggle(list: string[], value: string, setter: (_v: string[]) => void) {
    if (list.includes(value)) setter(list.filter((x) => x !== value));
    else setter([...list, value]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <input
          placeholder="Buscar aluno ou descrição..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-2 text-sm w-72"
        />
        <div className="flex gap-2 items-center text-xs">
          <span className="text-gray-500">Status:</span>
          {['PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO'].map((s) => (
            <button
              key={s}
              onClick={() => toggle(statusFilters, s, setStatusFilters)}
              className={
                'px-2 py-1 rounded border text-xs ' +
                (statusFilters.includes(s)
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white hover:bg-gray-50')
              }
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center text-xs">
          <span className="text-gray-500">Tipo:</span>
          {['MENSALIDADE', 'TAXA_MATRICULA', 'EXTRA', 'AVULSA'].map((t) => (
            <button
              key={t}
              onClick={() => toggle(tipoFilters, t, setTipoFilters)}
              className={
                'px-2 py-1 rounded border text-xs ' +
                (tipoFilters.includes(t)
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white hover:bg-gray-50')
              }
            >
              {t}
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-500">{total} registros</div>
      </div>
      <div className="overflow-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium w-1/4">Nome</th>
              <th className="px-4 py-3 text-left font-medium w-1/6">Valor</th>
              <th className="px-4 py-3 text-left font-medium w-1/6">Tipo</th>
              <th className="px-4 py-3 text-left font-medium w-1/6">Vencimento</th>
              <th className="px-4 py-3 text-left font-medium w-1/6">Status</th>
              <th className="px-4 py-3 text-center font-medium w-24">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Nenhuma cobrança encontrada.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{r.aluno.nome}</span>
                      {r.origin === 'STANDALONE' && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                          Avulsa
                        </span>
                      )}
                    </div>
                    {r.description && r.origin === 'STANDALONE' && (
                      <div className="text-xs text-gray-500 mt-0.5">{r.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap font-medium">
                    {r.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                    {formatarTipo(r.tipo)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.vencimento ? (
                      <span className={r.atrasado ? 'text-red-600 font-medium' : 'text-gray-700'}>
                        {new Date(r.vencimento).toLocaleDateString('pt-BR')}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase"
                      style={{
                        backgroundColor:
                          r.status === 'PAGO'
                            ? '#CFF2DA'
                            : r.status === 'PENDENTE'
                              ? '#F3F9B3'
                              : r.status === 'ATRASADO'
                                ? '#FFD9B3'
                                : '#E6E4EA',
                        color:
                          r.status === 'PAGO'
                            ? '#144E22'
                            : r.status === 'PENDENTE'
                              ? '#5A630F'
                              : r.status === 'ATRASADO'
                                ? '#5C2A00'
                                : '#383242',
                      }}
                    >
                      {r.status === 'PAGO' ? '✓ Pago' : r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <CobrancaActionsMenu
                      cobranca={{
                        id: r.id,
                        status: r.status,
                        asaasPaymentId: r.asaasPaymentId,
                        matriculaId: r.matriculaId ?? undefined,
                        formaPagamento: r.formaPagamento || r.tipo,
                        atrasado: r.atrasado,
                      }}
                      onActionComplete={() => void fetchData()}
                      variant="button"
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1 || loading}
          className="px-3 py-1 rounded border disabled:opacity-40"
        >
          Anterior
        </button>
        <span>
          Página {page} / {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages || loading}
          className="px-3 py-1 rounded border disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

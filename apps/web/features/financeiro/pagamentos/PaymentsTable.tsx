'use client';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';

interface PaymentRow {
  id: string;
  status: string;
  valorPago: number;
  dataPagamento: string | null;
  formaPagamento: string;
  cobrancaId: string;
  cobranca: {
    id: string;
    tipo: string;
    status: string;
    valor: number;
    vencimento: string;
    aluno: { id: string; nome: string };
  };
  asaasPaymentId?: string | null;
  createdAt: string;
}

interface ApiResponse {
  data: PaymentRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const STATUS_OPTIONS = ['CONFIRMADO', 'PENDENTE', 'ESTORNADO'];
const FORMA_PAGAMENTO = ['PIX', 'BOLETO', 'CARTAO', 'DINHEIRO'];

export default function PaymentsTable() {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [formaFilters, setFormaFilters] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { isInitialLoading, isRefreshing } = useFinanceListLoad(
    async ({ signal }) => {
      setError(null);
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debounced) params.set('q', debounced);
      statusFilters.forEach((s) => params.append('status', s));
      formaFilters.forEach((f) => params.append('formaPagamento', f));
      const res = await fetch(`/api/financeiro/pagamentos?${params.toString()}`, {
        cache: 'no-store',
        signal,
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const json: ApiResponse = await res.json();
      setRows(json.data);
      setTotal(json.total);
    },
    { deps: [page, pageSize, debounced, statusFilters, formaFilters] },
  );

  const loading = isInitialLoading;
  const tableBusy = isInitialLoading || isRefreshing;

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
          {STATUS_OPTIONS.map((s) => (
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
          <span className="text-gray-500">Forma:</span>
          {FORMA_PAGAMENTO.map((f) => (
            <button
              key={f}
              onClick={() => toggle(formaFilters, f, setFormaFilters)}
              className={
                'px-2 py-1 rounded border text-xs ' +
                (formaFilters.includes(f)
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white hover:bg-gray-50')
              }
            >
              {f}
            </button>
          ))}
        </div>
        <div className="text-xs text-gray-500">{total} registros</div>
      </div>
      <div className="overflow-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Aluno</th>
              <th className="px-3 py-2 text-left font-medium">Valor Pago</th>
              <th className="px-3 py-2 text-left font-medium">Forma</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Data Pagamento</th>
              <th className="px-3 py-2 text-left font-medium">Cobrança</th>
              <th className="px-3 py-2 text-left font-medium">Asaas</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  Carregando...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-red-600">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  Nenhum pagamento encontrado.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{r.cobranca.aluno.nome}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.valorPago.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.formaPagamento}</td>
                  <td className="px-3 py-2">
                    <Badge
                      status={(() => {
                        const s = r.status.toUpperCase();
                        if (s === 'CONFIRMADO') return 'CONFIRMED';
                        if (s === 'PENDENTE') return 'PENDING';
                        if (s === 'ESTORNADO') return 'REFUNDED';
                        return s;
                      })() as any}
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.dataPagamento ? new Date(r.dataPagamento).toLocaleDateString('pt-BR') : '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    <span className="text-gray-600">{r.cobranca.tipo}</span>
                    <br />
                    <span className="text-gray-400">
                      Venc. {new Date(r.cobranca.vencimento).toLocaleDateString('pt-BR')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {r.asaasPaymentId ? (
                      <span className="text-green-600">{r.asaasPaymentId.slice(0, 10)}…</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1 || tableBusy}
          className="px-3 py-1 rounded border disabled:opacity-40"
        >
          Anterior
        </button>
        <span>
          Página {page} / {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages || tableBusy}
          className="px-3 py-1 rounded border disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

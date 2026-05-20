type ChargePreviewRow = {
  readonly initials: string;
  readonly name: string;
  readonly dueDate: string;
  readonly value: string;
  readonly avatarTone?: 'purple';
};

const charges: readonly ChargePreviewRow[] = [
  {
    initials: 'NB',
    name: 'Nicole de Alencar Bezerra',
    dueDate: '05 de jun.',
    value: 'R$ 150,00'
  },
  {
    initials: 'NB',
    name: 'Nicole de Alencar Bezerra',
    dueDate: '10 de mai.',
    value: 'R$ 80,00'
  },
  {
    initials: 'BA',
    name: 'Breno de Alencar Bezerra',
    dueDate: '05 de jun.',
    value: 'R$ 150,00',
    avatarTone: 'purple'
  },
  {
    initials: 'KB',
    name: 'Keison de Alencar Bezerra',
    dueDate: '05 de jun.',
    value: 'R$ 150,00'
  }
];

export function ChargesPreviewCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl shadow-[0_28px_80px_rgba(0,0,0,0.22)]">
      <div className="min-w-[720px] overflow-hidden rounded-2xl bg-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]">
        <div className="flex h-16 items-center justify-between border-b border-[#f1f2f4] px-6">
          <h3 className="text-base font-semibold text-[#171923]">Últimas Cobranças</h3>
          <button
            type="button"
            className="rounded-lg bg-[#f1e7ff] px-4 py-2 text-sm font-medium text-[#383242]"
            tabIndex={-1}
          >
            Ver Todas
          </button>
        </div>

        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] bg-[#fbfbfc] px-6 py-4 text-xs font-semibold uppercase tracking-[0.06em] text-[#6b7280]">
          <span>Aluno</span>
          <span>Vencimento</span>
          <span>Status</span>
          <span className="text-right">Valor</span>
        </div>

        <div>
          {charges.map((charge) => (
            <div
              key={`${charge.name}-${charge.dueDate}-${charge.value}`}
              className="grid min-h-16 grid-cols-[2fr_1fr_1fr_1fr] items-center border-t border-[#edf0f2] px-6 text-sm text-[#4b5563]"
            >
              <div className="flex items-center gap-3 pr-4">
                <span
                  className={
                    charge.avatarTone === 'purple'
                      ? 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#6d28d9] text-xs font-semibold text-white'
                      : 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d9dce2] text-xs font-semibold text-[#4b5563]'
                  }
                >
                  {charge.initials}
                </span>
                <span className="font-medium text-[#171923]">{charge.name}</span>
              </div>
              <span>{charge.dueDate}</span>
              <span>
                <span className="inline-flex rounded-full bg-[#c9f3d7] px-2 py-1 text-xs font-medium text-[#18733b]">
                  Pago
                </span>
              </span>
              <span className="text-right font-semibold text-[#0f1117]">{charge.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

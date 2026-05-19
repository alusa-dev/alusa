'use client';

type IconName =
  | 'dashboard'
  | 'cadastro'
  | 'matriculas'
  | 'contratos'
  | 'cobrancas'
  | 'wallet'
  | 'financeiro'
  | 'aulas'
  | 'loja'
  | 'eventos'
  | 'configuracoes';

const ICON_PATHS: Record<Exclude<IconName, 'dashboard'>, string[]> = {
  cadastro: [
    'M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347',
    'M4.26 10.147a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814',
    'M4.26 10.147A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342',
    'M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443',
    'M4.993 19.993A5.981 5.981 0 0 0 6.75 15.75v-1.5',
  ],
  matriculas: [
    'M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664',
    'M11.35 3.836A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586',
    'M11.35 3.836c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25',
    'M17.15 3.836c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25',
    'M8.25 8.25H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75',
    'M8.25 8.25h6.375c.621 0 1.125.504 1.125 1.125v9.375',
    'm7.5 15.75 1.5 1.5 3-3.75',
  ],
  contratos: [
    'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25',
    'M8.25 15h7.5M8.25 18H12',
    'M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
  ],
  cobrancas: [
    'M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75',
    'M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25',
    'M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75',
    'M20.25 4.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375',
    'M21.75 15H21a.75.75 0 0 0-.75.75v.75m0 0H3.75',
    'M3.75 16.5h-.375a1.125 1.125 0 0 1-1.125-1.125V15',
    'M3.75 16.5v-.75A.75.75 0 0 0 3 15h-.75',
    'M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    'M18 10.5h.008v.008H18V10.5ZM6 10.5h.008v.008H6V10.5Z',
  ],
  wallet: [
    'M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12',
    'M21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6',
    'M21 12V9M3 12V9',
    'M21 9a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 9',
    'M21 9V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v3',
  ],
  financeiro: [
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75Z',
    'M9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625Z',
    'M16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  ],
  aulas: [
    'M6.75 3v2.25M17.25 3v2.25',
    'M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25',
    'M3 18.75A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75',
    'M3 18.75v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
    'M12 12.75h.008v.008H12v-.008ZM12 15h.008v.008H12V15ZM9.75 15h.008v.008H9.75V15Zm4.5 0h.008v.008h-.008V15Zm2.25-2.25h.008v.008H16.5v-.008Z',
  ],
  loja: [
    'M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5',
    'm19.606 8.507 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007Z',
    'M8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  ],
  eventos: [
    'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18',
    'M7.5 12.75h5.25M7.5 15h3',
    'M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z',
  ],
  configuracoes: [
    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
};

const SIDEBAR_ITEMS: Array<{ label: string; icon: IconName; disabled?: boolean }> = [
  { label: 'Dashboard', icon: 'dashboard' },
  { label: 'Cadastro', icon: 'cadastro' },
  { label: 'Matrículas', icon: 'matriculas' },
  { label: 'Contratos', icon: 'contratos' },
  { label: 'Cobranças', icon: 'cobrancas' },
  { label: 'Meu Dinheiro', icon: 'wallet' },
  { label: 'Antecipações', icon: 'cobrancas' },
  { label: 'Financeiro', icon: 'financeiro' },
  { label: 'Aulas', icon: 'aulas' },
  { label: 'Loja', icon: 'loja' },
  { label: 'Eventos', icon: 'eventos', disabled: true },
];

const APP_SHELL_CARD_SHADOW =
  'rgba(14, 63, 126, 0.06) 0px 0px 0px 1px, rgba(42, 51, 70, 0.03) 0px 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0px 2px 2px -1px, rgba(42, 51, 70, 0.04) 0px 3px 3px -1.5px, rgba(42, 51, 70, 0.03) 0px 5px 5px -2.5px, rgba(42, 51, 70, 0.03) 0px 10px 10px -5px, rgba(42, 51, 70, 0.03) 0px 24px 24px -8px';

function SidebarIcon({ name, active = false }: { name: IconName; active?: boolean }) {
  if (name === 'dashboard' && active) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" fill="currentColor" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" fill="currentColor" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" fill="currentColor" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      {(name === 'dashboard'
        ? [
            'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Z',
            'M3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Z',
            'M13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Z',
            'M13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
          ]
        : ICON_PATHS[name]
      ).map((d) => (
        <path key={d} strokeLinecap="round" strokeLinejoin="round" d={d} />
      ))}
    </svg>
  );
}

function SidebarPreview() {
  return (
    <aside
      className="absolute left-0 top-0 flex flex-col"
      style={{
        width: 262,
        height: 855,
        background: '#f7f5f8',
        color: '#2b2634',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ padding: '28px 16px 31px' }}>
        <img
          src="/brand/alusa-logo-dark.svg"
          alt=""
          width={132}
          height={40}
          draggable={false}
          style={{
            display: 'block',
            width: 132,
            height: 40,
            objectFit: 'contain',
            margin: '0 auto',
          }}
        />
      </div>

      <nav
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          paddingLeft: 20,
          paddingRight: 12,
          paddingBottom: 16,
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 8,
            height: 52,
            borderTopRightRadius: 999,
            borderBottomRightRadius: 999,
            background: '#2b2634',
          }}
        />

        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0 }}>
          {SIDEBAR_ITEMS.map((item, index) => {
            const active = index === 0;

            return (
              <li key={item.label} style={{ listStyle: 'none' }}>
                <div
                  style={{
                    width: 192,
                    height: 52,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    paddingLeft: 30,
                    paddingRight: 16,
                    borderRadius: 10,
                    background: active ? '#eee6f4' : 'transparent',
                    opacity: item.disabled ? 0.46 : 1,
                    color: item.disabled ? '#8e8997' : '#2b2634',
                    fontSize: 16,
                    fontWeight: active ? 600 : 500,
                    lineHeight: 1,
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 20,
                      height: 20,
                      flexShrink: 0,
                    }}
                  >
                    <SidebarIcon name={item.icon} active={active} />
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>

      <div style={{ paddingLeft: 20, paddingRight: 12, paddingBottom: 24 }}>
        <div
          style={{
            width: 192,
            height: 52,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            paddingLeft: 30,
            paddingRight: 16,
            borderRadius: 10,
            color: '#2b2634',
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 1,
          }}
        >
          <span style={{ display: 'flex', width: 20, height: 20 }}>
            <SidebarIcon name="configuracoes" />
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>Configurações</span>
        </div>
      </div>
    </aside>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35" />
      <circle cx="11" cy="11" r="7" />
    </svg>
  );
}

function AvatarBubble({ label, left = 0 }: { label: string; left?: number }) {
  return (
    <span
      style={{
        position: 'absolute',
        left,
        top: 0,
        width: 36,
        height: 36,
        borderRadius: 999,
        border: '2px solid #e6d6fb',
        background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function KpiCard({
  title,
  value,
  description,
  primary = false,
  footer,
}: {
  title: string;
  value: string;
  description?: string;
  primary?: boolean;
  footer?: 'avatars' | 'period';
}) {
  return (
    <div
      style={{
        width: 358,
        height: 220,
        borderRadius: 16,
        background: primary ? '#e6d6fb' : '#f4ecfd',
        padding: '16px 20px',
        color: '#2b2634',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 400, letterSpacing: '0.025em' }}>
            {title}
          </p>
          {primary ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 999,
                background: 'rgba(43,38,52,0.05)',
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 999, background: '#38c256' }} />
              Atualizado
            </span>
          ) : null}
        </div>

        <span
          style={{
            display: 'block',
            marginTop: primary ? 46 : 8,
            fontSize: primary ? 48 : 36,
            fontWeight: 500,
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {description ? (
          <span
            style={{
              display: 'block',
              marginTop: 4,
              fontSize: 12,
              color: 'rgba(43,38,52,0.7)',
            }}
          >
            {description}
          </span>
        ) : null}
      </div>

      {footer === 'avatars' ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ position: 'relative', width: 84, height: 36 }}>
            <AvatarBubble label="BA" />
            <AvatarBubble label="LC" left={24} />
            <AvatarBubble label="JM" left={48} />
          </div>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              border: '2px solid currentColor',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            +
          </span>
        </div>
      ) : null}

      {footer === 'period' ? (
        <div
          style={{
            display: 'inline-flex',
            width: 'fit-content',
            alignItems: 'center',
            borderRadius: 999,
            background: '#eadcf8',
            padding: 4,
            gap: 2,
          }}
        >
          {['1A', '30D', '15D'].map((period, index) => (
            <span
              key={period}
              style={{
                borderRadius: 999,
                background: index === 0 ? '#f8f3fd' : 'transparent',
                color: index === 0 ? '#2b2634' : '#4c4459',
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 500,
                boxShadow: index === 0 ? '0 1px 2px rgba(15,23,42,0.08)' : 'none',
              }}
            >
              {period}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PersonRow({
  name,
  meta,
  badge,
}: {
  name: string;
  meta?: string;
  badge?: string;
}) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          background: '#f4ecfd',
          color: '#383242',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {initials}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#111827' }}>
          {name}
        </span>
        {meta ? (
          <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#6b7280' }}>
            {meta}
          </span>
        ) : null}
      </span>
      {badge ? (
        <span
          style={{
            flexShrink: 0,
            borderRadius: 999,
            background: '#f4ecfd',
            color: '#4c1d95',
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {badge}
        </span>
      ) : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  type,
}: {
  title: string;
  subtitle: string;
  type: 'aulas' | 'aniversarios';
}) {
  return (
    <div
      style={{
        width: 358,
        height: 260,
        borderRadius: 16,
        background: '#fff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        color: '#111827',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280', textTransform: 'capitalize' }}>
          {subtitle}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, marginTop: 16 }}>
        {type === 'aulas' ? (
          <>
            <PersonRow name="Lia Martins" meta="Turma Kids - 09:30" badge="Agendada" />
            <PersonRow name="Pedro Rocha" meta="Ballet Baby - 14:00" badge="Agendada" />
            <PersonRow name="Clara Nunes" meta="Jazz Teen - 17:30" badge="Agendada" />
          </>
        ) : (
          <>
            <PersonRow name="Ana Luiza" badge="Completando 8 anos" />
            <PersonRow name="Miguel Alves" badge="Irá completar 10 anos" />
            <PersonRow name="Sofia Lima" badge="Irá completar 7 anos" />
          </>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 16,
          fontSize: 12,
          color: '#6b7280',
        }}
      >
        <span>Clique para abrir</span>
        <span style={{ color: '#383242', fontWeight: 500 }}>
          {type === 'aulas' ? 'Ver agenda' : 'Ver calendário'}
        </span>
      </div>
    </div>
  );
}

export function DashboardMock() {
  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: '#d9d9d9' }}
    >
      <div
        className="absolute left-0 top-0"
        style={{ width: 1324, minHeight: 547, height: '100%', background: '#f6f3f7' }}
      >
        <SidebarPreview />

        <div
          className="absolute"
          style={{
            left: 274,
            top: 40,
            width: 1608,
            height: 855,
            background: '#fff',
            border: 0,
            borderRadius: 40,
            boxShadow: APP_SHELL_CARD_SHADOW,
          }}
        />

        <div
          className="absolute"
          style={{
            left: 306,
            top: 74,
            height: 44,
            width: 460,
            border: '1px solid #e6e4ea',
            borderRadius: 999,
            background: '#fff',
            color: '#9ca3af',
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              display: 'flex',
              color: '#9ca3af',
            }}
          >
            <SearchIcon />
          </span>
          <span
            style={{
              position: 'absolute',
              left: 36,
              top: '50%',
              transform: 'translateY(-50%)',
              color: '#9ca3af',
              fontSize: 14,
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Pesquise aqui
          </span>
        </div>

        <p
          className="absolute"
          style={{
            left: 306,
            top: 145,
            fontSize: 24,
            fontWeight: 600,
            color: '#111827',
            letterSpacing: 0,
            lineHeight: 1.2,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          Olá, Bryan Alencar
        </p>

        <p
          className="absolute"
          style={{
            left: 306,
            top: 180,
            width: 528,
            fontSize: 14,
            fontWeight: 400,
            color: '#6b7280',
            letterSpacing: 0,
            lineHeight: 1.4,
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          Veja o resumo das suas métricas e acompanhe o desempenho do seu negócio.
        </p>

        <div className="absolute" style={{ left: 306, top: 226, width: 1520, height: 788 }}>
          <div style={{ position: 'absolute', left: 0, top: 0 }}>
            <KpiCard title="Alunos ativos" value="128" primary footer="avatars" />
          </div>
          <div style={{ position: 'absolute', left: 382, top: 0 }}>
            <KpiCard title="Turmas ativas" value="24" description="Com status ativo" />
          </div>
          <div style={{ position: 'absolute', left: 764, top: 0 }}>
            <KpiCard
              title="Aguardando pagamento"
              value="12.480,00"
              description="Mesmo total de Todas as Cobranças em aberto"
            />
          </div>
          <div style={{ position: 'absolute', left: 1146, top: 0 }}>
            <KpiCard title="Taxa de matrícula" value="8.920,00" footer="period" />
          </div>

          <div style={{ position: 'absolute', left: 0, top: 244 }}>
            <SectionCard
              title="Aula Experimental"
              subtitle="terça-feira, 19 de maio"
              type="aulas"
            />
          </div>
          <div style={{ position: 'absolute', left: 382, top: 244 }}>
            <SectionCard
              title="Aniversários do mês"
              subtitle="maio"
              type="aniversarios"
            />
          </div>

          <div
            style={{
              position: 'absolute',
              left: 764,
              top: 244,
              width: 358,
              height: 260,
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
              padding: '16px 20px',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#111827' }}>
              Atalhos Administrativos
            </p>
            <p style={{ margin: '2px 0 18px', fontSize: 12, color: '#6b7280' }}>
              Acesse os módulos mais usados na operação
            </p>
            {['Alunos', 'Matrículas', 'Relatórios financeiros'].map((item) => (
              <div
                key={item}
                style={{
                  height: 42,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 10px',
                  color: '#4b5563',
                  fontSize: 14,
                }}
              >
                <span>{item}</span>
                <span style={{ color: '#9ca3af', fontSize: 18 }}>→</span>
              </div>
            ))}
          </div>

          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 528,
              width: 1122,
              height: 260,
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
              overflow: 'hidden',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            <div
              style={{
                height: 58,
                borderBottom: '1px solid #f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 24px',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
                Últimas Cobranças
              </span>
              <span
                style={{
                  borderRadius: 8,
                  background: '#f4ecfd',
                  padding: '6px 16px',
                  color: '#383242',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Ver Todas
              </span>
            </div>
            <div style={{ padding: '14px 24px', color: '#6b7280', fontSize: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 24, marginBottom: 16, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>
                <span>Aluno</span>
                <span>Vencimento</span>
                <span>Status</span>
                <span>Valor</span>
              </div>
              {[
                ['Lia Martins', '22 mai.', 'Aguardando', 'R$ 320,00'],
                ['Pedro Rocha', '24 mai.', 'Confirmada', 'R$ 280,00'],
                ['Sofia Lima', '28 mai.', 'Aguardando', 'R$ 340,00'],
              ].map((row) => (
                <div
                  key={row[0]}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    gap: 24,
                    alignItems: 'center',
                    minHeight: 42,
                    borderTop: '1px solid #f3f4f6',
                    color: '#374151',
                    fontSize: 14,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{row[0]}</span>
                  <span>{row[1]}</span>
                  <span>{row[2]}</span>
                  <span>{row[3]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

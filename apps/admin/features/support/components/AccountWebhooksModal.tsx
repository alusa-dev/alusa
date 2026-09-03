'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/icons/Icon';
import { compactId, formatDateTime } from '@/features/support/shared/format';
import {
  StatusBadge,
  SupportField,
} from '@/features/support/shared/SupportUI';

export type AccountWebhookSummary = {
  id: string;
  evento: string;
  eventId: string | null;
  status: string;
  recebidoEm: string;
  processadoEm: string | null;
  ultimoErro: string | null;
};

type AccountWebhookDetail = AccountWebhookSummary & {
  tentativas: number;
  asaasPaymentId: string | null;
  asaasSubscriptionId: string | null;
  asaasTransferId: string | null;
  payload: unknown;
  attemptsLog: unknown;
};

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="account-webhooks-json">{JSON.stringify(value ?? {}, null, 2)}</pre>;
}

export function AccountWebhooksModal({
  contaId,
  webhooks,
}: {
  contaId: string;
  webhooks: AccountWebhookSummary[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(webhooks[0]?.id ?? null);
  const [detail, setDetail] = useState<AccountWebhookDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedId) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/admin/contas/${contaId}/webhooks/${selectedId}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: AccountWebhookDetail;
          error?: string;
        } | null;
        if (!response.ok || !json?.success || !json.data) {
          throw new Error(json?.error ?? 'Não foi possível carregar o webhook.');
        }
        setDetail(json.data);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setDetail(null);
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o webhook.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [contaId, isOpen, selectedId]);

  function openModal() {
    setSelectedId((current) => current ?? webhooks[0]?.id ?? null);
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
    setDetail(null);
    setError(null);
  }

  return (
    <>
      <button type="button" className="account-detail-action" onClick={openModal}>
        Webhooks
      </button>

      {isOpen ? (
        <div className="account-webhooks-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <section className="account-webhooks-modal" role="dialog" aria-modal="true" aria-labelledby="account-webhooks-modal-title">
            <header className="account-webhooks-modal-header">
              <div>
                <h2 id="account-webhooks-modal-title">Webhooks da conta</h2>
              </div>
              <button ref={closeButtonRef} type="button" className="account-webhooks-modal-close" onClick={closeModal} aria-label="Fechar webhooks">
                <Icon name="XMark" size={18} aria-hidden="true" />
              </button>
            </header>

            <aside className="account-webhooks-modal-list">
              <div className="account-webhooks-modal-list-header">
                <div className="account-webhooks-modal-list-heading">
                  <strong>Logs</strong>
                  <small>Eventos recebidos</small>
                </div>
                <span>{webhooks.length}</span>
              </div>
              <div className="account-webhooks-modal-list-scroll">
                {webhooks.length > 0 ? webhooks.map((webhook) => (
                  <button
                    key={webhook.id}
                    type="button"
                    className={`account-webhooks-modal-item${selectedId === webhook.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedId(webhook.id)}
                    aria-pressed={selectedId === webhook.id}
                  >
                    <span className="account-webhooks-modal-item-copy">
                      <strong>{webhook.evento}</strong>
                      <small>{formatDateTime(webhook.recebidoEm)}</small>
                    </span>
                    <StatusBadge value={webhook.status} />
                  </button>
                )) : (
                  <p className="account-webhooks-modal-empty">Nenhum webhook recebido.</p>
                )}
              </div>
            </aside>

            <div className="account-webhooks-modal-detail">
              {loading ? <p className="account-webhooks-modal-state">Carregando detalhes…</p> : null}
              {error ? <p className="account-webhooks-modal-error">{error}</p> : null}
              {!loading && !error && detail ? (
                <>
                  <div className="account-webhooks-modal-detail-heading">
                    <div>
                      <p className="account-webhooks-modal-kicker">Evento selecionado</p>
                      <h3>{detail.evento}</h3>
                    </div>
                    <StatusBadge value={detail.status} />
                  </div>

                  <div className="support-fields account-webhooks-modal-fields">
                    <SupportField label="ID do evento" value={detail.eventId} />
                    <SupportField label="Recebido em" value={formatDateTime(detail.recebidoEm)} />
                    <SupportField label="Processado em" value={formatDateTime(detail.processadoEm)} />
                    <SupportField label="Tentativas" value={detail.tentativas} />
                    <SupportField label="Correlação" value={compactId(detail.asaasPaymentId ?? detail.asaasSubscriptionId ?? detail.asaasTransferId)} />
                    <SupportField label="Erro" value={detail.ultimoErro ?? 'Sem erro'} />
                  </div>

                  <section className="account-webhooks-json-section">
                    <h4>Conteúdo recebido</h4>
                    <JsonBlock value={detail.payload} />
                  </section>

                  <section className="account-webhooks-json-section">
                    <h4>Histórico de tentativas</h4>
                    <JsonBlock value={detail.attemptsLog ?? []} />
                  </section>
                </>
              ) : null}
              {!loading && !error && !detail && webhooks.length === 0 ? (
                <p className="account-webhooks-modal-state">Nenhum detalhe para exibir.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { ArrowPathIcon, BanknotesIcon, CheckCircleIcon, TagIcon } from 'react-native-heroicons/outline';

import { FloatingActionMenu, type FloatingAction } from '@/components/overlays/FloatingActionMenu';
import { eventsService } from '@/features/events/services/events-service';
import type { MobileEvent } from '@/features/events/types/events';

import { EventCostumeLinkSheet } from './EventCostumeLinkSheet';
import { EventFinancialCreateSheet } from './EventFinancialSheet';

export function EventActionsFab({ event, onChanged }: { event: MobileEvent; onChanged: () => void | Promise<void> }) {
  const [financialVisible, setFinancialVisible] = useState(false);
  const [costumeVisible, setCostumeVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const finish = useCallback(async () => {
    setFinishing(true);
    try {
      await eventsService.finishEvent(event.id);
      await onChanged();
      Alert.alert('Evento finalizado', 'O evento foi finalizado com sucesso.');
    } catch (reason) {
      Alert.alert('Não foi possível encerrar', reason instanceof Error ? reason.message : 'Tente novamente.');
    } finally {
      setFinishing(false);
    }
  }, [event.id, onChanged]);

  const requestFinish = useCallback(() => {
    if (finishing) return;
    Alert.alert(
      'Finalizar evento?',
      'Após finalizar, o evento não poderá receber novos vínculos ou alterações operacionais pelo app.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Finalizar evento', style: 'destructive', onPress: () => void finish() },
      ],
    );
  }, [finish, finishing]);

  const reactivate = useCallback(async () => {
    if (reactivating) return;
    setReactivating(true);
    try {
      await eventsService.reactivateEvent(event.id);
      await onChanged();
      Alert.alert('Evento reativado', 'O evento voltou a ficar ativo para ajustes e recebimento de cobranças. As vendas de ingressos continuam encerradas.');
    } catch (reason) {
      Alert.alert('Não foi possível reativar', reason instanceof Error ? reason.message : 'Tente novamente.');
    } finally {
      setReactivating(false);
    }
  }, [event.id, onChanged, reactivating]);

  const requestReactivate = useCallback(() => {
    if (reactivating) return;
    Alert.alert(
      'Reativar evento?',
      'O evento voltará a aceitar ajustes operacionais e financeiros. As vendas de ingressos continuarão encerradas.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Reativar evento', onPress: () => void reactivate() },
      ],
    );
  }, [reactivate, reactivating]);

  const actions = useMemo<FloatingAction[]>(() => {
    const next: FloatingAction[] = [];
    const financialAvailable = !['CANCELLED', 'ARCHIVED'].includes(event.status);
    const costumesAvailable = !['FINISHED', 'CANCELLED', 'ARCHIVED'].includes(event.status);
    if (financialAvailable && event.hasFinancialControl && event.capabilities.canCreateFinancial) {
      next.push({ key: 'financial', label: 'Registrar custo/receita', Icon: BanknotesIcon, onPress: () => setFinancialVisible(true) });
    }
    if (costumesAvailable && event.hasCostumes && event.capabilities.canManageCostumes) {
      next.push({ key: 'costume', label: 'Vincular figurino', Icon: TagIcon, onPress: () => setCostumeVisible(true) });
    }
    if (event.status === 'ACTIVE' && event.capabilities.canFinish) {
      next.push({ key: 'finish', label: finishing ? 'Finalizando evento...' : 'Finalizar evento', Icon: CheckCircleIcon, onPress: requestFinish });
    }
    if (event.status === 'FINISHED' && event.capabilities.canReactivate) {
      next.push({ key: 'reactivate', label: reactivating ? 'Reativando evento...' : 'Reativar evento', Icon: ArrowPathIcon, onPress: requestReactivate });
    }
    return next;
  }, [event.capabilities.canCreateFinancial, event.capabilities.canFinish, event.capabilities.canManageCostumes, event.capabilities.canReactivate, event.hasCostumes, event.hasFinancialControl, event.status, finishing, reactivating, requestFinish, requestReactivate]);

  if (actions.length === 0) return null;

  return (
    <>
      <FloatingActionMenu actions={actions} accessibilityLabel="ações do evento" />
      <EventFinancialCreateSheet
        eventId={event.id}
        visible={financialVisible}
        onClose={() => setFinancialVisible(false)}
        onSaved={onChanged}
      />
      <EventCostumeLinkSheet
        eventId={event.id}
        visible={costumeVisible}
        onClose={() => setCostumeVisible(false)}
        onSaved={onChanged}
      />
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { ClockIcon } from 'react-native-heroicons/outline';

import { DateField, DatePickerSheet } from '@/components/forms/DateField';
import { SelectField } from '@/components/forms/SelectField';
import { BottomSheet } from '@/components/overlays/BottomSheet';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { Button } from '@/components/primitives/Button';
import { AppText } from '@/components/primitives/AppText';
import { TextField } from '@/components/primitives/TextField';
import { agendaService } from '@/features/agenda/services/agenda-service';
import type { AgendaResources, CalendarEventDetails, CalendarEventType } from '@/features/agenda/types/agenda';
import { combineLocalDateTime, dateAndTimeFromInstant, dateFromKey, dateInputLabel } from '@/features/agenda/utils/date';
import { colors, radius, spacing } from '@/theme/tokens';

const eventTypeOptions: Array<{ value: CalendarEventType; label: string }> = [
  { value: 'AULA', label: 'Aula' },
  { value: 'REPOSICAO', label: 'Reposição' },
  { value: 'EVENTO_INTERNO', label: 'Evento interno' },
  { value: 'EVENTO_EXTERNO', label: 'Evento externo' },
  { value: 'WORKSHOP', label: 'Workshop' },
  { value: 'FERIADO', label: 'Feriado' },
  { value: 'PAUSA', label: 'Pausa' },
  { value: 'CANCELAMENTO', label: 'Cancelamento' },
  { value: 'SUBSTITUICAO', label: 'Substituição' },
];

const emptyDate = new Date();
emptyDate.setHours(8, 0, 0, 0);

export default function AgendaCreateScreen() {
  const params = useLocalSearchParams<{ eventId?: string; date?: string }>();
  const eventId = typeof params.eventId === 'string' ? params.eventId : undefined;
  const initialDate = typeof params.date === 'string' ? dateFromKey(params.date) : new Date();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<CalendarEventType>('AULA');
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('09:00');
  const [turmaId, setTurmaId] = useState('');
  const [salaId, setSalaId] = useState('');
  const [professorId, setProfessorId] = useState('');
  const [resources, setResources] = useState<AgendaResources | null>(null);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [timePicker, setTimePicker] = useState<'start' | 'end' | null>(null);
  const [timePickerValue, setTimePickerValue] = useState(emptyDate);

  useEffect(() => {
    let active = true;
    void agendaService.listResources().then((result) => {
      if (active) setResources(result.resources);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    void agendaService.getEvent(eventId)
      .then((result) => {
        if (!active) return;
        applyEvent(result.data);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o evento.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  function applyEvent(event: CalendarEventDetails) {
    const start = dateAndTimeFromInstant(event.startAt);
    const end = dateAndTimeFromInstant(event.endAt);
    setTitle(event.title);
    setDescription(event.description ?? '');
    setType(event.type);
    setDate(start.date);
    setStartTime(start.time);
    setEndTime(end.time);
    setTurmaId(event.turma?.id ?? '');
    setSalaId(event.sala?.id ?? '');
    setProfessorId(event.professores[0]?.id ?? '');
  }

  const turmaOptions = useMemo(() => [{ value: '', label: 'Sem turma' }, ...(resources?.turmas ?? []).map((item) => ({ value: item.id, label: item.label }))], [resources]);
  const salaOptions = useMemo(() => [{ value: '', label: 'Sem sala' }, ...(resources?.salas ?? []).map((item) => ({ value: item.id, label: item.label }))], [resources]);
  const professorOptions = useMemo(() => [{ value: '', label: 'Sem professor' }, ...(resources?.professores ?? []).map((item) => ({ value: item.id, label: item.label }))], [resources]);

  function openTimePicker(field: 'start' | 'end') {
    const value = field === 'start' ? startTime : endTime;
    const [hours, minutes] = value.split(':').map(Number);
    const pickerDate = new Date(date);
    pickerDate.setHours(Number.isFinite(hours) ? hours : 8, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    setTimePickerValue(pickerDate);
    setTimePicker(field);
  }

  function handleTimeChange(event: DateTimePickerEvent, value?: Date) {
    if (event.type === 'dismissed' || !value) return;
    setTimePickerValue(value);
    const formatted = `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    if (timePicker === 'start') setStartTime(formatted);
    if (timePicker === 'end') setEndTime(formatted);
  }

  async function handleSubmit() {
    const normalizedTitle = title.trim();
    if (normalizedTitle.length < 2) {
      setError('Informe um título para o evento.');
      return;
    }

    const startAt = combineLocalDateTime(date, startTime);
    const endAt = combineLocalDateTime(date, endTime);
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      setError('O horário de término precisa ser depois do horário de início.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const input = {
        title: normalizedTitle,
        description: description.trim() || null,
        type,
        startAt,
        endAt,
        turmaId: turmaId || null,
        salaId: salaId || null,
        professorIds: professorId ? [professorId] : [],
      } as const;
      if (eventId) await agendaService.updateEvent(eventId, input);
      else await agendaService.createEvent(input);
      Alert.alert(
        eventId ? 'Evento atualizado' : 'Evento criado',
        eventId ? 'As alterações foram salvas.' : 'O evento foi adicionado à agenda.',
        [{ text: 'OK', onPress: () => router.back() }],
        { cancelable: false },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o evento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <PageHeader title={eventId ? 'Editar evento' : 'Novo evento'} onBack={() => router.back()} />
      {loading ? <View style={styles.loading}><AppText tone="muted">Carregando evento...</AppText></View> : (
        <View style={styles.content}>
          <View style={styles.introduction}><AppText variant="subheading" weight="medium">Dados do evento</AppText><AppText variant="small" tone="muted">Organize um compromisso para a escola.</AppText></View>
          <TextField label="Título" value={title} onChangeText={setTitle} placeholder="Ex.: Aula de ballet" returnKeyType="next" />
          <SelectField label="Tipo de evento" value={eventTypeOptions.find((item) => item.value === type)?.label ?? 'Aula'} selectedValue={type} options={eventTypeOptions} onValueChange={(value) => setType(value as CalendarEventType)} />
          <DateField label="Data" value={dateInputLabel(date)} onPress={() => setDatePickerVisible(true)} />
          <View style={styles.timeRow}>
            <TimeField label="Início" value={startTime} onPress={() => openTimePicker('start')} />
            <TimeField label="Término" value={endTime} onPress={() => openTimePicker('end')} />
          </View>
          <SelectField label="Turma" value={resources?.turmas.find((item) => item.id === turmaId)?.label ?? 'Sem turma'} selectedValue={turmaId} options={turmaOptions} onValueChange={setTurmaId} />
          <SelectField label="Professor" value={resources?.professores.find((item) => item.id === professorId)?.label ?? 'Sem professor'} selectedValue={professorId} options={professorOptions} onValueChange={setProfessorId} />
          <SelectField label="Sala" value={resources?.salas.find((item) => item.id === salaId)?.label ?? 'Sem sala'} selectedValue={salaId} options={salaOptions} onValueChange={setSalaId} />
          <TextField label="Descrição (opcional)" value={description} onChangeText={setDescription} placeholder="Adicione uma observação" multiline style={styles.descriptionInput} shellStyle={styles.descriptionShell} />
          {error ? <View style={styles.errorBox}><AppText variant="small" tone="danger">{error}</AppText></View> : null}
          <Button title={eventId ? 'Salvar alterações' : 'Criar evento'} loading={saving} onPress={() => void handleSubmit()} />
        </View>
      )}
      <DatePickerSheet visible={datePickerVisible} selectedDate={date} onDateChange={(_event, value) => value && setDate(value)} onClose={() => setDatePickerVisible(false)} onConfirm={() => setDatePickerVisible(false)} />
      <TimePickerSheet visible={timePicker !== null} selectedDate={timePickerValue} title={timePicker === 'start' ? 'Horário de início' : 'Horário de término'} onChange={handleTimeChange} onClose={() => setTimePicker(null)} onConfirm={() => setTimePicker(null)} />
    </Screen>
  );
}

function TimeField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return <View style={styles.timeFieldGroup}><AppText variant="label" weight="medium" tone="muted">{label}</AppText><Pressable accessibilityRole="button" accessibilityLabel={`Selecionar ${label.toLowerCase()}`} onPress={onPress} style={({ pressed }) => [styles.timeField, pressed ? styles.pressed : null]}><AppText>{value}</AppText><ClockIcon color={colors.inkMuted} size={20} strokeWidth={1.8} /></Pressable></View>;
}

function TimePickerSheet({ visible, selectedDate, title, onChange, onClose, onConfirm }: { visible: boolean; selectedDate: Date; title: string; onChange: (_event: DateTimePickerEvent, _value?: Date) => void; onClose: () => void; onConfirm: () => void }) {
  return <BottomSheet visible={visible} onClose={onClose} maxHeight="52%" accessibilityLabel={title}><AppText variant="subheading" weight="medium">{title}</AppText><DateTimePicker value={selectedDate} mode="time" display="spinner" onChange={onChange} locale="pt-BR" /><Button title="Usar este horário" onPress={onConfirm} /></BottomSheet>;
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, paddingBottom: spacing['2xl'] },
  content: { gap: spacing.lg },
  introduction: { gap: spacing.xs },
  loading: { minHeight: 240, alignItems: 'center', justifyContent: 'center' },
  timeRow: { flexDirection: 'row', gap: spacing.md },
  timeFieldGroup: { flex: 1, gap: spacing.sm },
  timeField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surfaceNeutral },
  descriptionShell: { minHeight: 92, alignItems: 'flex-start', paddingVertical: spacing.md },
  descriptionInput: { minHeight: 68, textAlignVertical: 'top', paddingTop: 0 },
  errorBox: { padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  pressed: { opacity: 0.72 },
});

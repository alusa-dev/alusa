import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { CheckCircleIcon, XCircleIcon } from 'react-native-heroicons/outline';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EditSaveAction } from '@/components/forms/EditSaveAction';
import { EditableDataField } from '@/components/forms/EditableDataField';
import { SelectField } from '@/components/forms/SelectField';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { useUnsavedChangesPrompt } from '@/hooks/use-unsaved-changes-prompt';
import { lookupCep } from '@/lib/address/cep-service';
import { profileService } from '@/features/profile/services/profile-service';
import type { MobileProfile } from '@/features/profile/types/profile';
import { colors, spacing } from '@/theme/tokens';

const timezoneOptions = [
  { value: 'America/Sao_Paulo', label: 'Brasília, Sudeste e Sul' },
  { value: 'America/Manaus', label: 'Amazonas' },
  { value: 'America/Rio_Branco', label: 'Acre' },
  { value: 'America/Noronha', label: 'Fernando de Noronha' },
];

type SchoolForm = {
  name: string;
  timezone: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  cep: string;
};

type CepStatus = 'idle' | 'loading' | 'valid' | 'invalid';

export default function SchoolDataScreen() {
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [form, setForm] = useState<SchoolForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cepStatus, setCepStatus] = useState<CepStatus>('idle');
  const [cepError, setCepError] = useState<string | null>(null);
  const cepLookupSequence = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextProfile = await profileService.getProfile();
      setProfile(nextProfile);
      setForm(toForm(nextProfile));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar os dados escolares.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const school = profile?.school;
  const canEdit = profile?.permissions.canEditSchool === true;
  const hasChanges = useMemo(() => {
    if (!school || !form || !canEdit) return false;
    return form.name.trim() !== school.name.trim()
      || form.timezone !== school.timezone
      || form.street.trim() !== (school.address.street ?? '').trim()
      || form.number.trim() !== (school.address.number ?? '').trim()
      || form.neighborhood.trim() !== (school.address.neighborhood ?? '').trim()
      || form.city.trim() !== (school.address.city ?? '').trim()
      || form.state.trim().toUpperCase() !== (school.address.state ?? '').trim().toUpperCase()
      || onlyDigits(form.cep) !== onlyDigits(school.address.cep ?? '');
  }, [canEdit, form, school]);

  const timezoneChoices = useMemo(() => {
    if (!school?.timezone || timezoneOptions.some((option) => option.value === school.timezone)) return timezoneOptions;
    return [{ value: school.timezone, label: school.timezone }, ...timezoneOptions];
  }, [school?.timezone]);

  const cepDigits = onlyDigits(form?.cep ?? '');

  useEffect(() => {
    if (!editing || !canEdit || cepDigits.length !== 8) {
      cepLookupSequence.current += 1;
      setCepStatus('idle');
      setCepError(null);
      return;
    }

    const requestSequence = ++cepLookupSequence.current;
    setCepStatus('loading');
    setCepError(null);

    void lookupCep(cepDigits).then((address) => {
      if (requestSequence !== cepLookupSequence.current) return;

      if (!address) {
        setCepStatus('invalid');
        setCepError('Não encontramos esse CEP. Confira os números e tente novamente.');
        return;
      }

      setCepStatus('valid');
      setForm((current) => current ? {
        ...current,
        street: address.street,
        neighborhood: address.neighborhood,
        city: address.city,
        state: address.state,
      } : current);
    });
  }, [canEdit, cepDigits, editing]);

  const save = useCallback(async () => {
    if (!form || saving || !canEdit) return false;
    if (form.name.trim().length < 2) {
      setSaveError('Informe o nome da escola.');
      return false;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const nextProfile = await profileService.updateProfile({
        school: {
          name: form.name,
          timezone: form.timezone,
          address: {
            street: form.street,
            number: form.number,
            neighborhood: form.neighborhood,
            city: form.city,
            state: form.state,
            cep: form.cep,
          },
        },
      });
      setProfile(nextProfile);
      setForm(toForm(nextProfile));
      return true;
    } catch (saveLoadError) {
      setSaveError(saveLoadError instanceof Error ? saveLoadError.message : 'Não foi possível salvar os dados da escola.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, form, saving]);

  const handleEditAction = useCallback(() => {
    if (!canEdit) return;

    if (!editing) {
      setCepStatus('idle');
      setCepError(null);
      setEditing(true);
      return;
    }

    if (!hasChanges) {
      setEditing(false);
      setSaveError(null);
      return;
    }

    void save().then((saved) => {
      if (saved) setEditing(false);
    });
  }, [canEdit, editing, hasChanges, save]);

  useUnsavedChangesPrompt({ hasChanges, saving, onSave: save });

  function update<K extends keyof SchoolForm>(key: K, value: SchoolForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <PageHeader
        title="Dados escolares"
        onBack={() => router.back()}
        rightElement={!loading && !error && school && canEdit ? <EditSaveAction editing={editing} saving={saving} onPress={handleEditAction} /> : undefined}
      />
      {loading ? <SchoolDataSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : null}
      {!loading && !error && school && form ? (
        <View style={styles.content}>
          <View style={styles.form}>
            <EditableDataField label="Nome da escola" editing={editing} displayValue={form.name} value={form.name} editable={canEdit} onChangeText={(value) => update('name', value)} autoCapitalize="words" />
            <EditableDataField label="CPF/CNPJ" editing={editing} displayValue={displayValue(formatCpfCnpj(school.cpfCnpj))} value={displayValue(formatCpfCnpj(school.cpfCnpj))} editable={false} showInputWhenEditing />
            {editing && canEdit ? <SelectField label="Fuso horário" value={timezoneLabel(form.timezone, timezoneChoices)} selectedValue={form.timezone} options={timezoneChoices} onValueChange={(value) => update('timezone', value)} /> : <EditableDataField label="Fuso horário" editing={false} displayValue={displayValue(school.timezone)} value={displayValue(school.timezone)} editable={false} />}
          </View>

          <View style={styles.addressSection}>
            <AppText variant="subheading" weight="medium">Endereço da escola</AppText>
            <View style={styles.form}>
              <EditableDataField
                label="CEP"
                editing={editing}
                displayValue={formatCep(form.cep)}
                value={formatCep(form.cep)}
                editable={canEdit}
                onChangeText={(value) => {
                  update('cep', formatCep(value));
                  setCepError(null);
                }}
                keyboardType="number-pad"
                maxLength={9}
                error={editing && canEdit ? cepError ?? undefined : undefined}
                rightElement={editing && canEdit ? <CepStatusIcon status={cepStatus} /> : undefined}
              />
              <EditableDataField label="Logradouro" editing={editing} displayValue={form.street} value={form.street} editable={canEdit} onChangeText={(value) => update('street', value)} />
              <EditableDataField label="Número" editing={editing} displayValue={form.number} value={form.number} editable={canEdit} onChangeText={(value) => update('number', value)} keyboardType="number-pad" />
              <EditableDataField label="Bairro" editing={editing} displayValue={form.neighborhood} value={form.neighborhood} editable={canEdit} onChangeText={(value) => update('neighborhood', value)} />
              <EditableDataField label="Cidade" editing={editing} displayValue={form.city} value={form.city} editable={canEdit} onChangeText={(value) => update('city', value)} />
              <EditableDataField label="Estado" editing={editing} displayValue={form.state} value={form.state} editable={canEdit} onChangeText={(value) => update('state', value)} autoCapitalize="characters" maxLength={2} />
            </View>
          </View>

          <AppText variant="small" tone="muted">
            O CPF/CNPJ identifica a conta financeira e não pode ser alterado nesta tela.
          </AppText>
          {!canEdit ? <AppText variant="small" tone="muted">Somente administradores podem editar os dados da escola.</AppText> : null}
          {saveError ? <AppText variant="small" tone="danger">{saveError}</AppText> : null}
        </View>
      ) : null}
    </Screen>
  );
}

function toForm(profile: MobileProfile): SchoolForm {
  return {
    name: profile.school.name,
    timezone: profile.school.timezone,
    street: profile.school.address.street ?? '',
    number: profile.school.address.number ?? '',
    neighborhood: profile.school.address.neighborhood ?? '',
    city: profile.school.address.city ?? '',
    state: profile.school.address.state ?? '',
    cep: profile.school.address.cep ?? '',
  };
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || 'Não informado';
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function timezoneLabel(value: string, options: Array<{ value: string; label: string }>) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function formatCpfCnpj(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  if (digits.length === 14) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  return value;
}

function formatCep(value: string | null | undefined) {
  const digits = onlyDigits(value ?? '').slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function CepStatusIcon({ status }: { status: CepStatus }) {
  if (status === 'loading') return <ActivityIndicator color={colors.brand} size="small" />;
  if (status === 'valid') return <CheckCircleIcon color={colors.success} size={21} strokeWidth={1.8} />;
  if (status === 'invalid') return <XCircleIcon color={colors.danger} size={21} strokeWidth={1.8} />;
  return null;
}

function SchoolDataSkeleton() {
  return <View style={styles.form} accessibilityLabel="Carregando dados escolares">{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((item) => <View key={item} style={styles.skeletonField}><Skeleton width="38%" height={16} /><Skeleton height={52} radius={14} /></View>)}</View>;
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing.xl },
  content: { gap: spacing.lg },
  form: { gap: spacing.lg },
  addressSection: { gap: spacing.lg },
  skeletonField: { gap: spacing.sm },
});

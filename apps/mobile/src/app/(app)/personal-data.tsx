import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EditSaveAction } from '@/components/forms/EditSaveAction';
import { EditableDataField } from '@/components/forms/EditableDataField';
import { PageHeader } from '@/components/layout/PageHeader';
import { Screen } from '@/components/layout/Screen';
import { AppText } from '@/components/primitives/AppText';
import { useUnsavedChangesPrompt } from '@/hooks/use-unsaved-changes-prompt';
import { profileService } from '@/features/profile/services/profile-service';
import type { MobileProfile } from '@/features/profile/types/profile';
import { colors, spacing } from '@/theme/tokens';

type PersonalForm = {
  name: string;
  telefone: string;
  bio: string;
};

export default function PersonalDataScreen() {
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [form, setForm] = useState<PersonalForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
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
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar seus dados pessoais.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasChanges = useMemo(() => {
    if (!profile || !form) return false;
    return form.name.trim() !== profile.personal.name.trim()
      || onlyDigits(form.telefone) !== onlyDigits(profile.personal.telefone ?? '')
      || form.bio.trim() !== (profile.personal.bio ?? '').trim();
  }, [form, profile]);

  const save = useCallback(async () => {
    if (!form || saving) return false;
    if (form.name.trim().length < 2) {
      setSaveError('Informe seu nome completo.');
      return false;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const nextProfile = await profileService.updateProfile({
        personal: {
          name: form.name,
          telefone: form.telefone,
          bio: form.bio,
        },
      });
      setProfile(nextProfile);
      setForm(toForm(nextProfile));
      return true;
    } catch (saveLoadError) {
      setSaveError(saveLoadError instanceof Error ? saveLoadError.message : 'Não foi possível salvar seus dados.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [form, saving]);

  const handleEditAction = useCallback(() => {
    if (!editing) {
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
  }, [editing, hasChanges, save]);

  useUnsavedChangesPrompt({ hasChanges, saving, onSave: save });

  function update<K extends keyof PersonalForm>(key: K, value: PersonalForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <Screen scroll keyboard backgroundColor={colors.surface} style={styles.screen}>
      <PageHeader
        title="Dados pessoais"
        onBack={() => router.back()}
        rightElement={!loading && !error && profile ? <EditSaveAction editing={editing} saving={saving} onPress={handleEditAction} /> : undefined}
      />
      {loading ? <PersonalDataSkeleton /> : null}
      {!loading && error ? <ErrorState title="Não foi possível carregar" message={error} actionLabel="Tentar novamente" onAction={() => void load()} /> : null}
      {!loading && !error && profile && form ? (
        <View style={styles.content}>
          <View style={styles.form}>
            <EditableDataField label="Nome completo" editing={editing} displayValue={form.name} value={form.name} onChangeText={(value) => update('name', value)} autoCapitalize="words" />
            <EditableDataField label="E-mail" editing={editing} displayValue={displayValue(profile.personal.email)} value={displayValue(profile.personal.email)} editable={false} showInputWhenEditing keyboardType="email-address" />
            <EditableDataField label="Telefone" editing={editing} displayValue={form.telefone} value={form.telefone} onChangeText={(value) => update('telefone', value)} keyboardType="phone-pad" />
            <EditableDataField label="Data de nascimento" editing={editing} displayValue={displayValue(formatDate(profile.personal.birthDate))} value={displayValue(formatDate(profile.personal.birthDate))} editable={false} showInputWhenEditing />
            <EditableDataField label="Bio" editing={editing} displayValue={form.bio} value={form.bio} onChangeText={(value) => update('bio', value)} multiline numberOfLines={3} style={styles.bioInput} />
          </View>

          <AppText variant="small" tone="muted">
            Por segurança, o e-mail e a data de nascimento são mantidos como dados de identificação da conta.
          </AppText>
          {saveError ? <AppText variant="small" tone="danger">{saveError}</AppText> : null}
        </View>
      ) : null}
    </Screen>
  );
}

function toForm(profile: MobileProfile): PersonalForm {
  return {
    name: profile.personal.name,
    telefone: profile.personal.telefone ?? '',
    bio: profile.personal.bio ?? '',
  };
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || 'Não informado';
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function formatDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : null;
}

function PersonalDataSkeleton() {
  return <View style={styles.form} accessibilityLabel="Carregando dados pessoais">{[0, 1, 2, 3, 4].map((item) => <View key={item} style={styles.skeletonField}><Skeleton width="34%" height={16} /><Skeleton height={52} radius={14} /></View>)}</View>;
}

const styles = StyleSheet.create({
  screen: { gap: spacing.xl, paddingBottom: spacing.xl },
  content: { gap: spacing.lg },
  form: { gap: spacing.lg },
  bioInput: { minHeight: 84, paddingTop: spacing.md, textAlignVertical: 'top' },
  skeletonField: { gap: spacing.sm },
});

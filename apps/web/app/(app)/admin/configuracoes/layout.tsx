import React from 'react';
import { SettingsLayoutShell } from '@/features/settings/components/SettingsLayoutShell';

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  return <SettingsLayoutShell>{children}</SettingsLayoutShell>;
}

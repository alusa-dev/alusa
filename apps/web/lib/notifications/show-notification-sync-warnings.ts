import { formatNotificationWarningsForUi } from '@alusa/lib';
import { toast, CustomToast } from '@/components/ui/toast';

export type NotificationSyncWarningLike = {
  channel: string;
  message: string;
  code?: string;
};

export function showNotificationSyncWarnings(
  warnings: NotificationSyncWarningLike[],
  options?: { title?: string; durationMs?: number },
) {
  if (!warnings.length) return;

  const lines = formatNotificationWarningsForUi(warnings);
  const description =
    lines.length === 1
      ? lines[0]
      : lines.slice(0, 3).join(' · ') + (lines.length > 3 ? ` (+${lines.length - 3})` : '');

  toast.custom(
    (t) => (
      <CustomToast
        variant="warning"
        title={options?.title ?? 'Aviso sobre notificações'}
        description={description}
        onClose={() => toast.dismiss(t)}
      />
    ),
    { duration: options?.durationMs ?? 8000 },
  );
}

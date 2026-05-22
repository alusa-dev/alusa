'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { toast } from '@/components/ui/toast';

import { createEventMap } from '../api/event-map-service';
import { MapEditorLoading } from './MapEditorLoading';

export function CreateEventMapRoute({ eventId }: { eventId: string }) {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    createEventMap(eventId, { name: 'Mapa principal' })
      .then((map) => {
        if (!active) return;
        router.replace(`/events/${eventId}/maps/${map.id}/editor`);
      })
      .catch((error) => {
        if (!active) return;
        toast.error({ title: 'Não foi possível criar o mapa', description: (error as Error).message });
        router.replace(`/events/${eventId}`);
      });

    return () => {
      active = false;
    };
  }, [eventId, router]);

  return <MapEditorLoading label="Preparando novo mapa do evento" />;
}

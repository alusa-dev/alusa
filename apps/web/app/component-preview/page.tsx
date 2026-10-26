import type { Metadata } from 'next';

import { ComponentPreviewCarousel } from './ComponentPreviewCarousel';

export const metadata: Metadata = {
  title: 'Component Preview',
};

export default function ComponentPreviewPage() {
  return <ComponentPreviewCarousel />;
}

import type { MetadataRoute } from 'next';
import { siteMetadata } from '@/features/site/lib/metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteMetadata.url,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}

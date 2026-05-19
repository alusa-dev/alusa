import type { MetadataRoute } from 'next';
import { siteMetadata } from '@/lib/metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteMetadata.url,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1
    }
  ];
}

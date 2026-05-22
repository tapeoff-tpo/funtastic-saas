import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Funtastic SaaS',
    short_name: 'Funtastic',
    description: 'Mobile inspection and commerce operations',
    start_url: '/mobile/inspection',
    scope: '/',
    display: 'standalone',
    background_color: '#111827',
    theme_color: '#111827',
    orientation: 'portrait',
    categories: ['business', 'productivity'],
  }
}

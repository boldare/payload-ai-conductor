import type { Block } from 'payload'

export const Hero: Block = {
  slug: 'hero',
  custom: {
    aiConductor: {
      description:
        'Full-width hero banner for the top of a page: large heading, optional subheading, background image, and a single call-to-action button. Use once, at the very top of a landing page.',
      examples: [
        {
          ctaHref: '/docs',
          ctaLabel: 'Get started',
          heading: 'Build faster with AI Conductor',
          subheading: 'Compose pages by chatting with your own block library.',
        },
      ],
    },
  },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'subheading', type: 'text' },
    { name: 'backgroundImage', type: 'upload', relationTo: 'media' },
    { name: 'ctaLabel', type: 'text' },
    { name: 'ctaHref', type: 'text' },
  ],
  interfaceName: 'HeroBlock',
}

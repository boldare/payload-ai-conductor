import type { Block } from 'payload'

export const Grid: Block = {
  slug: 'grid',
  custom: {
    aiConductor: {
      description:
        'A multi-column grid of short feature/benefit items, each with an optional icon, a title, and a short description. Use for feature lists, not testimonials or pricing tables.',
      examples: [
        {
          columns: 3,
          items: [
            { description: 'Ships in minutes, not weeks.', icon: 'zap', title: 'Fast' },
            {
              description: 'Every change is proposed before it is applied.',
              icon: 'shield',
              title: 'Safe',
            },
            {
              description: 'Works with any block library.',
              icon: 'blocks',
              title: 'Flexible',
            },
          ],
        },
      ],
    },
  },
  fields: [
    { name: 'columns', type: 'number', defaultValue: 3, max: 4, min: 1 },
    {
      name: 'items',
      type: 'array',
      fields: [
        { name: 'icon', type: 'text' },
        { name: 'title', type: 'text', required: true },
        { name: 'description', type: 'textarea' },
      ],
      minRows: 1,
    },
  ],
  interfaceName: 'GridBlock',
}

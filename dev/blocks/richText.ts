import type { Block } from 'payload'

export const RichTextBlock: Block = {
  slug: 'richText',
  custom: {
    aiConductor: {
      description:
        'Freeform rich text content — paragraphs, headings, lists, links. Use for body copy between other blocks, not for structured layout like grids or CTAs.',
      examples: [],
    },
  },
  fields: [{ name: 'content', type: 'richText', required: true }],
  interfaceName: 'RichTextBlock',
}

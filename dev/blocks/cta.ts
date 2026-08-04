import type { Block } from 'payload'

export const CallToAction: Block = {
  slug: 'cta',
  custom: {
    aiConductor: {
      description:
        'A single, prominent call-to-action banner — one heading, one button. Use to drive a specific action (sign up, contact, buy) between content sections, not at the top of the page.',
      examples: [
        {
          buttonHref: '/signup',
          buttonLabel: 'Start free',
          heading: 'Ready to try it?',
          style: 'primary',
        },
      ],
    },
  },
  fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'buttonLabel', type: 'text', required: true },
    { name: 'buttonHref', type: 'text', required: true },
    {
      name: 'style',
      type: 'select',
      defaultValue: 'primary',
      options: [
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
      ],
    },
  ],
  interfaceName: 'CallToActionBlock',
}

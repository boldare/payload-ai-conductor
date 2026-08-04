import type { Block } from 'payload'

export const Testimonial: Block = {
  slug: 'testimonial',
  fields: [
    { name: 'quote', type: 'textarea', required: true },
    { name: 'authorName', type: 'text', required: true },
    { name: 'authorRole', type: 'text' },
    { name: 'avatar', type: 'upload', relationTo: 'media' },
  ],
  interfaceName: 'TestimonialBlock',
}

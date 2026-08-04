import type { Media, Page } from '../../../payload-types.js'

import config from '@payload-config'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { notFound } from 'next/navigation.js'
import { getPayload } from 'payload'
import React from 'react'

type PageBlock = NonNullable<Page['layout']>[number]

const resolveImageUrl = (image: Media | null | number | undefined): string | undefined =>
  typeof image === 'object' && image !== null && typeof image.url === 'string' ? image.url : undefined

const Block = ({ block }: { block: PageBlock }) => {
  switch (block.blockType) {
    case 'cta':
      return (
        <section style={{ padding: '32px 0', textAlign: 'center' }}>
          <h2>{block.heading}</h2>
          <a href={block.buttonHref}>{block.buttonLabel}</a>
        </section>
      )
    case 'grid':
      return (
        <section
          style={{ display: 'grid', gap: 24, gridTemplateColumns: `repeat(${block.columns ?? 3}, 1fr)`, padding: '32px 0' }}
        >
          {block.items?.map((item, index) => (
            <div key={item.id ?? index}>
              <h3>{item.title}</h3>
              {item.description && <p>{item.description}</p>}
            </div>
          ))}
        </section>
      )
    case 'hero': {
      const imageUrl = resolveImageUrl(block.backgroundImage)
      return (
        <section
          style={{
            backgroundImage: imageUrl ? `url(${imageUrl})` : undefined,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            padding: '64px 24px',
            textAlign: 'center',
          }}
        >
          <h1>{block.heading}</h1>
          {block.subheading && <p>{block.subheading}</p>}
          {block.ctaLabel && block.ctaHref && <a href={block.ctaHref}>{block.ctaLabel}</a>}
        </section>
      )
    }
    case 'richText':
      return (
        <section style={{ padding: '32px 0' }}>
          <RichText data={block.content} />
        </section>
      )
    case 'testimonial': {
      const avatarUrl = resolveImageUrl(block.avatar)
      return (
        <section style={{ padding: '32px 0', textAlign: 'center' }}>
          {avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- dev-only preview route, no image optimization needed
            <img alt="" src={avatarUrl} style={{ borderRadius: '50%', height: 64, width: 64 }} />
          )}
          <blockquote>{block.quote}</blockquote>
          <p>
            {block.authorName}
            {block.authorRole ? `, ${block.authorRole}` : ''}
          </p>
        </section>
      )
    }
    default:
      return null
  }
}

export default async function PageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const payload = await getPayload({ config })
  const { docs } = await payload.find({ collection: 'pages', limit: 1, where: { slug: { equals: slug } } })
  const doc = docs[0]

  if (!doc) {
    notFound()
  }

  return (
    <main style={{ margin: '0 auto', maxWidth: 960 }}>
      {doc.layout?.map((block, index) => <Block block={block} key={block.id ?? index} />)}
    </main>
  )
}

import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadAiConductor } from 'payload-ai-conductor'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { CallToAction } from './blocks/cta.js'
import { Grid } from './blocks/grid.js'
import { Hero } from './blocks/hero.js'
import { RichTextBlock } from './blocks/richText.js'
import { Testimonial } from './blocks/testimonial.js'
import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const databaseFile = process.env.NODE_ENV === 'test' ? 'test.db' : 'dev.db'

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    {
      slug: 'users',
      auth: { useAPIKey: true },
      fields: [],
    },
    {
      slug: 'pages',
      admin: {
        useAsTitle: 'title',
      },
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'slug', type: 'text', required: true, unique: true },
        {
          name: 'layout',
          type: 'blocks',
          blocks: [Hero, RichTextBlock, CallToAction, Grid, Testimonial],
        },
      ],
    },
    {
      slug: 'media',
      fields: [],
      upload: {
        staticDir: path.resolve(dirname, 'media'),
      },
    },
  ],
  db: sqliteAdapter({
    client: {
      url: `file:${path.resolve(dirname, databaseFile)}`,
    },
  }),
  editor: lexicalEditor(),
  email: testEmailAdapter,
  onInit: async (payload) => {
    await seed(payload)
  },
  plugins: [
    payloadAiConductor({
      blocksDir: path.resolve(dirname, 'blocks'),
      collections: ['pages'],
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
  sharp,
  typescript: {
    // Payload auto-spawns a background `generate:types` process on every init otherwise (every test
    // file's beforeAll) — regenerate explicitly via `pnpm dev:generate-types` instead.
    autoGenerate: false,
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})

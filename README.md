<div align="center">

# AI Conductor

**Compose and edit Payload pages by chatting — grounded in your real block library, gated by your explicit approval.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Payload](https://img.shields.io/badge/payload-3.x-black.svg)](https://payloadcms.com)
[![Node](https://img.shields.io/badge/node-%E2%89%A520.9-green.svg)](package.json)

</div>

---

## Why this exists

Most "AI page builder" demos fall apart in production for two reasons: the agent invents fields, blocks, or IDs
that don't exist — and it writes to your database before anyone's looked at what it's doing.

AI Conductor fixes both. Every proposal is built from your **real, live schema**, so the agent can only use blocks
and fields that actually exist. And it never touches your database until a human explicitly approves. The same
grounded, approval-gated tool layer works two ways: as a **chat panel inside your Payload admin**, and as a
**standalone [MCP](https://modelcontextprotocol.io) server** for external agents like Claude Desktop and Claude Code.

## How it works

1. **Ask** — describe the page or edit you want, in plain language.
2. **Ground** — the agent inspects your actual collections and block schemas. No guessing.
3. **Propose** — it drafts a layout and shows you exactly what it would write.
4. **Approve** — you accept, revise, or reject. Nothing is written until you say so.

## Highlights

- 🧩 **Schema-grounded** — every block, field, and relationship ID is checked against your real config.
- ✅ **Propose → approve** — writes only happen after explicit human sign-off, in chat or over MCP.
- 🔌 **Zero-touch adoption** — works on any collection with a `blocks` field, no schema changes required.
- 🔑 **BYOK, model-agnostic** — bring your own Anthropic or OpenAI key, from the admin UI or env vars.
- 📎 **Attachments** — drop in a reference image for a block, or a brief for context — the agent can use both.
- 🕵️ **Debug mode** — tool-call noise stays hidden by default, one toggle away when you want to see everything.
- 📜 **Audit trail** — every applied change and conversation is recorded, per user.
- 🌐 **MCP included** — the same tools, exposed to Claude Desktop, Claude Code, or any MCP client.

## Quick start

**1. Install**

```sh
pnpm add payload-ai-conductor
```

**2. Register the plugin**

```ts
import { buildConfig } from 'payload'
import { payloadAiConductor } from 'payload-ai-conductor'

export default buildConfig({
  plugins: [
    payloadAiConductor({
      collections: ['pages'], // optional — omit to auto-discover every collection with a `blocks` field
    }),
  ],
})
```

**3. Regenerate your types** (however you normally do it)

```sh
pnpm payload generate:types
```

**4. Set a model key** — either fill in the **Settings** screen now in your admin nav, or use env vars:

```sh
AI_CONDUCTOR_PROVIDER=anthropic
AI_CONDUCTOR_API_KEY=sk-ant-...
AI_CONDUCTOR_MODEL=claude-sonnet-5
```

Open **AI Conductor** in your admin nav — you're chatting.

> **Lock down the Settings screen.** That screen holds your decrypted API key. Without a `settingsAccess`
> rule, Payload's own default applies — *any logged-in user*, not just admins:
>
> ```ts
> payloadAiConductor({
>   settingsAccess: ({ req }) => req.user?.role === 'admin', // match your own role check
> })
> ```

## Teach it your blocks

Descriptions are optional, but they make proposals sharper. Pick whichever fits:

**Inline**, next to the block definition:

```ts
export const CallToAction: Block = {
  slug: 'cta',
  custom: {
    aiConductor: {
      description: 'A prominent call-to-action banner. Use mid-page, not at the top.',
      examples: [{ heading: 'Ready to try it?', buttonLabel: 'Start free', buttonHref: '/signup' }],
    },
  },
  fields: [
    /* ... */
  ],
}
```

**Markdown**, with zero changes to existing block files:

```ts
payloadAiConductor({ blocksDir: path.resolve(dirname, 'block-docs') }) // looks up ./block-docs/<slug>.md
```

```md
---
examples:
  - heading: 'Ready to try it?'
    buttonLabel: 'Start free'
---

A prominent call-to-action banner. Use mid-page, not at the top.
```

## Using it

**In the admin** — click **AI Conductor** in the nav, or **Ask AI Conductor** on any document's edit view for
page-scoped context. Attach an image to use it directly in a block, or a file just for context.

**Over MCP** — point any MCP client at your site, authenticated as a restricted (non-admin) Payload user:

```json
{
  "mcpServers": {
    "ai-conductor": {
      "url": "https://your-site.example.com/api/plugin/ai-conductor/mcp",
      "headers": { "Authorization": "users API-Key YOUR_API_KEY" }
    }
  }
}
```

Exposed tools: `list_collections`, `get_collection_schema`, `list_blocks`, `get_block_schema`, `search_documents`,
`propose_layout`, `revise_proposal`, `apply_proposal`.

## Guardrails

- `apply_proposal` is the only tool that writes — only after validation, and, in chat, only after your approval.
- `maxSteps` / `timeoutMs` bound how long and how far a single turn can run.
- Debug mode is off by default; a pending approval is always shown regardless of that setting.

## Plugin options

| Option           | Type                                           | Description                                                                        |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `collections`    | `string[]`                                       | Restrict AI Conductor to specific collections. Defaults to every `blocks`-field collection. |
| `blocksDir`      | `string`                                         | Directory to look up `<slug>.md` docs by convention.                               |
| `blockDocs`      | `Array<{ slug: string; path: string }>`          | Explicit markdown doc paths for specific block slugs.                              |
| `maxSteps`       | `number`                                         | Default max agent steps per chat turn (overridable from Settings).                 |
| `getModelConfig` | `(req) => ModelConfig \| Promise<ModelConfig>`   | Fully custom BYOK resolution, taking priority over Settings and env vars.           |
| `settingsAccess` | `Access`                                         | Who can view/edit the Settings screen (and its decrypted API key). Defaults to Payload's own default — any logged-in user — so set this for any real deployment. |
| `disabled`       | `boolean`                                        | Disable the plugin without removing it from your config.                           |

## Local development

```sh
pnpm install
cp dev/.env.example dev/.env   # set PAYLOAD_SECRET
pnpm dev                       # http://localhost:3400/admin
```

`dev/` is a throwaway Payload install for developing the plugin itself — a small reference block library
(Hero, RichText, CTA, Grid, Testimonial) plus a public page-preview route.

```sh
pnpm lint
pnpm test:int   # vitest — unit + integration
pnpm test:e2e   # playwright — admin UI end to end
```

`dev/eval.int.spec.ts` runs the real agent loop against a live model with an LLM-judge rubric. It needs
`AI_CONDUCTOR_PROVIDER`/`AI_CONDUCTOR_API_KEY`/`AI_CONDUCTOR_MODEL` and skips itself otherwise, so the rest of the
suite stays green without a key.

## License

MIT

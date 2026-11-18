#!/usr/bin/env node
/**
 * Packs the plugin exactly the way `npm publish` would, installs the tarball into a fresh project
 * outside this repo, and checks that every public entry point actually loads and type-checks there.
 *
 * Guards against the 1.0.0 regression where `exports` pointed at ./src/*.ts while `files` only
 * shipped ./dist — fine inside this repo (tsconfig paths), unimportable for every real consumer.
 *
 *   pnpm test:pack                 # build + pack + install + import + tsc
 *   PACK_SMOKE_KEEP=1 pnpm test:pack   # keep the temp project around for debugging
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const workDir = fs.mkdtempSync(path.join(process.env.PACK_SMOKE_DIR ?? os.tmpdir(), 'ai-conductor-pack-'))

const run = (cmd, args, cwd, { echo = true } = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}   (in ${cwd})`)
  const output = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (echo && output.trim()) {
    process.stdout.write(output)
  }
  return output
}

const fail = (message) => {
  console.error(`\n✗ ${message}`)
  console.error(`  (temp project left at ${workDir})`)
  process.exit(1)
}

// 1. Pack. `npm pack` runs the `prepack` script (clean + build), same as `npm publish`.
const packOutput = run('npm', ['pack', '--json', '--pack-destination', workDir], repoRoot, { echo: false })
const [packInfo] = JSON.parse(packOutput.slice(packOutput.indexOf('[')))
const tarball = path.join(workDir, packInfo.filename)
const packedFiles = new Set(packInfo.files.map((f) => f.path))

// 2. Every path package.json points a consumer at must be inside the tarball.
const entryTargets = [pkg.main, pkg.types]
for (const conditions of Object.values(pkg.exports)) {
  entryTargets.push(...Object.values(conditions))
}
for (const target of entryTargets) {
  const normalized = target.replace(/^\.\//, '')
  if (!packedFiles.has(normalized)) {
    fail(`package.json points at "${target}", but it is not in the packed tarball`)
  }
}
if ([...packedFiles].some((file) => file.startsWith('src/'))) {
  fail('tarball unexpectedly contains src/ — `files` should ship dist only')
}
if (![...packedFiles].some((file) => file.endsWith('.module.css'))) {
  fail('tarball is missing the chat view CSS module (copyfiles step)')
}
console.log(`✓ tarball has all ${entryTargets.length} entry-point targets (${packedFiles.size} files)`)

// 3. A clean consumer project. npm (not pnpm) on purpose: it's the stricter of the two about
// `exports`, and it's what the broken 1.0.0 release was published with.
const consumerDir = path.join(workDir, 'consumer')
fs.mkdirSync(consumerDir)
fs.writeFileSync(
  path.join(consumerDir, 'package.json'),
  JSON.stringify({ name: 'consumer', type: 'module', private: true, version: '0.0.0' }, null, 2),
)
const peerVersions = Object.keys(pkg.peerDependencies).map((name) => `${name}@${pkg.peerDependencies[name]}`)
run(
  'npm',
  [
    'install',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    tarball,
    ...peerVersions,
    `typescript@${pkg.devDependencies.typescript}`,
    `@types/react@${pkg.devDependencies['@types/react']}`,
    `@types/node@${pkg.devDependencies['@types/node']}`,
  ],
  consumerDir,
)

// 4. Runtime: the server entry must load in plain Node and actually build a config.
fs.writeFileSync(
  path.join(consumerDir, 'server-entry.mjs'),
  `
import { payloadAiConductor, CHAT_ENDPOINT_PATH } from 'payload-ai-conductor'
if (typeof payloadAiConductor !== 'function') throw new Error('payloadAiConductor is not a function')
const config = payloadAiConductor({ collections: ['pages'] })({
  collections: [{ slug: 'pages', fields: [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'hero', fields: [] }] }] }],
})
if (!config.endpoints.some((e) => e.path === CHAT_ENDPOINT_PATH)) throw new Error('chat endpoint not registered')
console.log('server entry OK')
`,
)
run('node', ['server-entry.mjs'], consumerDir)

// The admin entry points are bundled by Next in a real app (they import CSS modules and
// Payload's admin UI), so plain Node only needs to resolve them and load the module graph with
// stylesheets stubbed out — the same graph Next would bundle.
fs.writeFileSync(
  path.join(consumerDir, 'css-stub-hooks.mjs'),
  `
export async function load(url, context, nextLoad) {
  if (/\\.(css|scss|sass)$/.test(url)) {
    return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, k) => String(k) })' }
  }
  return nextLoad(url, context)
}
`,
)
fs.writeFileSync(
  path.join(consumerDir, 'register-css-stub.mjs'),
  `import { register } from 'node:module'\nregister('./css-stub-hooks.mjs', import.meta.url)\n`,
)
fs.writeFileSync(
  path.join(consumerDir, 'admin-entries.mjs'),
  `
const client = await import('payload-ai-conductor/client')
if (typeof client.ConductorChatView !== 'function') throw new Error('client: ConductorChatView missing')
const rsc = await import('payload-ai-conductor/rsc')
for (const name of ['AskConductorButton', 'ConductorChatPage', 'ConductorNavLink']) {
  if (typeof rsc[name] !== 'function') throw new Error('rsc: ' + name + ' missing')
}
console.log('client + rsc entries OK')
`,
)
run('node', ['--import', './register-css-stub.mjs', 'admin-entries.mjs'], consumerDir)

// 5. Types: all three entry points resolve with both of the module resolutions consumers use.
fs.writeFileSync(
  path.join(consumerDir, 'check.ts'),
  `
import { payloadAiConductor, type PayloadAiConductorConfig } from 'payload-ai-conductor'
import { ConductorChatView } from 'payload-ai-conductor/client'
import { AskConductorButton, ConductorChatPage, ConductorNavLink } from 'payload-ai-conductor/rsc'

const options: PayloadAiConductorConfig = { collections: [], maxSteps: 10 }
export const plugin = payloadAiConductor(options)
export const components = [ConductorChatView, AskConductorButton, ConductorChatPage, ConductorNavLink]
`,
)
for (const moduleResolution of ['nodenext', 'bundler']) {
  const tsconfig = {
    compilerOptions: {
      jsx: 'react-jsx',
      lib: ['DOM', 'DOM.Iterable', 'ES2022'],
      module: moduleResolution === 'bundler' ? 'esnext' : 'nodenext',
      moduleResolution,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: 'ES2022',
    },
    files: ['check.ts'],
  }
  fs.writeFileSync(path.join(consumerDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
  run(path.join(consumerDir, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], consumerDir)
  console.log(`✓ types resolve (moduleResolution: ${moduleResolution})`)
}

if (!process.env.PACK_SMOKE_KEEP) {
  fs.rmSync(workDir, { force: true, recursive: true })
}
console.log('\n✓ pack smoke test passed')

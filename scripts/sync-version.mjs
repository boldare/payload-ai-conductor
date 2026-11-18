#!/usr/bin/env node
/**
 * Writes package.json's version into src/version.ts, so runtime code (the MCP server's
 * `serverInfo`) reports the real version without importing package.json — which would sit
 * outside tsc's rootDir and isn't reliably bundleable by every consumer's Next setup.
 *
 * Runs automatically as the `version` lifecycle script: `pnpm version minor` bumps package.json,
 * runs this, and the regenerated file lands in the same version commit.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

fs.writeFileSync(
  path.join(repoRoot, 'src/version.ts'),
  `// Generated from package.json by scripts/sync-version.mjs (runs on \`pnpm version\`). Do not edit.\nexport const PLUGIN_VERSION = '${version}'\n`,
)
console.log(`src/version.ts → ${version}`)

#!/usr/bin/env node
/**
 * Zero-dependency modular client assembler for `@lmtagent/redteam-ui` (`packages/redteam-ui`).
 *
 * Concatenates `packages/redteam-ui/src/client/00-header.js` .. `07-cluster-shell.js`
 * in deterministic lexicographic order into `packages/redteam-ui/lib/client.js`,
 * validating JavaScript syntax via `node:vm` before writing.
 *
 * Usage:
 *   node packages/redteam-ui/tools/assemble-client.mjs           # build lib/client.js
 *   node packages/redteam-ui/tools/assemble-client.mjs --check   # verify lib/client.js is up to date
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(__dirname, '..')
const srcDir = path.join(pkgRoot, 'src', 'client')
const outFile = path.join(pkgRoot, 'lib', 'client.js')

const EXPECTED_SHARDS = [
  '00-header.js',
  '01-core-rpc.js',
  '02-telemetry-probe.js',
  '03-wish-wizard.js',
  '04-workflow-deck.js',
  '05-overview-tab.js',
  '06-engineering-tabs.js',
  '07-cluster-shell.js',
]

const checkOnly = process.argv.includes('--check')

if (!fs.existsSync(srcDir)) {
  console.error(`[assemble-client] Missing source directory: ${srcDir}`)
  process.exit(1)
}

const files = fs.readdirSync(srcDir)
  .filter((f) => f.endsWith('.js'))
  .sort((a, b) => a.localeCompare(b))

for (const expected of EXPECTED_SHARDS) {
  if (!files.includes(expected)) {
    console.error(`[assemble-client] Missing required client module: ${expected}`)
    process.exit(1)
  }
}

const chunks = files.map((file) => {
  const fullPath = path.join(srcDir, file)
  const raw = fs.readFileSync(fullPath, 'utf8').replace(/\r\n/g, '\n').trimEnd()
  if (!raw.trim()) {
    console.error(`[assemble-client] Empty source module: ${file}`)
    process.exit(1)
  }
  return raw
})

const assembled = chunks.join('\n\n') + '\n'

/* Syntax gate: ensure assembled IIFE/UMD client parses cleanly before touching lib/client.js */
try {
  new vm.Script(assembled, { filename: outFile })
} catch (err) {
  console.error('[assemble-client] Syntax error in assembled client.js:')
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
}

if (checkOnly) {
  if (!fs.existsSync(outFile)) {
    console.error(`[assemble-client] --check failed: ${outFile} does not exist`)
    process.exit(1)
  }
  const current = fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n')
  if (current !== assembled) {
    console.error('[assemble-client] --check failed: lib/client.js is out of sync with src/client/*.js. Run `node packages/redteam-ui/tools/assemble-client.mjs`.')
    process.exit(1)
  }
  const lineCount = assembled.split('\n').length - 1
  console.log(`[assemble-client] OK (--check): ${files.length} modules verified in sync (${lineCount} lines, ${Buffer.byteLength(assembled, 'utf8')} bytes)`)
  process.exit(0)
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, assembled, 'utf8')
const lineCount = assembled.split('\n').length - 1
console.log(`[assemble-client] Assembled ${files.length} modules -> lib/client.js (${lineCount} lines, ${Buffer.byteLength(assembled, 'utf8')} bytes)`)

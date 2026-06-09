#!/usr/bin/env node
// Bridge: hdc fport (via ohos-playwright/setup) → chrome-devtools-mcp.
//
// Setup logic and the device CDP endpoint are owned by ohos-playwright. This
// wrapper spawns chrome-devtools-mcp as a child with --browserUrl pointing
// at the resulting endpoint and forwards stdio, so the MCP client talks to
// the upstream server directly. Nothing about the upstream protocol surface
// is rewritten — this wrapper exists only to do the OHOS-specific hdc dance.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve as resolvePath, dirname } from 'node:path'

// MCP JSON-RPC lives on stdout. Everything we say — and anything our
// dependencies say via console.log — must go to stderr until the upstream
// child takes over. We re-route process.stdout.write to stderr, then
// restore it right before spawning the child (which uses stdio:'inherit',
// inheriting the original OS fd, unaffected by the JS-level patch).
const origStdoutWrite = process.stdout.write.bind(process.stdout)
const stderrWrite = process.stderr.write.bind(process.stderr)
process.stdout.write = stderrWrite

const log = (...a) => console.error('[ohos-chrome-devtools-mcp]', ...a)

const require = createRequire(import.meta.url)

function resolveOrThrow(spec, envHint) {
  try { return require.resolve(spec) }
  catch (e) {
    const installHint = spec.split('/')[0]
    throw new Error(
      `Cannot resolve "${spec}". Install with: npm i -g ${installHint}` +
      (envHint ? ` (or set ${envHint} to its absolute path)` : '') +
      `\n  Original: ${e.message}`,
    )
  }
}

function resolveBin(pkgName, binName) {
  const pkgPath = require.resolve(`${pkgName}/package.json`)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  let bin
  if (typeof pkg.bin === 'string') bin = pkg.bin
  else if (pkg.bin && typeof pkg.bin === 'object') bin = pkg.bin[binName ?? pkgName]
  if (!bin) throw new Error(`${pkgName} has no "${binName ?? pkgName}" bin entry in package.json`)
  return resolvePath(dirname(pkgPath), bin)
}

const SETUP_PATH    = process.env.OHOS_CDT_SETUP    ?? resolveOrThrow('ohos-playwright/setup',    'OHOS_CDT_SETUP')
const TEARDOWN_PATH = process.env.OHOS_CDT_TEARDOWN ?? resolveOrThrow('ohos-playwright/teardown', 'OHOS_CDT_TEARDOWN')
const CDT_BIN       = process.env.OHOS_CDT_BIN      ?? resolveBin('chrome-devtools-mcp', 'chrome-devtools-mcp')

// Mirror ohos-playwright's info-path module so we don't need to depend on
// an internal export. Kept in sync with ohos-playwright/src/info-path.mts.
const INFO_PATH = process.env.OHOS_PW_INFO_PATH ?? resolvePath(tmpdir(), 'ohos-playwright-cdp.json')

// chrome-devtools-mcp args that conflict with the connect-only flow. We
// always inject --browserUrl ourselves; anything that would tell the child
// to launch its own Chromium or connect somewhere else must be dropped.
const STRIP = ['--browserUrl', '--wsEndpoint', '--channel', '--userDataDir', '--executablePath', '--isolated']

function sanitizeArgs(argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const match = STRIP.find(f => a === f || a.startsWith(f + '='))
    if (match) {
      log(`stripping conflicting arg: ${a}`)
      // If the flag has a separate value (e.g. "--channel stable"), skip it too.
      if (a === match && i + 1 < argv.length && !argv[i + 1].startsWith('--')) i++
      continue
    }
    out.push(a)
  }
  return out
}

async function bootstrap() {
  log('running ohos-playwright setup (hdc connect → locate ArkWeb → fport)...')
  const setupMod = await import(SETUP_PATH)
  await setupMod.default()
  if (!existsSync(INFO_PATH)) {
    throw new Error(`ohos-playwright setup finished but ${INFO_PATH} was not written`)
  }
  const info = JSON.parse(readFileSync(INFO_PATH, 'utf8'))
  log(`ArkWeb CDP ready: ${info.endpoint} (pid=${info.pid})`)
  return info
}

let teardownStarted = false
async function teardown() {
  if (teardownStarted) return
  teardownStarted = true
  // Make sure teardown's own console.log goes to stderr.
  process.stdout.write = stderrWrite
  try {
    const t = await import(TEARDOWN_PATH)
    await t.default()
  } catch (e) {
    log(`teardown failed (non-fatal): ${e?.message ?? e}`)
  }
}

async function main() {
  const info = await bootstrap()
  const userArgs = sanitizeArgs(process.argv.slice(2))
  const args = [CDT_BIN, `--browserUrl=${info.endpoint}`, ...userArgs]
  log(`spawning chrome-devtools-mcp with --browserUrl=${info.endpoint}`)

  // Restore stdout so the upstream MCP server writes JSON-RPC cleanly.
  process.stdout.write = origStdoutWrite

  const child = spawn(process.execPath, args, { stdio: 'inherit' })

  const forwardSignal = (sig) => { try { child.kill(sig) } catch {} }
  process.on('SIGINT',  () => forwardSignal('SIGINT'))
  process.on('SIGTERM', () => forwardSignal('SIGTERM'))

  child.on('exit', async (code, sig) => {
    await teardown()
    if (sig) process.kill(process.pid, sig)
    else process.exit(code ?? 1)
  })
}

main().catch(async e => {
  log(`bootstrap failed: ${e?.message ?? e}`)
  await teardown()
  process.exit(1)
})

#!/usr/bin/env node
/**
 * Guards against lockfiles that install cleanly here but fail on EAS.
 *
 * EAS runs `npm ci` with an older npm than we do locally. npm does not record
 * the root `overrides` block in lockfileVersion 3, so every npm version
 * re-derives override application itself - and they can disagree. That is how
 * `"uuid@7": "11.1.1"` produced a lock npm 11 wrote happily and npm 10 rejected
 * with `Missing: uuid@7.0.3 from lock file`.
 *
 * Two passes:
 *   1. Walk the lock. Every dependency / required-peer edge must resolve, and
 *      the resolved version should satisfy the requested range. Edges that
 *      resolve but sit outside their range only hold while an override keeps
 *      rewriting them - those are the ones that break across npm versions, so
 *      they are reported but not failed (some are load-bearing and verified).
 *   2. Copy package.json + package-lock.json to a temp dir and run a real
 *      `npm ci` there under each pinned npm version. This is the pass that
 *      matters: `npm ci --dry-run` succeeds even against a broken lock, as does
 *      `--os=linux --cpu=x64`. Only a real clean install reproduces it.
 */
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

const root = path.join(__dirname, "..")
const semver = require(path.join(root, "node_modules", "semver"))
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"))
const pkgs = lock.packages

// npm versions to prove the lock against. EAS's image is the reason for the
// older ones; override with NPM_VERSIONS=10 to shorten the loop locally.
const NPM_VERSIONS = (process.env.NPM_VERSIONS || "9,10").split(",").filter(Boolean)

function resolveFrom(fromPath, name) {
  let base = fromPath
  for (;;) {
    const candidate = `${base ? `${base}/` : ""}node_modules/${name}`
    if (pkgs[candidate]) return candidate
    const i = base.lastIndexOf("/node_modules/")
    if (i === -1) {
      if (base === "") return null
      base = ""
      continue
    }
    base = base.slice(0, i)
  }
}

const unresolved = []
const outOfRange = []

for (const [entryPath, meta] of Object.entries(pkgs)) {
  if (meta.link) continue
  const optionalPeers = new Set(
    Object.entries(meta.peerDependenciesMeta || {})
      .filter(([, v]) => v && v.optional)
      .map(([k]) => k)
  )
  const optionalDeps = meta.optionalDependencies || {}
  const edges = [
    ...Object.entries(meta.dependencies || {}),
    ...Object.entries(optionalDeps),
    ...Object.entries(meta.peerDependencies || {}).filter(([n]) => !optionalPeers.has(n)),
  ]

  for (const [name, spec] of edges) {
    const target = resolveFrom(entryPath, name)
    if (!target) {
      // a missing optional dependency is normal (platform-specific binaries)
      if (!optionalDeps[name]) unresolved.push(`${entryPath || "<root>"} -> ${name}@${spec}`)
      continue
    }
    // only semver ranges are checkable; skip npm:/file:/git:/workspace: specs
    if (!semver.validRange(spec)) continue
    const got = pkgs[target].version
    if (got && !semver.satisfies(got, spec)) {
      outOfRange.push(`${entryPath || "<root>"} -> ${name}@"${spec}" but lock has ${got}`)
    }
  }
}

console.log(`[1/2] walked ${Object.keys(pkgs).length} lock entries`)

if (unresolved.length) {
  console.error(`\n  ${unresolved.length} UNRESOLVED edge(s) - npm ci will fail:`)
  for (const m of unresolved.slice(0, 40)) console.error(`    ${m}`)
  process.exit(1)
}
console.log("      all dependency and required-peer edges resolve")

if (outOfRange.length) {
  console.log(`\n      ${outOfRange.length} edge(s) held in range only by an override:`)
  for (const m of outOfRange) console.log(`        ${m}`)
  console.log("      these depend on npm agreeing about overrides - pass 2 is what proves them")
}

let failed = false
for (const v of NPM_VERSIONS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `verify-lock-npm${v}-`))
  try {
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"))
    fs.copyFileSync(path.join(root, "package-lock.json"), path.join(dir, "package-lock.json"))
    process.stdout.write(`[2/2] real \`npm ci\` under npm ${v} ... `)
    execFileSync(
      "npx",
      ["-y", `npm@${v}`, "ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"], shell: true }
    )
    console.log("ok")
  } catch (err) {
    console.log("FAILED")
    const out = `${err.stdout || ""}${err.stderr || ""}`
    for (const line of out.split("\n").filter((l) => /npm error|Missing:/.test(l)).slice(0, 12)) {
      console.error(`        ${line}`)
    }
    failed = true
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (failed) {
  console.error("\nThis lock would fail on EAS. Re-check the most recent `overrides` change.")
  process.exit(1)
}
console.log("\nLock verified.")

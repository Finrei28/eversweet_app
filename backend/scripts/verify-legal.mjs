#!/usr/bin/env node
/**
 * Checks that the shared legal documents in this repo still match the website's copy.
 *
 * `backend/src/legal/legalDocuments.ts` and the website's `src/lib/legalDocuments.ts` are
 * the same file. Nothing about that is enforceable from CI - two repositories, two runners,
 * no shared checkout - so this is the gate, and it has to be run.
 *
 * It is modelled on `frontend/`'s `verify:lock`: a real check that runs locally, rather
 * than a comment asking people to remember.
 *
 * Point it at the website checkout with EVERSWEET_WEB_REPO if it is not in the usual place.
 * With no sibling to compare against it skips rather than fails, so a machine that only has
 * one of the two repos can still run it.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const backendRoot = resolve(here, "..")

const MINE = join(backendRoot, "src", "legal", "legalDocuments.ts")

const CANDIDATES = [
  process.env.EVERSWEET_WEB_REPO,
  "C:/Personal Projects/eversweet",
  resolve(backendRoot, "..", "..", "eversweet"),
].filter(Boolean)

const read = (path) => {
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}

const digest = (buffer) =>
  createHash("sha256").update(buffer).digest("hex").slice(0, 12)

const mine = read(MINE)
if (!mine) {
  console.error(`verify:legal - cannot read ${MINE}`)
  process.exit(1)
}

let theirPath = null
let theirs = null
for (const candidate of CANDIDATES) {
  const path = join(candidate, "src", "lib", "legalDocuments.ts")
  const contents = read(path)
  if (contents) {
    theirPath = path
    theirs = contents
    break
  }
}

if (!theirs) {
  console.log(
    "verify:legal - the website's checkout is not on this machine, so there is nothing " +
      "to compare against. Set EVERSWEET_WEB_REPO to check.",
  )
  process.exit(0)
}

if (mine.equals(theirs)) {
  console.log(`verify:legal - both copies match (sha256 ${digest(mine)}).`)
  process.exit(0)
}

console.error(
  [
    "",
    "verify:legal - THE LEGAL DOCUMENTS HAVE DRIFTED.",
    "",
    `  this repo      ${MINE}`,
    `                 sha256 ${digest(mine)}`,
    `  website        ${theirPath}`,
    `                 sha256 ${digest(theirs)}`,
    "",
    "  These two files are meant to be identical - the app and the website serve the",
    "  same Terms and the same Privacy Policy from them. Copy whichever is correct",
    "  over the other, then run this again:",
    "",
    `    cp "${MINE}" "${theirPath}"`,
    "",
    "  If Prettier did this, check that src/lib/legalDocuments.ts is still listed in",
    "  the website's .prettierignore - that repo's Prettier adds semicolons and this",
    "  one's does not.",
    "",
  ].join("\n"),
)
process.exit(1)

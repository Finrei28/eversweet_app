import { describe, expect, it } from "vitest"

import {
  LEGAL_LAST_UPDATED,
  LEGAL_TOKENS,
  type LegalDocument,
  type LegalSection,
  platformLabel,
  privacyPolicy,
  resolveLegalDocument,
  termAndConditions,
} from "./legalDocuments"

/**
 * The documents are shared between the order server and the website by being copied
 * byte-for-byte, and no CI can prove the two copies match - separate repos, separate
 * runners, no shared checkout. What this suite does instead is hold the content to the
 * standard the old documents failed, so that a copy which *is* current is also correct.
 * Both repos run it.
 *
 * Every case here is a bug that actually shipped: a section whose entire body was
 * "We have put in place appropriate security measures...", three sections all numbered "8.",
 * a terms document describing a delivery service that does not exist, and contact details
 * written out by hand in one document while the other read them from the database.
 */

const documents: [string, LegalDocument][] = [
  ["terms and conditions", termAndConditions],
  ["privacy policy", privacyPolicy],
]

const bodies = (section: LegalSection): string[] => [
  ...(section.content === undefined ? [] : [section.content]),
  ...(section.list ?? []),
]

const contact = {
  name: "Eversweet",
  email: "eversweet@eversweet.co.nz",
  phone: "09 949 1050",
  address: "5D/119 Meadowland Drive, Somerville, Auckland 2014",
  website: "https://eversweet.co.nz",
}

describe.each(documents)("%s", (_name, document) => {
  it("carries the shared last-updated date", () => {
    expect(document.lastUpdated).toBe(LEGAL_LAST_UPDATED)
  })

  it("has a title and a type the app can read", () => {
    expect(document.title.length).toBeGreaterThan(0)
    expect(document.type).toMatch(/^[a-z_]+$/)
  })

  it("gives every section a heading and something under it", () => {
    for (const section of document.sections) {
      expect(section.heading.trim().length).toBeGreaterThan(0)
      expect(bodies(section).length).toBeGreaterThan(0)
    }
  })

  /**
   * The one that matters most. The app's privacy policy shipped with five sections whose
   * text trailed off - "We have put in place appropriate security measures..." was the whole
   * of its Data Security section - and nothing caught it because nothing was looking.
   */
  it("has no section that trails off in an ellipsis", () => {
    for (const section of document.sections) {
      for (const body of bodies(section)) {
        expect(
          body.trimEnd().endsWith("..."),
          `"${section.heading}" trails off: ${body.slice(-60)}`,
        ).toBe(false)
        expect(body.trimEnd().endsWith("…")).toBe(false)
      }
    }
  })

  /**
   * Prose only. A bullet is allowed to be short - "Points do not expire." says everything
   * it needs to, and the contact block is a list of one-line details. What this is looking
   * for is a `content` paragraph that was never finished, which is the shape the stub
   * sections took.
   */
  it("finishes every paragraph it starts", () => {
    for (const section of document.sections) {
      if (section.content === undefined) continue

      expect(
        section.content.trim().length,
        `"${section.heading}" has a ${section.content.trim().length}-character paragraph`,
      ).toBeGreaterThan(40)
      expect(
        section.content.trimEnd(),
        `"${section.heading}" does not end in a full stop`,
      ).toMatch(/[.:!?]$/)
    }
  })

  it("leaves no empty bullets", () => {
    for (const section of document.sections) {
      for (const item of section.list ?? []) {
        expect(item.trim().length, `"${section.heading}" has a blank bullet`)
          .toBeGreaterThan(3)
      }
    }
  })

  /** Three sections were numbered "8." and a customer saw all three. */
  it("numbers its headings once each, in order", () => {
    const numbers = document.sections.map((section) => {
      const match = /^(\d+)\./.exec(section.heading)
      expect(match, `"${section.heading}" is not numbered`).not.toBeNull()
      return Number(match![1])
    })

    expect(new Set(numbers).size).toBe(numbers.length)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(numbers[0]).toBe(1)
  })

  it("only labels sections with platforms that exist", () => {
    for (const section of document.sections) {
      if (section.appliesTo === undefined) continue

      expect(section.appliesTo.length).toBeGreaterThan(0)
      expect(new Set(section.appliesTo).size).toBe(section.appliesTo.length)
      for (const platform of section.appliesTo) {
        expect(["app", "web"]).toContain(platform)
      }
    }
  })

  /**
   * A label on a section that applies to both would read as a restriction that is not
   * there, which on a legal document is worse than no label at all.
   */
  it("does not label a section that applies to both", () => {
    for (const section of document.sections) {
      if (section.appliesTo?.length === 2) {
        throw new Error(
          `"${section.heading}" lists both platforms; leave appliesTo off instead`,
        )
      }
    }
  })

  it("explains the platform labels, since it uses them", () => {
    const labelled = document.sections.filter(
      (section) => platformLabel(section.appliesTo) !== null,
    )
    expect(labelled.length).toBeGreaterThan(0)

    const explains = document.sections.some((section) =>
      bodies(section).some((body) => body.includes("Mobile app only")),
    )
    expect(explains).toBe(true)
  })

  it("uses only tokens that resolve", () => {
    for (const section of document.sections) {
      for (const body of bodies(section)) {
        for (const [, token] of body.matchAll(/\{\{(\w+)\}\}/g)) {
          expect(
            LEGAL_TOKENS as readonly string[],
            `"${section.heading}" uses {{${token}}}`,
          ).toContain(token)
        }
      }
    }
  })

  it("leaves no token behind once resolved", () => {
    const resolved = resolveLegalDocument(document, contact)

    for (const section of resolved.sections) {
      for (const body of bodies(section)) {
        expect(body, `"${section.heading}" still has a token`).not.toMatch(
          /\{\{|\}\}/,
        )
      }
    }
  })

  it("keeps the shop's details out of the text, so they cannot drift", () => {
    for (const section of document.sections) {
      for (const body of bodies(section)) {
        expect(body).not.toContain("Meadowland")
        expect(body).not.toContain("eversweet@eversweet.co.nz")
        expect(body).not.toContain("09 949")
      }
    }
  })

  it("resolves the shop's details in", () => {
    const resolved = resolveLegalDocument(document, contact)
    const text = resolved.sections.flatMap(bodies).join(" ")

    expect(text).toContain(contact.address)
    expect(text).toContain(contact.email)
  })

  it("names the legal entity", () => {
    const text = document.sections.flatMap(bodies).join(" ")
    expect(text).toContain("Eversweet Limited")
  })
})

describe("resolveLegalDocument", () => {
  it("leaves a document with no tokens alone", () => {
    const plain: LegalDocument = {
      type: "x",
      title: "X",
      lastUpdated: LEGAL_LAST_UPDATED,
      sections: [{ heading: "1. A", content: "No tokens here." }],
    }

    expect(resolveLegalDocument(plain, contact)).toEqual(plain)
  })

  it("leaves an unknown token in place rather than blanking it", () => {
    const odd: LegalDocument = {
      type: "x",
      title: "X",
      lastUpdated: LEGAL_LAST_UPDATED,
      sections: [{ heading: "1. A", content: "Ask {{nobody}} about it." }],
    }

    expect(resolveLegalDocument(odd, contact).sections[0]?.content).toBe(
      "Ask {{nobody}} about it.",
    )
  })

  it("keeps a section without a list from growing one", () => {
    const resolved = resolveLegalDocument(termAndConditions, contact)
    const intro = resolved.sections[0]

    expect(intro).toBeDefined()
    expect(intro).not.toHaveProperty("list")
  })

  it("carries appliesTo through untouched", () => {
    const resolved = resolveLegalDocument(privacyPolicy, contact)
    const leaderboard = resolved.sections.find((section) =>
      section.heading.includes("leaderboard"),
    )

    expect(leaderboard?.appliesTo).toEqual(["app"])
  })
})

describe("platformLabel", () => {
  it("labels a single platform", () => {
    expect(platformLabel(["app"])).toBe("Mobile app only")
    expect(platformLabel(["web"])).toBe("Website only")
  })

  it("says nothing when a section applies everywhere", () => {
    expect(platformLabel(undefined)).toBeNull()
    expect(platformLabel([])).toBeNull()
    expect(platformLabel(["app", "web"])).toBeNull()
  })
})

/**
 * The claims the old documents got wrong. Each of these was live: the terms described a
 * delivery service that does not exist, the website's policy named Google Analytics, and
 * both offered an erasure the code cannot perform.
 */
describe("the claims that were wrong before", () => {
  const termsText = termAndConditions.sections.flatMap(bodies).join(" ")
  const privacyText = privacyPolicy.sections.flatMap(bodies).join(" ")

  it("does not promise delivery", () => {
    expect(termsText).toContain("We do not deliver")
    expect(termsText).not.toMatch(/correct delivery details/i)
  })

  it("says money is held rather than taken at checkout", () => {
    expect(termsText).toMatch(/places a hold/i)
    expect(termsText).not.toMatch(/payment must be made in full at the time/i)
  })

  it("does not claim a membership refund the code never makes", () => {
    expect(termsText).toMatch(/do not refund membership payments/i)
  })

  /**
   * The streak belongs to the Stripe subscription, not to the calendar. It survives a
   * renewal that fails and is later paid, and it survives cancelling and resuming, because
   * both leave the same subscription in place - `countConsecutivePaidMonths` counts paid
   * invoices on one subscription id, and `createMembership` only zeroes `totalMonths` on a
   * membership that is already inactive, which needs the subscription to have ended.
   *
   * An earlier draft of these terms said a missed month and any re-join both reset it. That
   * was wrong in the way that costs a customer their discount for no reason.
   */
  it("ties the streak to the subscription, not to a missed month", () => {
    expect(termsText).toMatch(/It belongs to your subscription/i)
    expect(termsText).toMatch(/renewal that fails and is then paid keeps your discount/i)
    expect(termsText).toMatch(/resuming before it does changes nothing/i)
  })

  it("says the reset needs the subscription to have ended", () => {
    expect(termsText).toMatch(
      /starts again at the first step only once the subscription itself has ended/i,
    )
  })

  /** The shop does send these, so the policy must not claim otherwise. */
  it("discloses the new-offer notification", () => {
    expect(privacyText).toMatch(/when a new offer becomes available/i)
    expect(privacyText).not.toMatch(/do not send marketing notifications/i)
  })

  it("says points do not expire, because they do not", () => {
    expect(termsText).toContain("Points do not expire")
  })

  it("says website orders earn no points", () => {
    expect(termsText).toMatch(/website do not earn Sweet Points/i)
  })

  it("discloses the public leaderboard", () => {
    expect(privacyText).toMatch(/read by anyone on the internet/i)
  })

  it("discloses overseas storage", () => {
    expect(privacyText).toContain("Sydney")
    expect(privacyText).toContain("Singapore")
  })

  it("names the analytics actually used, and not the one that is not", () => {
    expect(privacyText).toContain("Vercel Web Analytics")
    expect(privacyText).not.toContain("Google Analytics")
  })

  it("does not promise an erasure button that does not exist", () => {
    expect(privacyText).toMatch(/no button in the app that deletes an account/i)
  })

  it("preserves Consumer Guarantees Act rights alongside the liability cap", () => {
    expect(termsText).toContain("Consumer Guarantees Act 1993")
  })
})

/**
 * Who may use the app and the website: 13 and over, with 13 to 17 year olds supervised by a
 * parent or guardian who pays. Both documents state the minimum and neither may name another.
 * They once both said 16, which was never the shop's actual limit - a figure written into the
 * text with nothing behind it, and a second number beside the real one would leave nobody
 * sure which applies.
 */
describe("age", () => {
  const termsText = termAndConditions.sections.flatMap(bodies).join(" ")
  const privacyText = privacyPolicy.sections.flatMap(bodies).join(" ")
  const ageSection = termAndConditions.sections.find((section) =>
    section.heading.endsWith(". Age"),
  )

  it("sets the minimum age at 13 in both documents", () => {
    expect(termsText).toMatch(/at least 13 years old/)
    expect(privacyText).toMatch(/children under 13/)
  })

  it("names no other minimum age", () => {
    for (const text of [termsText, privacyText]) {
      const ages = [...text.matchAll(/\b(?:at least|under|aged) (\d+)\b/gi)].map(
        (match) => match[1],
      )
      expect(ages.length).toBeGreaterThan(0)
      expect(new Set(ages)).toEqual(new Set(["13"]))
    }
  })

  it("puts 13 to 17 year olds under a parent or guardian's supervision", () => {
    expect(termsText).toMatch(
      /13 to 17[^.]*supervision of a parent or legal guardian/,
    )
    expect(privacyText).toMatch(
      /13 to 17[^.]*supervision of a parent or legal guardian/,
    )
  })

  it("makes that parent or guardian responsible for paying", () => {
    expect(termsText).toMatch(
      /parent or guardian accepts financial responsibility for every order/,
    )
  })

  /** A guest checkout on the website takes a card as readily as the app does. */
  it("applies on both platforms", () => {
    expect(ageSection).toBeDefined()
    expect(ageSection?.appliesTo).toBeUndefined()
  })

  it("admits that nobody's age is checked", () => {
    expect(ageSection && bodies(ageSection).join(" ")).toMatch(
      /We do not check anyone's age/,
    )
  })
})

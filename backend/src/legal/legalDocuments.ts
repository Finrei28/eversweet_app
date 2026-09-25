/**
 * The Eversweet Terms & Conditions and Privacy Policy, as data.
 *
 * ---------------------------------------------------------------------------------------
 * THIS FILE IS COPIED BYTE-FOR-BYTE INTO TWO REPOSITORIES. Change one and copy it, or the
 * app and the website go back to telling customers different things.
 *
 *   order server : backend/src/legal/legalDocuments.ts
 *   website      : src/lib/legalDocuments.ts   (C:\Personal Projects\eversweet)
 *
 * Check with `npm run verify:legal` in either repo, which is `cmp -s` with a friendlier
 * failure. It imports nothing on purpose, so that copying it is all there is to it.
 * ---------------------------------------------------------------------------------------
 *
 * There used to be two of each document and they had drifted badly. The app's privacy
 * policy was placeholder text - five of its sections ended in a literal "..." - while the
 * website had a fuller one written separately; both carried the same "last updated" date.
 * The website had no terms at all, yet its checkout told customers they agreed to a "Terms
 * of Service" it did not host. Between them they promised erasure that no endpoint
 * provides, named an analytics product the code does not use, collected a delivery address
 * that no column exists for, and described a delivery service that does not exist.
 *
 * So the rule here is narrow and worth keeping: **every sentence in these documents has to
 * be true of the code.** If a claim and the code disagree, one of them is a bug. Where the
 * two platforms genuinely differ, the section says which one it applies to rather than a
 * second document being written.
 *
 * `legalDocuments.test.ts` in both repos holds the shape to that standard: no section may
 * end in an ellipsis, headings must be numbered once and in order, and every {{token}} must
 * resolve.
 */

/** Which ordering channel a section applies to. Absent means both. */
export type LegalPlatform = "app" | "web"

/**
 * One section.
 *
 * `content` and `list` may both be present - an introductory sentence above its bullets is
 * the commonest shape - and at least one of them must be. The customer app's renderer has
 * always handled both; its *type* used to insist on exactly one, which is why the documents
 * were written without intros.
 *
 * `appliesTo` is deliberately per-section and never per list item: `list` is `string[]` on
 * the wire and app builds already installed would render an object in it as
 * "[object Object]". Where one bullet differs between platforms it says so in its own words.
 */
export type LegalSection = {
  heading: string
  content?: string
  list?: string[]
  /** Absent means the section applies everywhere. */
  appliesTo?: LegalPlatform[]
}

export type LegalDocument = {
  type: string
  title: string
  lastUpdated: string
  sections: LegalSection[]
}

/**
 * The shop's details, which both documents quote and neither hard-codes.
 *
 * These live in the `ShopProfile` table, which the order server and the website both read,
 * so the address in a privacy policy cannot fall out of step with the address on the store
 * screen. It had already drifted across five copies in two formats before that table
 * existed.
 */
export type LegalContact = {
  name: string
  email: string
  phone: string
  /** One line, as `oneLineAddress` builds it: street, suburb, city and postcode. */
  address: string
  website: string
}

/** The tokens `resolveLegalDocument` replaces. The test asserts nothing else is left. */
export const LEGAL_TOKENS = [
  "name",
  "email",
  "phone",
  "address",
  "website",
] as const

/**
 * When these documents last changed. Bump it whenever the text below does, and only then.
 *
 * Written the long way round because it is rendered raw by the app, and "12-06-2026" reads
 * as 12 June to a New Zealander and 6 December to an American with equal confidence.
 */
export const LEGAL_LAST_UPDATED = "25 September 2026"

const fill = (text: string, contact: LegalContact): string =>
  text.replace(/\{\{(\w+)\}\}/g, (whole, token: string) =>
    token in contact ? String(contact[token as keyof LegalContact]) : whole,
  )

/**
 * The document with the shop's details filled in.
 *
 * The order server calls this before serving, so the app receives finished text and needs
 * no templating of its own; the website calls it when it renders.
 */
export const resolveLegalDocument = (
  document: LegalDocument,
  contact: LegalContact,
): LegalDocument => ({
  ...document,
  sections: document.sections.map((section) => ({
    ...section,
    ...(section.content === undefined
      ? {}
      : { content: fill(section.content, contact) }),
    ...(section.list === undefined
      ? {}
      : { list: section.list.map((item) => fill(item, contact)) }),
  })),
})

/** The label a renderer puts on a section that applies to only one channel. */
export const platformLabel = (appliesTo?: LegalPlatform[]): string | null => {
  if (!appliesTo || appliesTo.length === 0 || appliesTo.length === 2) return null
  return appliesTo[0] === "app" ? "Mobile app only" : "Website only"
}

/** The paragraph that explains those labels, kept identical in both documents. */
const HOW_TO_READ: LegalSection = {
  heading: "2. How to read this document",
  content:
    "You can order from Eversweet in two ways: through our mobile app, or through our website. Most of what follows applies to both. Where something applies to only one of them, the section is labelled \"Mobile app only\" or \"Website only\". Anything without a label applies wherever you order.",
}

export const termAndConditions: LegalDocument = {
  type: "terms_and_conditions",
  title: "Terms & Conditions",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      heading: "1. About these terms",
      content:
        "These terms are an agreement between you and Eversweet Limited (\"Eversweet\", \"we\", \"us\"), which trades as {{name}} at {{address}}. They cover our mobile app and our website at {{website}}, and the orders you place through either. By placing an order you accept these terms. If you do not accept them, please do not order through the app or the website.",
    },
    HOW_TO_READ,
    {
      heading: "3. Age",
      content:
        "You must be at least 13 years old to use our app or to order from our website.",
      list: [
        "If you are 13 to 17 years old, you may use the app and place orders only under the supervision of a parent or legal guardian, who must agree to these terms on your behalf.",
        "That parent or guardian accepts financial responsibility for every order placed, and any membership bought, by someone aged 13 to 17 in their care, as if they had placed it themselves.",
        "We do not check anyone's age, and we cannot see whether a parent or guardian is supervising. By creating an account or placing an order you confirm that you meet these requirements - it is a promise you make to us rather than something we verify.",
        "If we learn that an account belongs to someone under 13, we will close it and remove what we can, as our Privacy Policy describes.",
      ],
    },
    {
      heading: "4. Your account",
      appliesTo: ["app"],
      content:
        "Ordering in the app needs an account. One account belongs to one person and one email address.",
      list: [
        "You need to confirm your email address before you can sign in. We send a six-digit code that is valid for 15 minutes.",
        "You must meet the age requirements in the section above to hold an account, including the supervision of a parent or legal guardian if you are 13 to 17.",
        "Creating an account means accepting these terms and our Privacy Policy. We do not create an account without that, and we keep a record of which version you accepted and when.",
        "Keep your password to yourself. You are responsible for what happens under your account.",
        "The name on your account is printed on the kitchen receipt and may be shown on the public leaderboard, so please use your real name and nothing offensive.",
        "You can change your first name, last name and phone number yourself in the app. Changing the email address on an account needs us to do it, so that nobody can move an account to an inbox they do not own.",
        "There is no button that deletes an account. Ask us and we will do it by hand - what we can and cannot remove is set out in our Privacy Policy.",
        "We may suspend or close an account that is being misused.",
      ],
    },
    {
      heading: "5. Ordering without an account",
      appliesTo: ["web"],
      content:
        "The website does not have customer accounts and you do not need to sign in to order. You give us your name, email address and phone number at the checkout so that we can prepare your order and contact you about it. Because there is no account, the website cannot show you your past orders, and Sweet Points, membership and offers are not available there.",
    },
    {
      heading: "6. Orders",
      list: [
        "An order is an offer to buy. It is accepted when we take payment and send it to the kitchen.",
        "Everything is subject to availability. We may refuse or cancel an order, and if we do and we have taken payment, we refund it.",
        "Once an order is placed there is no way to change or cancel it yourself, on either the app or the website. If something is wrong, contact us straight away.",
        "In the app, if you place an order identical to one you placed in the last 10 minutes, we stop and ask you to confirm before charging you twice.",
        "Photographs are a guide. What you receive may differ a little in appearance depending on how it was made on the day.",
      ],
    },
    {
      heading: "7. Prices",
      list: [
        "All prices are in New Zealand dollars and include GST.",
        "Every total is worked out on our own servers from the prices held there. Nothing your phone or browser calculates decides what you pay.",
        "Prices can change. If the price of something in your cart changes while you are paying, we stop and show you the new total rather than charging a different amount to the one you agreed to.",
        "There is no minimum order, and we add no service fee, booking fee or card surcharge.",
      ],
    },
    {
      heading: "8. Paying",
      content:
        "Confirming your card does not take any money. It places a hold - an authorisation - for the total of your order. We take the money only once your order has been written down and sent to the kitchen. That is the last thing that happens, so if anything stops the order, nothing has been taken.",
      list: [
        "A hold usually appears on your statement as a pending transaction for the order amount. It is not money taken.",
        "If your cart or its prices changed while you were paying, or the shop can no longer make your pick-up time, we let the hold go and place no order. You are not charged.",
        "If an order is never completed, any hold left behind is released automatically within about half an hour. How quickly the pending line then disappears is up to your bank rather than us - it is usually a few working days.",
        "If money has been taken and no order exists, we refund it in full automatically. We look back over the previous 48 hours for these.",
        "We never take an amount other than the total of the order we place. In the rare case that we have taken the wrong amount, we refund all of it rather than keeping the difference.",
        "Your card details are handled by Stripe, our payment provider. We never see or store your full card number. If you choose to save a card, it is saved with Stripe and we keep only a reference to it.",
        "We charge in New Zealand dollars only.",
      ],
    },
    {
      heading: "9. Collecting your order",
      content:
        "Every order placed through the Eversweet app or website is for collection from the shop or to eat in. We do not deliver.",
      list: [
        "Delivery is available only through Uber Eats. That is a separate service, ordered in the Uber Eats app and carried out under Uber Eats' own terms, and these terms do not apply to it.",
        "The last pick-up time on any day is 10 minutes before we close. The last eat-in order is 30 minutes before we close.",
        "You can choose a pick-up time up to 40 days ahead.",
        "The preparation time we quote is an estimate based on how many items you ordered. It is a guide, not a guarantee, and busy periods can run longer.",
        "Our opening hours and any one-off closures are shown in the app and on the website, and can change.",
        "Please collect your order at the time you chose. We make food fresh for that time, and we cannot promise it will be at its best if it is left waiting.",
      ],
    },
    {
      heading: "10. Changes, cancellations and refunds",
      content:
        "Neither the app nor the website has a way to change, cancel or refund an order once it has been placed. If something is wrong with your order, contact us at {{email}} or {{phone}} as soon as you can and we will put it right where we can.",
      list: [
        "Our food is made fresh and is perishable, so we do not generally refund an order once it has been prepared.",
        "If an order is wrong, missing something, or not of acceptable quality, we will replace or refund it.",
        "Please tell us within 24 hours of collecting, while we can still look into what happened.",
        "Nothing in these terms takes away your rights under the Consumer Guarantees Act 1993 or the Fair Trading Act 1986. Where you are buying as a consumer, those rights apply on top of anything written here, and where these terms and that Act disagree, the Act wins.",
      ],
    },
    {
      heading: "11. Allergies and dietary requirements",
      list: [
        "Our food is made in one kitchen where dairy, gluten, eggs, nuts, soy and sesame are all handled.",
        "We cannot guarantee that anything is free of a given allergen, and we cannot offer an allergen-free environment.",
        "Ingredient and customisation lists in the app and on the website are a guide to what is in a dessert, not a full allergen declaration.",
        "If you have an allergy, please talk to us before you order rather than relying on the app.",
      ],
    },
    {
      heading: "12. Sweet Points",
      appliesTo: ["app"],
      content:
        "Sweet Points are our loyalty points. You earn them on orders placed in the Eversweet app, and you can spend them on selected desserts.",
      list: [
        "Orders placed on the website do not earn Sweet Points. Points are an app feature, and the website has no accounts to hold them.",
        "Points are earned on what you actually pay for an item, after any discount, and are rounded down for each line. A small enough line can earn none.",
        "Members earn at a higher rate. The rates in force are shown in the app.",
        "Points expire if a month passes without an order from you in the app. The month runs from your most recent app order, and when it runs out your whole balance expires at once, at the end of that day, New Zealand time. Orders placed on the website do not count, because they are not linked to your account.",
        "While your membership is active and paid up, your points do not expire. If your membership ends, your month runs from the day it ended. While it is on hold, your month runs from the day the unpaid renewal was due.",
        "The app shows the date your points will expire. If you allow notifications, we also send one a week before.",
        "Points in your cart when your balance expires expire with it: if the item comes out of your cart, or the cart expires, after that date, those points do not come back.",
        "We may pause expiry, for example while the shop is closed for a holiday. No points expire while it is paused, and when it resumes, everyone's month starts again from that day.",
        "Points are taken from your balance when you add a reward item to your cart, not when you place the order. Remove the item, or leave the cart until it expires after 12 hours, and the points come back.",
        "An item bought with points is not discounted again by a membership or a promotion, and earns no points of its own.",
        "Points have no cash value, cannot be exchanged for cash, and cannot be moved between accounts.",
        "We can change the earn rate, and what a reward item costs in points, at any time.",
        "We can withhold or reverse points where we think an account is being misused.",
      ],
    },
    {
      heading: "13. The monthly leaderboard and prizes",
      appliesTo: ["app"],
      content:
        "Each calendar month we rank customers by the Sweet Points they earned that month, on New Zealand time, and the top three win a prize. Your name is shown publicly on the leaderboard unless you turn that off - our Privacy Policy explains how.",
      list: [
        "The top three are recorded at midnight on the first of the following month, New Zealand time. That record is final: a later refund or adjustment does not reopen a month that has closed.",
        "Only points earned on orders count towards the ranking. Points returned to you - when you remove a reward item, for example - do not.",
        "Prizes are chosen by us and can differ between winners. There is no cash alternative.",
        "A prize is collected in the shop by showing the code in your app. Each code can be used once.",
        "A prize code lasts until the end of the month after the one you won in. A prize won in September can be collected through October and expires at the start of November.",
        "If the winning account is closed before the prize is collected, the prize cannot be claimed.",
        "We can withhold a prize where we think the ranking was reached by misusing an account.",
      ],
    },
    {
      heading: "14. Membership",
      appliesTo: ["app"],
      content:
        "Membership is a monthly subscription bought in the app. It renews automatically on the card you chose until you cancel it. The price is shown in the app before you join and on every renewal receipt from our payment provider.",
      list: [
        "Your member discount grows with each consecutive month you pay for, up to the maximum shown in the app. It belongs to your subscription, so as long as that subscription is running the run keeps building.",
        "A renewal that fails and is then paid keeps your discount, whether your bank was retried automatically or you retried it yourself in the app. The month still ends up paid for.",
        "Member benefits - member prices, member-only offers, the higher points rate and protection from points expiry - apply only while a membership is active and paid up.",
        "Cancelling stops the next renewal. You keep your membership and its benefits until the end of the period you have already paid for.",
        "We do not refund membership payments, including the month you are in when you cancel.",
        "If a renewal payment fails, your membership is put on hold while your bank is retried, and you can also retry it yourself in the app. If every retry fails, your subscription is cancelled.",
        "While your membership is on hold, its benefits are paused. Member prices come off the items in your cart, and member-only items are taken out of it. Once the payment goes through, member prices return and member-only offers can be added again.",
        "Cancelling does not take effect straight away, and resuming before it does changes nothing: you keep the membership you had, and the discount you had built up with it.",
        "Your discount starts again at the first step only once the subscription itself has ended - either you let a cancellation run its course, or a renewal went unpaid until it was cancelled. Joining after that is a new subscription, and it begins again at the first step however long you were a member before.",
        "You cannot remove the card your membership renews on until you have chosen another one for it.",
        "A membership belongs to one account and cannot be shared or transferred.",
        "We can change the price or the benefits. A price change takes effect from your next renewal, never the one you have already paid.",
      ],
    },
    {
      heading: "15. Offers and discounts",
      list: [
        "Offers in the app may be open to everyone, limited to members, or limited to customers who have not ordered before.",
        "Some offers have to be unlocked by placing a qualifying order first.",
        "An offer can have a limit on how many times you can use it. Some reset each week.",
        "Offers run for a set period and can be paused, changed or withdrawn at any time.",
        "If an offer in your cart stops running before you pay, the item is taken out of your cart and we tell you why.",
        "Only one percentage discount applies to an item: whichever is better of your member discount and any promotion. They do not add together.",
        "Offers and discounts in the app or on the website apply to orders placed there, and may not be available over the counter.",
        "Offers are tied to the account they were given to, have no cash value, and cannot be transferred.",
        "We can cancel an offer, or an order that used one, where we think it is being misused.",
      ],
    },
    {
      heading: "16. Our content",
      list: [
        "The Eversweet name, logo, photographs, menu descriptions and recipes belong to us.",
        "You may not copy, republish or use them commercially without our written permission.",
      ],
    },
    {
      heading: "17. Our responsibility to you",
      content:
        "Nothing in this section takes away rights you have under the Consumer Guarantees Act 1993 or the Fair Trading Act 1986. Where you are buying as a consumer, those rights come first and the limits below apply only so far as that Act allows.",
      list: [
        "Where the law does allow us to limit what we owe you, our total liability for anything connected with an order is limited to what you paid for that order.",
        "We are not liable for indirect or consequential loss.",
        "We are not liable for delays or failures caused by something outside our reasonable control.",
        "We are not responsible for orders placed through Uber Eats, which are between you and Uber Eats.",
      ],
    },
    {
      heading: "18. Changes to these terms",
      content:
        "We can update these terms. The date at the top of this document shows when they last changed. If you keep ordering after a change, you accept the updated terms. We suggest reading them again if the date has moved since you last looked.",
    },
    {
      heading: "19. Which law applies",
      content:
        "These terms are governed by New Zealand law, and the New Zealand courts deal with any dispute about them.",
    },
    {
      heading: "20. Contact us",
      list: [
        "Eversweet Limited, trading as {{name}}",
        "{{address}}",
        "Email: {{email}}",
        "Phone: {{phone}}",
      ],
    },
  ],
}

export const privacyPolicy: LegalDocument = {
  type: "privacy_policy",
  title: "Privacy Policy",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      heading: "1. About this policy",
      content:
        "Eversweet Limited (\"Eversweet\", \"we\", \"us\"), trading as {{name}} at {{address}}, collects some personal information in order to sell you dessert. This policy explains what we collect, why, who else sees it, where it is kept and what you can do about it. We handle personal information in line with the Privacy Act 2020.",
    },
    HOW_TO_READ,
    {
      heading: "3. What we collect when you have an account",
      appliesTo: ["app"],
      content:
        "Ordering in the app needs an account, and the account holds:",
      list: [
        "Your first name, last name, email address and phone number.",
        "Your password, which is stored only as a scrambled form that cannot be turned back into your password.",
        "A reference to your customer record with Stripe, our payment provider, if you have paid by card.",
        "Your Sweet Points balance and the record of points earned and spent that produces it.",
        "Your membership, if you have one: whether it is active, what its payment status is, and a reference to the subscription held by Stripe.",
        "Which offers you have unlocked or used.",
        "Whether you have chosen to be anonymous on the leaderboard.",
        "Which version of our Terms and Conditions and Privacy Policy you accepted when you created your account, and when you accepted it.",
        "A notification token for your device, if you allowed notifications. It identifies the app on your phone, not you.",
        "Short-lived codes when you verify your email address or reset your password. These are deleted once used and expire after 15 minutes either way.",
      ],
    },
    {
      heading: "4. What we collect when you order on the website",
      appliesTo: ["web"],
      content:
        "The website has no customer accounts and no sign-in. You give us your name, email address and phone number at the checkout, and we keep them with that order so we can prepare it and contact you about it. Nothing carries over between website orders, and the website cannot show you your order history.",
    },
    {
      heading: "5. What we collect about your orders",
      content:
        "Wherever you order, we keep a record of the order itself:",
      list: [
        "What you bought, any customisations, the quantities and what it cost, including GST.",
        "Whether it was to collect or to eat in, and the pick-up time you chose.",
        "The name, email address and phone number given for that order. These are stored with the order, so correcting your details later changes future orders rather than past ones.",
        "A reference to the payment, so that we can match it to your order and refund it if we need to.",
        "Any feedback you send us, which asks for your email address and optionally your name. Feedback is stored on its own and is not linked to an account.",
      ],
    },
    {
      heading: "6. What we do not collect",
      content:
        "It is worth being specific about this, because policies of this kind often claim more than the business does:",
      list: [
        "We do not collect your home address. There is nowhere to put one, because we do not deliver.",
        "We do not collect your location. The app never asks for it.",
        "We do not use your camera, photos, contacts or microphone. The app asks for one permission, which is to send notifications.",
        "The app contains no advertising or analytics software of any kind, and we do not track you between apps or across the web.",
        "We never hold your full card number, expiry date or security code. Those go straight to Stripe.",
        "We do not buy personal information about you from anyone, and we do not sell yours.",
        "We do not send marketing emails, and we do not sell or share your details with anyone for their own marketing.",
      ],
    },
    {
      heading: "7. How we use it",
      list: [
        "To take, prepare and hand over your order, and to contact you about it.",
        "To take payment, and to release a hold or make a refund where one is due.",
        "To run your account, including signing you in and letting you reset your password.",
        "To run Sweet Points, the leaderboard, prizes, offers and membership, in the app.",
        "To answer your feedback or a question you have asked us.",
        "To keep accounting records and meet our tax obligations.",
        "To protect the shop and our customers from fraud and misuse, which includes limiting how often sign-in and code requests can be made from one address.",
      ],
    },
    {
      heading: "8. The public leaderboard, and how to stay off it",
      appliesTo: ["app"],
      content:
        "This is the one place where we show personal information publicly, so please read it. Each month we publish a leaderboard of customers by the Sweet Points they earned, and the previous month's top three appear in the app. That top-three list is served publicly: it can be read by anyone on the internet, not only by people signed in to the app.",
      list: [
        "By default your first and last name are shown. New accounts start this way.",
        "You can turn this off. Turn off \"Show my name\" on the leaderboard screen, or turn on \"Anonymous Status\" in your account details - they are the same setting - and your name is replaced with \"Anonymous\" everywhere customers can see it.",
        "The choice is applied on our servers, so once it is on, your name is not sent to anyone's device at all.",
        "Copies of the public list are held briefly to keep the app quick, so your name can linger in one for a few minutes after you switch anonymity on, and on the screen of someone who already has the app open until the app next refreshes it.",
        "Our own staff still see real names, because somebody has to hand the right prize to the right person.",
        "Turning anonymity on does not affect your points, your ranking or your prize.",
      ],
    },
    {
      heading: "9. Notifications",
      appliesTo: ["app"],
      content:
        "If you allow them, we send notifications about your own orders - when one is accepted, when the kitchen starts it, and when it is ready - when a prize has been assigned to you, and a week before your Sweet Points are due to expire. We also send one about the shop: a notification when a new offer becomes available, which for a members-only offer goes to members. That is the only message we send that is not about your own account or orders. You can turn notifications off in your phone's settings at any time, and the app keeps working without them. Signing out removes your device's notification token from our records.",
    },
    {
      heading: "10. Cookies and analytics",
      appliesTo: ["web"],
      content:
        "The website uses very little of this, and the detail matters more than the usual blanket wording:",
      list: [
        "We do not set any cookie of our own on customers. There is no customer sign-in on the website, so there is no session to keep. Your cart is held in your own browser's storage, not in a cookie, and never reaches us until you order.",
        "We use Vercel Web Analytics to count page views and see which pages are used. It does not use cookies and does not build a profile of you.",
        "Stripe sets its own cookies on the payment step, which it uses to detect fraud. Stripe's privacy policy covers those.",
        "Our staff sign-in area sets a session cookie, but only for staff.",
        "Because we set no tracking cookies, there is no consent banner to click through.",
      ],
    },
    {
      heading: "11. Who else handles your information",
      content:
        "We use other companies to run parts of the service. They are allowed to use your information only to do the job we have given them:",
      list: [
        "Stripe - payments, saved cards and memberships. Stripe receives your name, email address, phone number and the amount, and handles your card details directly.",
        "Resend - sends our emails: the code that confirms your email address, the code that resets your password, your order confirmation, and a welcome email when you join the membership.",
        "Expo - delivers notifications to your phone, receiving the notification text and your device's token.",
        "Supabase - hosts the database that everything is stored in.",
        "Render - runs the servers behind the app.",
        "Vercel - runs the website, and provides the page-view analytics described above.",
        "Cloudinary - hosts the images in our emails and on our menu. Opening one of our emails asks Cloudinary for those images, which tells Cloudinary your IP address, as opening any email with pictures in it would.",
        "We also share information where the law requires it, or to establish or defend a legal claim.",
      ],
    },
    {
      heading: "12. Where your information is stored",
      content:
        "Your information is stored and processed outside New Zealand, and you should know where. Our database is in Sydney, Australia. The servers behind the app run in Singapore. Our website, payments, email and notification providers are based in or operate from the United States and other countries. We choose established providers who are required to protect information to a standard comparable to New Zealand's, but once information is held overseas it is also subject to the laws of those countries.",
    },
    {
      heading: "13. How we protect it",
      list: [
        "Passwords are stored only as a bcrypt hash. Nobody at Eversweet can read your password, and we will never ask you for it.",
        "Password reset links are stored only as a hash, so a copy of our database could not be used to reset anyone's password.",
        "Verification and reset codes expire after 15 minutes and can be used once.",
        "Traffic between your phone or browser and us is encrypted.",
        "Sign-in, password reset and code requests are rate limited, by address and by account.",
        "Changing your password immediately invalidates sessions signed in with the old one.",
        "Names hidden from the leaderboard are removed on our servers, before they are sent anywhere.",
        "Our error messages and server logs deliberately leave out personal information.",
        "No system is perfectly secure, and we cannot guarantee that information sent over the internet is safe in transit.",
      ],
    },
    {
      heading: "14. How long we keep it",
      content:
        "We should be straightforward about this rather than say \"no longer than necessary\" and leave it there. We do not currently delete customer records on a schedule, and there is no automatic clear-out.",
      list: [
        "Order records, including the name, email address and phone number given for the order, are kept indefinitely. We are required to keep business records that support our tax returns for seven years.",
        "Account details, Sweet Points and their history, memberships, leaderboard placings and prize records are kept while the account exists.",
        "Feedback is kept indefinitely.",
        "A cart you abandon is deleted 12 hours after you last touched it, and any points spent in it are returned to you.",
        "Verification and reset codes are removed when used and in any case expire within 15 minutes.",
        "If that is longer than you would like, ask us and see the next section.",
      ],
    },
    {
      heading: "15. Seeing and correcting your information",
      content:
        "Under the Privacy Act 2020 you can ask to see the personal information we hold about you, and ask us to correct it if it is wrong.",
      list: [
        "In the app you can already see your account details, your order history, your Sweet Points balance, your membership and your saved cards.",
        "In the app you can change your first name, last name and phone number yourself.",
        "Changing the email address on an account has to be done by us, so that an account cannot be moved to an inbox its owner has never seen. Ask us and we will do it.",
        "Corrections apply from then on. The name and contact details recorded against orders you have already placed stay as they were, because they are part of the record of that sale.",
        "If you ordered on the website as a guest, there is no account to look in - contact us with the order details and we will tell you what we hold.",
        "To ask for anything above, email {{email}}. We will reply within 20 working days, as the Act requires.",
      ],
    },
    {
      heading: "16. Deleting your information",
      content:
        "There is no button in the app that deletes an account, and we would rather say so than imply otherwise. If you want your information removed, email {{email}} and we will do it by hand.",
      list: [
        "We can remove your account and its details, your Sweet Points and their history, your cart, your saved card references and your notification token.",
        "We cannot remove the record of orders you have placed. We are required to keep records of our sales for tax purposes. We can unlink them from your account so that they are no longer identifiable as yours, and we will.",
        "Where you have appeared in a past month's leaderboard results, the placing stays on record but is no longer linked to you. Any prize not yet collected can no longer be claimed.",
        "Ask Stripe about the customer record they hold for your payments; we will also ask them on your behalf if you prefer.",
        "New Zealand law gives you a right to ask for correction rather than a general right to erasure, but we will honour a deletion request as far as the records above allow.",
      ],
    },
    {
      heading: "17. Children",
      content:
        "Our app and website are not intended for children under 13, and we do not knowingly collect information from them. People aged 13 to 17 may use them only under the supervision of a parent or legal guardian, as our Terms and Conditions set out. We do not verify anyone's age. If you are a parent or guardian and believe a child under 13 has given us their information, contact us at {{email}} and we will remove what we can. A parent or guardian of someone aged 13 to 17 can also contact us to see or correct what we hold about them.",
    },
    {
      heading: "18. Changes to this policy",
      content:
        "We can update this policy. The date at the top shows when it last changed, and it changes only when the text does. If we make a change that materially affects how we use your information, we will say so in the app. We suggest reading it again if the date has moved since you last looked.",
    },
    {
      heading: "19. Contact us",
      content:
        "For anything in this policy, including a request to see, correct or delete your information, or a complaint about how we have handled it:",
      list: [
        "Eversweet Limited, trading as {{name}}",
        "{{address}}",
        "Email: {{email}}",
        "Phone: {{phone}}",
        "If you are not satisfied with our answer, you can complain to the Office of the Privacy Commissioner at privacy.org.nz.",
      ],
    },
  ],
}

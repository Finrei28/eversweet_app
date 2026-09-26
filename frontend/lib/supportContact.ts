/**
 * "contact us at <the shop's email>", or plain "contact us" when the email is not to hand.
 *
 * The address used to be typed into three error messages. It is the shop's `ShopProfile.email`,
 * edited from the website's admin and served by `/api/getStoreInfo`, so a change there never
 * reached them - the same reason the store screen stopped carrying its own copy. Without the
 * address the sentence still reads, rather than naming one that may be out of date.
 */
export const contactUs = (email: string | null | undefined): string => {
  const address = email?.trim()
  return address ? `contact us at ${address}` : "contact us"
}

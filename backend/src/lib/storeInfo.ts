/**
 * The shop's fixed details, as `/api/getStoreInfo` serves them.
 *
 * The weekly hours used to live here too, hard-coded, with `isOpen` worked out from them
 * once - when the module loaded - and then served unchanged until the server restarted,
 * whatever the time. Hours are now the `TradingHours` table (see `lib/tradingHours`), and
 * `getStoreInfo` works out `isOpen` on every request, days off included.
 */
export const storeInfo = {
  name: "Eversweet",
  address: "5D/119 Meadowland Drive, Somerville",
  city: "Auckland",
  state: "Auckland",
  postal: "2014",
  phone: "09 949 1050",
  email: "eversweet@eversweet.co.nz",
  website: "https://eversweet.co.nz",
}

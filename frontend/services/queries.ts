import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { OrderStatus } from "@/utils/types"
import { queryClient, SHARED_DATA_STALE_TIME } from "./queryClient"
import {
  fetchCategoriesWithDesserts,
  getAvailableCustomisations,
  getLeaderBoard,
  getMyPrizes,
  getPrivacyPolicy,
  getRestaurantStatus,
  getStoreInfo,
  getTermAndConditions,
  getLoyaltyRates,
  getUserOrders,
  getUserOrdersPage,
  showOfferForClient,
  showOffers,
} from "./api"
import { getMembershipDetails } from "./stripe-api"

/**
 * One place for every cache key, so screens that show the same data share it
 * rather than each fetching their own copy. The menu in particular is read by
 * the home, menu and rewards tabs.
 */
export const queryKeys = {
  menu: ["menu"] as const,
  clientOffers: ["offers", "client"] as const,
  viewerOffers: ["offers", "viewer"] as const,
  orders: (status: OrderStatus) => ["orders", status] as const,
  orderHistory: ["orders", "PICKED_UP", "paged"] as const,
  leaderboard: ["leaderboard"] as const,
  myPrizes: ["prizes", "mine"] as const,
  storeInfo: ["store-info"] as const,
  restaurantStatus: ["restaurant-status"] as const,
  privacyPolicy: ["privacy-policy"] as const,
  termsAndConditions: ["terms-and-conditions"] as const,
  loyaltyRates: ["loyalty-rates"] as const,
  membershipDetails: ["membership-details"] as const,
  customisations: (dessertId: string) =>
    ["customisations", dessertId] as const,
}

/** Options every authenticated query needs: don't run without a session. */
type AuthedOptions = { enabled?: boolean }

export const useMenuQuery = () =>
  useQuery({
    queryKey: queryKeys.menu,
    queryFn: fetchCategoriesWithDesserts,
    staleTime: SHARED_DATA_STALE_TIME,
  })

export const useClientOffersQuery = () =>
  useQuery({
    queryKey: queryKeys.clientOffers,
    queryFn: showOfferForClient,
    staleTime: SHARED_DATA_STALE_TIME,
  })

export const useOffersQuery = ({ enabled = true }: AuthedOptions = {}) =>
  useQuery({
    queryKey: queryKeys.viewerOffers,
    queryFn: showOffers,
    enabled,
  })

export const useOrdersQuery = (
  status: OrderStatus,
  { enabled = true }: AuthedOptions = {},
) =>
  useQuery({
    queryKey: queryKeys.orders(status),
    queryFn: () => getUserOrders(status),
    enabled,
  })

/** Page size for the history screen. */
const ORDER_HISTORY_PAGE_SIZE = 20

export const useOrderHistoryQuery = ({ enabled = true }: AuthedOptions = {}) =>
  useInfiniteQuery({
    queryKey: queryKeys.orderHistory,
    queryFn: ({ pageParam }) =>
      getUserOrdersPage("PICKED_UP", ORDER_HISTORY_PAGE_SIZE, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
  })

/**
 * The customer's own leaderboard prizes.
 *
 * No staleTime override, so it revalidates on focus: a prize can be collected
 * at the counter while this screen is open, and the card should stop offering
 * a code that has just been spent.
 */
export const useMyPrizesQuery = ({ enabled = true }: AuthedOptions = {}) =>
  useQuery({
    queryKey: queryKeys.myPrizes,
    queryFn: getMyPrizes,
    enabled,
  })

export const useLeaderboardQuery = ({ enabled = true }: AuthedOptions = {}) =>
  useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: getLeaderBoard,
    enabled,
  })

/**
 * The plan's price and benefit list, which the website's `/admin/settings` edits.
 *
 * AuthProvider used to load this once at sign-in and keep it for the session, so a benefit
 * reworded or dropped on the website stayed on the join screen, the popup, the cancel modal and
 * the warning banner until the app was restarted. Shop-wide, so it keeps the five-minute tier.
 * The endpoint takes a token, hence `enabled`.
 */
export const useMembershipDetailsQuery = ({ enabled = true }: AuthedOptions = {}) =>
  useQuery({
    queryKey: queryKeys.membershipDetails,
    queryFn: getMembershipDetails,
    enabled,
    staleTime: SHARED_DATA_STALE_TIME,
  })

export const useStoreInfoQuery = () =>
  useQuery({
    queryKey: queryKeys.storeInfo,
    queryFn: getStoreInfo,
    staleTime: SHARED_DATA_STALE_TIME,
  })

export const useRestaurantStatusQuery = () =>
  useQuery({
    queryKey: queryKeys.restaurantStatus,
    queryFn: getRestaurantStatus,
  })

export const usePrivacyPolicyQuery = () =>
  useQuery({
    queryKey: queryKeys.privacyPolicy,
    queryFn: getPrivacyPolicy,
    staleTime: SHARED_DATA_STALE_TIME,
  })

export const useTermsAndConditionsQuery = () =>
  useQuery({
    queryKey: queryKeys.termsAndConditions,
    queryFn: getTermAndConditions,
    staleTime: SHARED_DATA_STALE_TIME,
  })

/**
 * Keyed by dessert, so reopening one the customer already looked at is instant
 * instead of another round trip behind a spinner over the modal.
 */
export const useCustomisationsQuery = (dessertId: string | undefined) =>
  useQuery({
    queryKey: queryKeys.customisations(dessertId ?? ""),
    queryFn: () => getAvailableCustomisations(dessertId!),
    enabled: Boolean(dessertId),
    staleTime: SHARED_DATA_STALE_TIME,
  })

/**
 * The shop's email, for error messages that tell the customer who to contact. From the cache
 * when the store screen has already loaded it, otherwise fetched once and kept like any other
 * shop-wide data. Undefined when it cannot be had: the message is written to read without it
 * (`contactUs`), so a failure here never costs the customer the error itself.
 */
export const fetchSupportEmail = async (): Promise<string | undefined> => {
  try {
    const info = await queryClient.fetchQuery({
      queryKey: queryKeys.storeInfo,
      queryFn: getStoreInfo,
      staleTime: SHARED_DATA_STALE_TIME,
    })
    return info.email || undefined
  } catch (error) {
    console.error("Failed to load the shop's email", error)
    return undefined
  }
}

/**
 * For callers outside React — the cart store works out earnable points on every
 * quantity change, and these rates change about monthly. Served from the same
 * cache as everything else, so repeated taps cost nothing.
 */
export const fetchLoyaltyRates = () =>
  queryClient.fetchQuery({
    queryKey: queryKeys.loyaltyRates,
    queryFn: getLoyaltyRates,
    staleTime: SHARED_DATA_STALE_TIME,
  })

/**
 * The same rates, for screens that describe them rather than calculate with them.
 *
 * Worth having as a hook so copy like "members earn 1.5x points" is derived from what the
 * server actually applies. The membership offers screen claimed "double loyalty points"
 * against a 1.5x rate for months, because the sentence was typed rather than computed.
 */
export const useLoyaltyRatesQuery = () =>
  useQuery({
    queryKey: queryKeys.loyaltyRates,
    queryFn: getLoyaltyRates,
    staleTime: SHARED_DATA_STALE_TIME,
  })

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { OrderStatus } from "@/utils/types"
import { queryClient, SHARED_DATA_STALE_TIME } from "./queryClient"
import {
  fetchCategoriesWithDesserts,
  getAvailableCustomisations,
  getLeaderBoard,
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
  storeInfo: ["store-info"] as const,
  restaurantStatus: ["restaurant-status"] as const,
  privacyPolicy: ["privacy-policy"] as const,
  termsAndConditions: ["terms-and-conditions"] as const,
  loyaltyRates: ["loyalty-rates"] as const,
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

export const useLeaderboardQuery = ({ enabled = true }: AuthedOptions = {}) =>
  useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: getLeaderBoard,
    enabled,
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

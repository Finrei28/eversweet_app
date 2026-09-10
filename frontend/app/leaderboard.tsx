import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import { SweetPointIcon } from "@/_components/sweetPointIcon"
import { formatNumber } from "@/lib/formatters"
import { useLeaderboardQuery } from "@/services/queries"
import { useAuth } from "@/store/authProvider"
import { LeaderBoard, UserLeaderBoardRank } from "@/utils/types"
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons"
import { useFocusEffect, useRouter } from "expo-router"
import React, { useCallback, useMemo, useState } from "react"
import {
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

type LeaderBoardEntry = LeaderBoard[number]
type LeaderBoardUser = LeaderBoardEntry["user"]

type Place = 1 | 2 | 3
type PodiumSlot = { entry: LeaderBoardEntry; place: Place }

/** Spoken, not shown: "First place, Ana Ruiz, 610 points". */
const PLACE_WORDS: Record<Place, string> = {
  1: "First",
  2: "Second",
  3: "Third",
}

/**
 * Every field is a NativeWind class, never a colour value. The rank styles this
 * replaces returned `bg: ""` for the top three, which reached `backgroundColor`
 * as an empty string — not a colour React Native accepts.
 */
type PodiumStyle = {
  avatar: string
  ring: string
  initials: string
  plinth: string
  plinthText: string
}

/**
 * Only the winner is crowned. Second and third separate by plinth height,
 * avatar size and tint rather than by another badge, so the podium reads as one
 * shape instead of three competing ones — and nothing here is an emoji, which
 * is what the medals were.
 */
const PODIUM_STYLES: Record<Place, PodiumStyle> = {
  1: {
    avatar: "w-20 h-20 bg-primary/20",
    ring: "border-2 border-primary",
    initials: "text-xl text-gray-800",
    plinth: "h-20 bg-primary",
    plinthText: "text-white",
  },
  2: {
    avatar: "w-16 h-16 bg-secondary",
    ring: "border-2 border-secondary",
    initials: "text-lg text-gray-700",
    plinth: "h-14 bg-secondary",
    plinthText: "text-gray-700",
  },
  3: {
    avatar: "w-16 h-16 bg-secondary/60",
    ring: "border-2 border-secondary",
    initials: "text-lg text-gray-700",
    plinth: "h-10 bg-secondary/60",
    plinthText: "text-gray-700",
  },
}

/** The logo brown, as in sweetPointIcon — darker than `primary`, so a glyph
 * beside a points value does not blend into the number. */
const LOGO_BROWN = "#B97B53"

/**
 * A customer who opted out of the leaderboard, and equally one the server could
 * not name. Both name fields are nullable, and the old template interpolated
 * them straight into a string, so a customer with neither rendered as the
 * literal text "null null".
 */
const displayName = (user: LeaderBoardUser): string => {
  if (!user || user.anonymousEnabled) return "Anonymous"

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim()
  return name.length > 0 ? name : "Anonymous"
}

/** Initials for the podium avatars: the payload carries no picture, and two
 * letters in a tinted circle beats a row of identical silhouettes. */
const initials = (user: LeaderBoardUser): string => {
  if (!user || user.anonymousEnabled) return ""

  return [user.firstName, user.lastName]
    .map((part) => part?.trim().charAt(0) ?? "")
    .join("")
    .toUpperCase()
}

/**
 * A podium reads 2-1-3 left to right. Absent places are dropped rather than
 * left blank, so a board with one or two names still centres instead of
 * hanging off the left with holes beside it.
 */
const podiumSlots = (top: LeaderBoard): PodiumSlot[] =>
  ([
    [top[1], 2],
    [top[0], 1],
    [top[2], 3],
  ] as const)
    .filter(([entry]) => entry != null)
    .map(([entry, place]) => ({ entry: entry as LeaderBoardEntry, place }))

/*
 * Every component below sits at module scope. Defining one inside the screen
 * gives it a fresh identity on each render, which remounts every row — the same
 * reasoning as the profile menu item.
 */

const RankAvatar = React.memo(
  ({
    user,
    sizeClasses,
    ringClasses,
    textClasses,
    glyphSize,
  }: {
    user: LeaderBoardUser
    sizeClasses: string
    ringClasses: string
    textClasses: string
    glyphSize: number
  }) => {
    const letters = initials(user)

    return (
      <View
        className={`rounded-full items-center justify-center ${sizeClasses} ${ringClasses}`}
      >
        {letters ? (
          <Text className={`font-bold ${textClasses}`}>{letters}</Text>
        ) : (
          // A silhouette, not a "?": an anonymous customer is a choice, not an
          // error, and should not be drawn as one.
          <MaterialCommunityIcons
            name="account"
            size={glyphSize}
            color="#9CA3AF"
          />
        )}
      </View>
    )
  },
)
RankAvatar.displayName = "RankAvatar"

const PodiumColumn = React.memo(
  ({ slot, isMe }: { slot: PodiumSlot; isMe: boolean }) => {
    const { entry, place } = slot
    const style = PODIUM_STYLES[place]
    const name = displayName(entry.user)

    return (
      <View
        className="w-1/3 items-center"
        accessible
        accessibilityLabel={`${PLACE_WORDS[place]} place, ${name}${
          isMe ? ", you" : ""
        }, ${formatNumber(entry.pointsEarned)} points`}
      >
        <View className="h-6 justify-end">
          {place === 1 && (
            <MaterialCommunityIcons name="crown" size={22} color="#e6aa6b" />
          )}
        </View>

        <RankAvatar
          user={entry.user}
          sizeClasses={style.avatar}
          ringClasses={style.ring}
          textClasses={style.initials}
          glyphSize={place === 1 ? 34 : 28}
        />

        {/* px-1 belongs to the label, never the column: padding on the column
            would open a gap between neighbouring plinths and break the stage. */}
        <Text
          numberOfLines={1}
          className="mt-2 px-1 text-sm font-semibold text-gray-800 text-center"
        >
          {name}
        </Text>

        <View className="mt-0.5 flex-row items-center gap-1">
          <SweetPointIcon size={12} />
          <Text className="text-xs font-semibold text-primary">
            {formatNumber(entry.pointsEarned)}
          </Text>
        </View>

        {isMe && (
          <View className="mt-1 px-2.5 py-1 rounded-full border border-primary/40 bg-primary/15">
            <Text className="text-xs font-semibold text-primary">You</Text>
          </View>
        )}

        <View
          className={`mt-2 w-full items-center pt-1.5 rounded-t-lg ${style.plinth}`}
        >
          <Text className={`text-lg font-bold ${style.plinthText}`}>
            {place}
          </Text>
        </View>
      </View>
    )
  },
)
PodiumColumn.displayName = "PodiumColumn"

const Podium = React.memo(
  ({ slots, viewerId }: { slots: PodiumSlot[]; viewerId: string | null }) => (
    /* No horizontal padding, and clipped: the outer plinths run into the
       rounded bottom corners, which is what makes this read as a stage rather
       than three boxes standing near each other. `items-end` does the rest —
       the differing plinth heights give the silhouette for free, and centring
       handles a one- or two-name board with no special case. */
    <View className="bg-white rounded-xl shadow-sm pt-4 overflow-hidden mb-6">
      <View className="flex-row items-end justify-center">
        {slots.map((slot) => (
          <PodiumColumn
            key={slot.entry.user?.id ?? `place-${slot.place}`}
            slot={slot}
            isMe={!!viewerId && slot.entry.user?.id === viewerId}
          />
        ))}
      </View>
    </View>
  ),
)
Podium.displayName = "Podium"

const LeaderboardRow = React.memo(
  ({
    entry,
    place,
    isMe,
    isLast,
  }: {
    entry: LeaderBoardEntry
    place: number
    isMe: boolean
    isLast: boolean
  }) => {
    const name = displayName(entry.user)

    return (
      <View
        className={`flex-row items-center px-4 py-3 ${
          isLast ? "" : "border-b border-gray-100"
        } ${isMe ? "bg-primary/10" : ""}`}
        accessible
        accessibilityLabel={`Rank ${place}, ${name}${
          isMe ? ", you" : ""
        }, ${formatNumber(entry.pointsEarned)} points`}
      >
        <View
          className={`w-8 h-8 rounded-full items-center justify-center mr-3 ${
            isMe ? "bg-primary" : "bg-gray-100"
          }`}
        >
          <Text
            className={`text-sm font-semibold ${
              isMe ? "text-white" : "text-gray-600"
            }`}
          >
            {place}
          </Text>
        </View>

        <Text
          numberOfLines={1}
          className={`flex-1 ${
            isMe ? "font-semibold text-gray-900" : "text-gray-800"
          }`}
        >
          {name}
        </Text>

        {isMe && (
          <View className="ml-2 px-2.5 py-1 rounded-full border border-primary/40 bg-primary/15">
            <Text className="text-xs font-semibold text-primary">You</Text>
          </View>
        )}

        <View className="ml-3 flex-row items-center gap-1">
          <SweetPointIcon size={14} />
          <Text className="font-semibold text-gray-900">
            {formatNumber(entry.pointsEarned)}
          </Text>
        </View>
      </View>
    )
  },
)
LeaderboardRow.displayName = "LeaderboardRow"

const YourStandingCard = React.memo(
  ({
    userRank,
    pointsToTopTen,
    onBrowseMenu,
  }: {
    userRank: UserLeaderBoardRank
    /** What it would take to reach tenth, when that is knowable. */
    pointsToTopTen: number | null
    onBrowseMenu: () => void
  }) => {
    if (!userRank) {
      return (
        <View className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <View className="flex-row items-center">
            <View className="w-12 h-12 rounded-full bg-secondary items-center justify-center mr-4">
              <MaterialCommunityIcons
                name="trophy-outline"
                size={24}
                color={LOGO_BROWN}
              />
            </View>
            <View className="flex-1">
              <Text className="text-gray-800 font-semibold">
                You&apos;re not on the board yet
              </Text>
              <Text className="text-gray-500 text-sm mt-0.5">
                Earn points on your next order to join in.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            className="mt-4 bg-primary py-2 px-4 rounded-lg items-center"
            onPress={onBrowseMenu}
            accessibilityRole="button"
          >
            <Text className="text-white font-medium">Browse the menu</Text>
          </TouchableOpacity>
        </View>
      )
    }

    const blurb =
      userRank.position <= 3
        ? "You're on the podium"
        : userRank.position <= 10
          ? "You're in the top 10 this month"
          : pointsToTopTen !== null
            ? `${formatNumber(pointsToTopTen)} points to the top 10`
            : "Keep earning to climb the board"

    return (
      <View
        className="bg-white rounded-xl shadow-sm p-4 flex-row items-center mb-6"
        accessible
        accessibilityLabel={`Your position: ${
          userRank.position
        }. ${formatNumber(userRank.points)} points this month. ${blurb}`}
      >
        <View className="w-12 h-12 rounded-full bg-primary items-center justify-center mr-4">
          <Text className="text-white font-bold text-lg">
            {userRank.position}
          </Text>
        </View>

        <View className="flex-1">
          <Text className="text-gray-500 text-sm">Your position</Text>
          <Text className="text-gray-800 font-semibold mt-0.5">{blurb}</Text>
        </View>

        <View className="items-end ml-3">
          <View className="flex-row items-center gap-1">
            {/* No accessibilityLabel: the word "points" is on screen directly
                below, and the card announces as one sentence. */}
            <SweetPointIcon size={16} />
            <Text className="font-bold text-lg text-primary">
              {formatNumber(userRank.points)}
            </Text>
          </View>
          <Text className="text-gray-500 text-xs">points</Text>
        </View>
      </View>
    )
  },
)
YourStandingCard.displayName = "YourStandingCard"

export default function LeaderBoardPage() {
  const router = useRouter()
  const { token, authLoading, dataLoading, userDetails, leaderboardDetails } =
    useAuth()

  const [refreshing, setRefreshing] = useState(false)

  const {
    data,
    isLoading: loading,
    error,
    refetch,
    isStale,
  } = useLeaderboardQuery({ enabled: !!token })

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refetch()
    } finally {
      setRefreshing(false)
    }
  }, [refetch])

  // Only once the cached board has gone stale — unconditional would fire a
  // second request immediately after the mount fetch.
  useFocusEffect(
    useCallback(() => {
      if (!token || !isStale) return

      void refetch()
    }, [token, isStale, refetch]),
  )

  // Memoised so the `?? []` fallback does not hand back a fresh array each
  // render and defeat the slices below.
  const leaderboard = useMemo<LeaderBoard>(() => data?.leaderboard ?? [], [data])
  const top = useMemo(() => leaderboard.slice(0, 3), [leaderboard])
  const rest = useMemo(() => leaderboard.slice(3), [leaderboard])
  const slots = useMemo(() => podiumSlots(top), [top])

  const userRank: UserLeaderBoardRank = data?.userRank ?? null

  /*
   * `undefined` is not an identity. This used to compare `item.user?.id` with
   * `userDetails?.id` directly, so a row with no user and a viewer not yet
   * loaded were both `undefined` and matched — every placeholder row claimed to
   * be you. The rows are gone, but the server can still return `user: null` for
   * an orphaned loyalty record, so the guard stays.
   */
  const viewerId = userDetails?.id ?? null

  /*
   * "82 points to the top 10" is worth more than "you are 47th". Only knowable
   * when the board came back full, which is also the only way a position past
   * ten can exist — so the tenth score is always in hand when this is needed.
   */
  const pointsToTopTen = useMemo(() => {
    if (!userRank || userRank.position <= 10 || leaderboard.length < 10) {
      return null
    }
    return Math.max(1, leaderboard[9].pointsEarned - userRank.points + 1)
  }, [userRank, leaderboard])

  /*
   * The podium, or first place alone from a server that predates it. Both
   * fields are sent; `lastMonthsWinner` is what builds already on people's
   * phones read, and dropping it would blank their banner.
   */
  const lastMonthsPodium = useMemo(() => {
    const podium = leaderboardDetails?.lastMonthsTopThree
    if (podium && podium.length > 0) return podium

    return leaderboardDetails?.lastMonthsWinner
      ? [{ place: 1, name: leaderboardDetails.lastMonthsWinner }]
      : []
  }, [leaderboardDetails])

  const goToMenu = useCallback(() => router.push("/menu"), [router])

  // Hooks cannot run conditionally, so every early return sits below them.
  if (authLoading || dataLoading || loading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <BouncingLoader />
        </View>
      </View>
    )
  }

  /*
   * Shown rather than redirected. The redirect this replaces lived in an
   * effect, and a query disabled by `enabled` is not loading — so the whole
   * empty board painted for a frame before the bounce, and the customer landed
   * on sign-in with no idea why.
   */
  if (!token) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <Text className="text-xl font-bold text-center px-4">
            Sign in to see where you rank!
          </Text>
          <TouchableOpacity
            className="bg-primary p-3 rounded-lg w-1/3 items-center mt-5"
            onPress={() =>
              router.push({
                pathname: "/signin",
                params: { redirectTo: "/leaderboard" },
              })
            }
          >
            <Text className="text-white text-xl">Sign in</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // `&& !data` so a failed pull-to-refresh leaves the board that is already on
  // screen alone, rather than replacing it with an error.
  if (error && !data) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center px-4">
          <Feather name="alert-circle" size={64} color="#EF4444" />
          <Text className="mt-4 text-xl text-center text-gray-700">
            Something went wrong
          </Text>
          <Text className="mt-2 text-center text-gray-500">
            We couldn&apos;t load the leaderboard. Please try again.
          </Text>
          <TouchableOpacity
            onPress={onRefresh}
            className="mt-6 bg-primary py-3 px-6 rounded-lg"
            accessibilityRole="button"
          >
            <Text className="text-white font-medium">Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const boardIsEmpty = leaderboard.length === 0

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#e6aa6b"
            colors={["#e6aa6b"]}
          />
        }
      >
        <View className="mt-6 mb-4 px-1">
          <Text className="text-2xl font-bold">Leaderboard</Text>
          <Text className="text-gray-500 mt-1">
            Top point earners this month
          </Text>
        </View>

        {/* A strip, not a card: this is a hook, and it must not out-weigh the
            customer's own standing below it. Names are taken as the server
            sends them — the server decides who may be named, since it is the
            only place that knows each winner's own privacy setting. */}
        {lastMonthsPodium.length > 0 && (
          <View className="bg-secondary rounded-xl px-4 py-3 mb-4">
            <View className="flex-row items-center">
              <MaterialCommunityIcons
                name="crown"
                size={20}
                color={LOGO_BROWN}
              />
              <Text className="ml-2 text-sm font-semibold text-gray-700">
                Last month&apos;s top {lastMonthsPodium.length === 1 ? "spot" : lastMonthsPodium.length}
              </Text>
            </View>
            <View className="mt-1.5">
              {lastMonthsPodium.map((winner) => (
                <View
                  key={winner.place}
                  className="flex-row items-center mt-0.5"
                  accessible
                  accessibilityLabel={`${PLACE_WORDS[winner.place as Place] ?? winner.place} place, ${winner.name}`}
                >
                  <Text className="text-sm text-gray-700 w-6">
                    {winner.place}.
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="flex-1 text-sm font-semibold text-gray-700"
                  >
                    {winner.name}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Suppressed on an empty board, where "you're not on the board" would
            sit directly above "nobody is on the board". */}
        {!(boardIsEmpty && !userRank) && (
          <YourStandingCard
            userRank={userRank}
            pointsToTopTen={pointsToTopTen}
            onBrowseMenu={goToMenu}
          />
        )}

        {boardIsEmpty ? (
          <View className="bg-white rounded-xl shadow-sm p-6 items-center mb-6">
            <MaterialCommunityIcons
              name="trophy-outline"
              size={48}
              color="#D1D5DB"
            />
            <Text className="mt-2 text-gray-500 text-center">
              No one has earned points yet this month. Place an order and you
              could be first.
            </Text>
            <TouchableOpacity
              className="mt-4 bg-primary py-2 px-4 rounded-lg"
              onPress={goToMenu}
              accessibilityRole="button"
            >
              <Text className="text-white font-medium">Browse the menu</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Podium slots={slots} viewerId={viewerId} />
        )}

        {rest.length > 0 && (
          <>
            {/* Not "the rest of the top 10": the board can hold fewer, and a
                heading should not promise rows that are not there. */}
            <Text className="text-lg font-semibold mb-3 px-1">
              Also on the board
            </Text>
            <View className="bg-white rounded-xl shadow-sm overflow-hidden mb-6">
              {rest.map((entry, index) => (
                <LeaderboardRow
                  key={entry.user?.id ?? `rank-${index + 4}`}
                  entry={entry}
                  place={index + 4}
                  isMe={!!viewerId && entry.user?.id === viewerId}
                  isLast={index === rest.length - 1}
                />
              ))}
            </View>
          </>
        )}

        {leaderboardDetails?.description ? (
          <View className="bg-white rounded-xl shadow-sm p-4 flex-row items-start">
            <Feather name="info" size={18} color="#9CA3AF" />
            <Text className="ml-3 flex-1 text-sm text-gray-500">
              {leaderboardDetails.description}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  )
}

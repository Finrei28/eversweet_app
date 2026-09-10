"use client"

import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { getMonthlyWinners } from "@/services/api"
import { getErrorMessage } from "@/utilities/getError"
import { MonthlyWinner, MonthlyWinners } from "@/lib/types"
import AssignRewardForm from "@/components/assign-reward-form"

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

const PLACE_COLOURS: Record<number, string> = {
  1: "#D4AF37",
  2: "#9CA3AF",
  3: "#B87333",
}

const placeLabel = (place: number) =>
  place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`

const fullName = (winner: MonthlyWinner) =>
  [winner.firstName, winner.lastName].filter(Boolean).join(" ") ||
  "Name unavailable"

/** Step a 1-indexed month by whole months, wrapping the year with it. */
const step = (period: { month: number; year: number }, by: number) => {
  const absolute = period.year * 12 + (period.month - 1) + by
  const year = Math.floor(absolute / 12)
  return { month: absolute - year * 12 + 1, year }
}

/**
 * Last month's podium and what each winner is owed.
 *
 * Names are shown in full here, unlike the customer-facing board: staff have to
 * hand a prize to a person, so the anonymity the public surfaces honour is
 * deliberately not applied.
 */
export default function LeaderboardPrizes() {
  const router = useRouter()
  const [data, setData] = useState<MonthlyWinners | null>(null)
  const [period, setPeriod] = useState<{ month: number; year: number } | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<MonthlyWinner | null>(null)

  const load = useCallback(
    async (target: { month: number; year: number } | null) => {
      try {
        setError(null)
        const result = await getMonthlyWinners(target ?? undefined)
        setData(result)
        // The server decides which month "no month given" means, so adopt what
        // it answered rather than guessing the same thing separately.
        setPeriod({ month: result.month, year: result.year })
      } catch (err) {
        setError(getErrorMessage(err, "Could not load the winners"))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useFocusEffect(
    useCallback(() => {
      void load(period)
      // Deliberately not keyed on `period`: this reloads whatever month is on
      // screen when the screen regains focus, and changing month calls load
      // directly.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load(period)
    } finally {
      setRefreshing(false)
    }
  }, [load, period])

  const goToMonth = (by: number) => {
    if (!period) return
    const next = step(period, by)
    setLoading(true)
    setPeriod(next)
    void load(next)
  }

  /**
   * Carries the code into the collect screen rather than copying it.
   *
   * No clipboard library is installed and adding one would mean a native
   * rebuild — but this is also the better move: it covers the case the code is
   * shown here for at all, which is a customer who has arrived without their
   * phone. The collection is still recorded against whoever confirmed it.
   */
  const collectWithCode = (code: string) =>
    router.push({ pathname: "/redeem-prize", params: { code } })

  const winners = data?.winners ?? []
  const unassigned = winners.filter(
    (winner) => !winner.reward && !winner.accountClosed,
  ).length

  // The current month is still being competed for; there is nothing to settle.
  const isCurrentMonth = (() => {
    if (!period) return false
    const now = new Date()
    const nzNow = {
      month: Number(
        now.toLocaleString("en-NZ", {
          timeZone: "Pacific/Auckland",
          month: "numeric",
        }),
      ),
      year: Number(
        now.toLocaleString("en-NZ", {
          timeZone: "Pacific/Auckland",
          year: "numeric",
        }),
      ),
    }
    return period.month === nzNow.month && period.year === nzNow.year
  })()

  return (
    <View className="flex-1 bg-gray-50">
      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View className="flex-row items-center justify-between mt-4 mb-4">
          <TouchableOpacity
            onPress={() => goToMonth(-1)}
            className="p-2"
            accessibilityLabel="Previous month"
          >
            <Ionicons name="chevron-back" size={22} color="#4B5563" />
          </TouchableOpacity>

          <Text className="text-lg font-semibold">
            {period ? `${MONTHS[period.month - 1]} ${period.year}` : "Loading"}
          </Text>

          <TouchableOpacity
            onPress={() => goToMonth(1)}
            className="p-2"
            disabled={isCurrentMonth}
            accessibilityLabel="Next month"
          >
            <Ionicons
              name="chevron-forward"
              size={22}
              color={isCurrentMonth ? "#D1D5DB" : "#4B5563"}
            />
          </TouchableOpacity>
        </View>

        {unassigned > 0 && (
          <View className="flex-row items-center bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            <Ionicons name="alert-circle-outline" size={20} color="#B45309" />
            <Text className="ml-2 flex-1 text-sm text-amber-800">
              {unassigned === 1
                ? "1 winner is still waiting on a prize."
                : `${unassigned} winners are still waiting on a prize.`}
            </Text>
          </View>
        )}

        {loading ? (
          <View className="items-center py-16">
            <ActivityIndicator size="large" color="#e6aa6b" />
          </View>
        ) : error ? (
          <View className="items-center py-12">
            <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
            <Text className="mt-3 text-gray-700 text-center">{error}</Text>
            <TouchableOpacity
              className="mt-4 bg-indigo-600 py-3 px-6 rounded-lg"
              onPress={() => {
                setLoading(true)
                void load(period)
              }}
            >
              <Text className="text-white font-medium">Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : winners.length === 0 ? (
          <View className="items-center py-12">
            <Ionicons name="trophy-outline" size={48} color="#D1D5DB" />
            <Text className="mt-3 text-gray-400 text-center">
              No winners recorded for this month.
            </Text>
          </View>
        ) : (
          winners.map((winner) => (
            <View
              key={winner.id}
              className="bg-white rounded-xl p-4 mb-3 shadow-sm"
            >
              <View className="flex-row items-center">
                <View
                  style={{
                    backgroundColor: `${PLACE_COLOURS[winner.place] ?? "#9CA3AF"}20`,
                  }}
                  className="w-10 h-10 rounded-full items-center justify-center mr-3"
                >
                  <Text
                    className="font-bold"
                    style={{ color: PLACE_COLOURS[winner.place] ?? "#4B5563" }}
                  >
                    {winner.place}
                  </Text>
                </View>

                <View className="flex-1">
                  <Text className="font-semibold text-gray-900">
                    {fullName(winner)}
                  </Text>
                  <Text className="text-xs text-gray-500 mt-0.5">
                    {`${placeLabel(winner.place)} place · ${winner.points} points`}
                  </Text>
                </View>
              </View>

              {winner.accountClosed ? (
                <View className="mt-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <Text className="text-sm text-gray-500">
                    This account has been closed, so the prize cannot be
                    collected.
                  </Text>
                </View>
              ) : winner.reward ? (
                <View className="mt-3">
                  <Text className="font-medium text-gray-800">
                    {winner.reward.title}
                  </Text>
                  {winner.reward.description ? (
                    <Text className="text-sm text-gray-500 mt-0.5">
                      {winner.reward.description}
                    </Text>
                  ) : null}

                  {winner.reward.redeemedAt ? (
                    <View className="flex-row items-center mt-3">
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color="#059669"
                      />
                      <Text className="ml-1.5 text-sm text-green-700">
                        {`Collected ${new Date(winner.reward.redeemedAt).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" })}`}
                      </Text>
                    </View>
                  ) : winner.reward.expired ? (
                    <View className="flex-row items-center mt-3">
                      <Ionicons name="time-outline" size={18} color="#DC2626" />
                      <Text className="ml-1.5 text-sm text-red-600">
                        {`Expired ${new Date(winner.reward.expiresAt).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" })}, never collected`}
                      </Text>
                    </View>
                  ) : (
                    <>
                      {/* Shown here as well as in the customer's app, so a
                          winner who has lost their phone can still be served —
                          and the redemption is still recorded against whoever
                          did it. */}
                      <TouchableOpacity
                        className="flex-row items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 mt-3 border border-gray-200"
                        onPress={() => collectWithCode(winner.reward!.code)}
                        accessibilityLabel={`Collect with code ${winner.reward.code}`}
                      >
                        <Text
                          className="text-base tracking-widest text-gray-900"
                          selectable
                        >
                          {winner.reward.code}
                        </Text>
                        <Ionicons
                          name="arrow-forward-circle-outline"
                          size={20}
                          color="#4F46E5"
                        />
                      </TouchableOpacity>
                      <Text className="text-xs text-gray-500 mt-1.5">
                        {`Collect by ${new Date(winner.reward.expiresAt).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" })}`}
                      </Text>
                    </>
                  )}

                  {!winner.reward.redeemedAt && (
                    <TouchableOpacity
                      className="mt-3 border border-indigo-600 py-2.5 rounded-lg items-center"
                      onPress={() => setEditing(winner)}
                    >
                      <Text className="text-indigo-600 font-medium">
                        Edit prize
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <TouchableOpacity
                  className="mt-3 bg-indigo-600 py-3 rounded-lg items-center"
                  onPress={() => setEditing(winner)}
                >
                  <Text className="text-white font-medium">Set prize</Text>
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        {winners.length > 0 && (
          <TouchableOpacity
            className="mt-2 border border-indigo-600 py-3 rounded-lg items-center"
            onPress={() => router.push("/redeem-prize")}
          >
            <Text className="text-indigo-600 font-medium">
              Collect with a code
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {editing && (
        <AssignRewardForm
          key={editing.id}
          winner={editing}
          visible
          onClose={() => setEditing(null)}
          onSaved={() => load(period)}
        />
      )}
    </View>
  )
}

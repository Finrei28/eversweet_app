import CustomHeader from "@/_components/custom-header"
import BouncingLoader from "@/_components/loader"
import { getLeaderBoard } from "@/services/api"
import useFetch from "@/services/use_fetch"
import { useAuth } from "@/store/authProvider"
import { LeaderBoard, UserLeaderBoardRank } from "@/utils/types"
import { router } from "expo-router"
import React, { useEffect, useMemo } from "react"
import { FlatList, View, Text } from "react-native"

const getRankStyle = (index: number) => {
  if (index === 0) return { bg: "", label: "🥇" } // gold
  if (index === 1) return { bg: "", label: "🥈" } // silver
  if (index === 2) return { bg: "", label: "🥉" } // bronze
  return { bg: "#E5E7EB", label: `#${index + 1}` }
}

export default function LeaderBoardPage() {
  const { token, authLoading, dataLoading, userDetails, leaderboardDetails } =
    useAuth()
  const { data, loading } = useFetch(getLeaderBoard)
  useEffect(() => {
    if (authLoading) return

    if (!token) {
      router.replace("/signin")
      return
    }
  }, [token, authLoading])
  const leaderboard: LeaderBoard = useMemo(() => {
    const list = data?.leaderboard ?? []

    // ensure at least 10 rows for UI
    const filled = [...list]

    while (filled.length < 10) {
      filled.push({
        user: null,
        pointsEarned: 0,
      })
    }

    return filled.slice(0, 10)
  }, [data])

  const userRank: UserLeaderBoardRank = data?.userRank ?? null

  if (loading || authLoading || dataLoading) {
    return (
      <View className="flex-1 bg-background">
        <CustomHeader />
        <View className="flex-1 items-center justify-center">
          <BouncingLoader />
        </View>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-background">
      <CustomHeader />
      <Text className="text-center pt-5 pb-3 text-2xl font-bold">
        Leaderboard:{" "}
      </Text>
      <FlatList
        data={leaderboard}
        keyExtractor={(item, index) => item.user?.id ?? `empty-${index}`}
        contentContainerStyle={{ padding: 16 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item, index }) => {
          const isMe = item.user?.id === userDetails?.id
          const isEmpty = !item.user
          const style = getRankStyle(index)

          return (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 8,
                borderRadius: 12,
                backgroundColor: "#fff",
                opacity: isEmpty ? 0.6 : 1,
              }}
            >
              {/* LEFT */}
              <View
                style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
              >
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: style.bg,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 10,
                  }}
                >
                  <Text className={`${index < 3 ? "text-3xl" : ""}`}>
                    {style.label}
                  </Text>
                </View>

                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontWeight: index < 3 ? "600" : "400" }}
                  >
                    {isEmpty
                      ? "-"
                      : item.user?.anonymousEnabled
                        ? "Anonymous"
                        : `${item.user?.firstName} ${item.user?.lastName}`}{" "}
                    {isMe ? " (You)" : ""}
                  </Text>
                </View>
              </View>

              {/* RIGHT */}
              <View style={{ flexShrink: 0 }}>
                <Text style={{ fontWeight: "600" }}>
                  {isEmpty ? "-" : `${item.pointsEarned.toLocaleString()} pts`}
                </Text>
              </View>
            </View>
          )
        }}
        ListFooterComponent={
          <View>
            <View
              style={{
                marginTop: 20,
                padding: 14,
                borderRadius: 12,
                backgroundColor: "#e6aa6b",
                flexDirection: "row",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "600" }}>
                {`Your Rank: ${userRank ? "#" + userRank.position : "-"}`}
              </Text>

              <Text style={{ color: "#fff" }}>
                {userRank ? userRank.points.toLocaleString() : "-"} pts
              </Text>
            </View>
            {leaderboardDetails?.description && (
              <Text className="py-3 text-sm text-gray-500 px-5">
                {leaderboardDetails?.description}
              </Text>
            )}
          </View>
        }
      />
    </View>
  )
}

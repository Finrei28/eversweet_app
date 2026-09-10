"use client"

import { ConnectionStatus } from "@/components/connect-status"
import { DashboardHeader } from "@/components/dashboard-header"
import { OrderListItem } from "@/components/order-list-item"
import { OrderQueueIndicator } from "@/components/order-queue-indicator"
import { OrdersOverviewChart } from "@/components/orders-overview-chart"
import { SummaryCard } from "@/components/summary-card"
import { formatCurrency } from "@/lib/formatters"
import { Overview, MonthlyWinners } from "@/lib/types"
import { useAuth } from "@/providers/auth-provider"
import { getMonthlyWinners, getOverviewAPI } from "@/services/api"
import socketService from "@/services/socket-service"
import { useOrderStore } from "@/store/order-store"
import { useSocketStore } from "@/store/socket-store"
import { Ionicons } from "@expo/vector-icons"
import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useState } from "react"
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native"

export default function Dashboard() {
  const router = useRouter()
  const currentOrders = useOrderStore((state) => state.currentOrders)
  const pendingOrders = useOrderStore((state) => state.pendingOrders)
  const fetchOrders = useOrderStore((state) => state.fetchOrders)
  const isLoading = useOrderStore((state) => state.isLoading)
  const [refreshing, setRefreshing] = useState(false)
  const { authenticated, loading } = useAuth()
  const isConnected = useSocketStore((state) => state.isConnected)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [podium, setPodium] = useState<MonthlyWinners | null>(null)

  const getOverview = async () => {
    try {
      setLoadingOverview(true)
      // Independent of each other, so run them together rather than in series —
      // and settled, so a failure in one still renders the other. This used to
      // await them in turn inside a `catch {}` that swallowed everything, which
      // rendered any failure as "No winner".
      const [overviewResult, podiumResult] = await Promise.allSettled([
        getOverviewAPI(),
        getMonthlyWinners(),
      ])

      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value)
      } else {
        console.error("Failed to load the overview:", overviewResult.reason)
      }

      if (podiumResult.status === "fulfilled") {
        setPodium(podiumResult.value)
      } else {
        console.error("Failed to load the podium:", podiumResult.reason)
      }
    } finally {
      setLoadingOverview(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      getOverview()
    }, []),
  )

  const podiumWinners = podium?.winners ?? []
  const prizesToGiveOut = podiumWinners.filter(
    (winner) => !winner.reward && !winner.accountClosed,
  ).length

  // We'll show the 5 most recent orders on the dashboard
  const recentOrders = [...currentOrders]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)

  const onRefresh = async () => {
    setRefreshing(true)
    // If socket is disconnected, try to reconnect
    if (!isConnected) {
      socketService.reconnect()
    }
    await fetchOrders()
    await getOverview()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    )
  }
  if (!authenticated) {
    router.replace("/sign-in")
    return
  }

  return (
    <View className="flex-1">
      <DashboardHeader title="Dashboard" showDate={true} />
      <OrderQueueIndicator />
      <ConnectionStatus />
      <ScrollView
        className="flex-1 px-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Summary Cards */}
        <View className="flex-row flex-wrap justify-between mt-4">
          <SummaryCard
            title="Today's Sales"
            value={formatCurrency(overview?.todaySales ?? 0)}
            icon="cash-outline"
            color="#10B981"
            isLoading={loadingOverview}
          />

          <SummaryCard
            title="Orders Today"
            value={overview?.today.toString() ?? "0"}
            icon="bag-check-outline"
            color="#6366F1"
            isLoading={loadingOverview}
          />

          <SummaryCard
            title="Current Orders"
            value={currentOrders?.length.toString()}
            icon="time-outline"
            color="#F59E0B"
            isLoading={isLoading}
          />

          <SummaryCard
            title="Avg. Order Value"
            value={formatCurrency(
              overview && overview.today && overview.today > 0
                ? (overview.todaySales ?? 0) / overview.today
                : 0,
            )}
            icon="stats-chart-outline"
            color="#EF4444"
            isLoading={loadingOverview}
          />
        </View>

        {/* Last month's podium, and how many still owe a prize. Full width
            rather than a summary tile: it is a list of three people and a job
            that has to be done, not a number. */}
        <TouchableOpacity
          className="bg-white rounded-xl p-4 mt-2 shadow-sm"
          onPress={() => router.push("/leaderboard-prizes")}
          activeOpacity={0.7}
        >
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-row items-center">
              <View
                style={{ backgroundColor: "#FFD70015" }}
                className="w-8 h-8 rounded-full items-center justify-center mr-2"
              >
                <Ionicons name="medal-outline" size={18} color="#FFD700" />
              </View>
              <Text className="text-gray-500 font-medium">
                Last Month&apos;s Winners
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
          </View>

          {loadingOverview ? (
            <View className="h-7 w-3/4 bg-gray-200 rounded-md mt-1 animate-pulse" />
          ) : podiumWinners.length === 0 ? (
            <Text className="text-gray-400">No winners recorded</Text>
          ) : (
            <>
              {podiumWinners.map((winner) => (
                <View
                  key={winner.id}
                  className="flex-row items-center justify-between py-1"
                >
                  <Text className="text-gray-800" numberOfLines={1}>
                    {`${winner.place}. ${[winner.firstName, winner.lastName].filter(Boolean).join(" ") || "Name unavailable"}`}
                  </Text>
                  {winner.reward ? (
                    <Text className="text-xs text-gray-500">
                      {winner.reward.redeemedAt ? "Collected" : "Prize set"}
                    </Text>
                  ) : (
                    <Text className="text-xs font-medium text-amber-700">
                      Needs a prize
                    </Text>
                  )}
                </View>
              ))}
              {prizesToGiveOut > 0 && (
                <Text className="text-xs text-amber-700 mt-2">
                  {prizesToGiveOut === 1
                    ? "1 prize still to set"
                    : `${prizesToGiveOut} prizes still to set`}
                </Text>
              )}
            </>
          )}
        </TouchableOpacity>

        {/* Orders Chart */}
        {overview && (
          <View className="bg-white rounded-xl p-4 mt-6 shadow-sm">
            <Text className="text-lg font-semibold mb-4">
              Orders Overview for this week
            </Text>
            <OrdersOverviewChart data={overview} isLoading={loadingOverview} />
          </View>
        )}

        {/* Recent Orders */}
        <View className="bg-white rounded-xl p-4 mt-6 shadow-sm">
          <View className="flex-row justify-between items-center mb-4">
            <Text className="text-lg font-semibold">Recent Orders</Text>
            <TouchableOpacity
              className="flex-row items-center"
              onPress={() => router.push("/current-orders")}
            >
              <Text className="text-indigo-600 font-medium mr-1">View All</Text>
              <Ionicons name="chevron-forward" size={16} color="#6366F1" />
            </TouchableOpacity>
          </View>

          {recentOrders?.length > 0 ? (
            recentOrders.map((order) => (
              <OrderListItem
                key={order.id}
                order={order}
                onPress={() => router.push(`/order-details/${order.id}`)}
              />
            ))
          ) : (
            <View className="items-center justify-center py-10">
              <Ionicons name="cafe-outline" size={48} color="#D1D5DB" />
              <Text className="text-gray-400 mt-2">No recent orders</Text>
            </View>
          )}
        </View>

        {/* Pending Actions */}
        {pendingOrders?.length > 0 && (
          <View className="bg-white rounded-xl p-4 mt-6 mb-6 shadow-sm">
            <Text className="text-lg font-semibold mb-4">Pending Actions</Text>
            <TouchableOpacity
              className="flex-row items-center bg-amber-50 p-4 rounded-lg border border-amber-200"
              onPress={() => router.push("/current-orders")}
            >
              <View className="w-10 h-10 bg-amber-100 rounded-full items-center justify-center mr-3">
                <Ionicons
                  name="notifications-outline"
                  size={20}
                  color="#F59E0B"
                />
              </View>
              <View className="flex-1">
                <Text className="font-medium">Upcoming Orders</Text>
                <Text className="text-gray-600">
                  {/* Not "waiting for approval": these cannot be accepted, they
                      start on their own when the kitchen should begin them. */}
                  {pendingOrders?.length} waiting to start
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom spacing */}
        <View className="h-6" />
      </ScrollView>
    </View>
  )
}

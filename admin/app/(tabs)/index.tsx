"use client"

import { ConnectionStatus } from "@/components/connect-status"
import { DashboardHeader } from "@/components/dashboard-header"
import { OrderListItem } from "@/components/order-list-item"
import { OrderQueueIndicator } from "@/components/order-queue-indicator"
import { OrdersOverviewChart } from "@/components/orders-overview-chart"
import { SummaryCard } from "@/components/summary-card"
import { formatCurrency } from "@/lib/formatters"
import { Overview } from "@/lib/types"
import { useAuth } from "@/providers/auth-provider"
import { useOrderContext } from "@/providers/order-provider"
import { useSocket } from "@/providers/socket-provider"
import { getOverviewAPI } from "@/services/api"
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
  const { currentOrders, pendingOrders, fetchOrders, isLoading } =
    useOrderContext()
  const [refreshing, setRefreshing] = useState(false)
  const { authenticated, loading } = useAuth()
  const { isConnected, reconnect } = useSocket()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)

  const getOverview = async () => {
    try {
      setLoadingOverview(true)
      const overview = await getOverviewAPI()
      setOverview(overview)
    } catch (error) {
    } finally {
      setLoadingOverview(false)
    }
  }

  useFocusEffect(
    useCallback(() => {
      getOverview()
    }, [])
  )

  // We'll show the 5 most recent orders on the dashboard
  const recentOrders = [...currentOrders]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5)

  const onRefresh = async () => {
    setRefreshing(true)
    // If socket is disconnected, try to reconnect
    if (!isConnected) {
      reconnect()
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
            value={formatCurrency(overview?.todaySales / overview?.today || 0)}
            icon="stats-chart-outline"
            color="#EF4444"
            isLoading={loadingOverview}
          />
        </View>

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
                <Text className="font-medium">New Order Requests</Text>
                <Text className="text-gray-600">
                  {pendingOrders?.length} orders waiting for approval
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

"use client"

import { DashboardHeader } from "@/components/dashboard-header"
import { OrderCard } from "@/components/order-card"
import { OrderQueueIndicator } from "@/components/order-queue-indicator"
import { StatusFilterChip } from "@/components/status-filter-chip"
import { UpcomingOrders } from "@/components/upcoming-orders"
import { useMockUpcomingOrders } from "@/lib/mock-orders"
import { useAuth } from "@/providers/auth-provider"
import { syncPendingOrders } from "@/services/socket-service"
import { useOrderStore } from "@/store/order-store"
import { Ionicons } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { useMemo, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native"

export default function CurrentOrders() {
  const router = useRouter()
  const currentOrders = useOrderStore((state) => state.currentOrders)
  const pendingOrders = useOrderStore((state) => state.pendingOrders)
  const fetchOrders = useOrderStore((state) => state.fetchOrders)
  const isLoading = useOrderStore((state) => state.isLoading)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { authenticated, loading } = useAuth()

  // No-op unless MOCK_UPCOMING is on in a dev build.
  useMockUpcomingOrders()

  const statuses = ["ACCEPTED", "MAKING", "READY", "PICKED_UP"]

  /**
   * Only orders the kitchen has taken. The ones still waiting live in the
   * Upcoming panel above the list — they cannot be accepted, and `OrderCard`
   * offers an Accept button on anything PENDING.
   */
  const filteredOrders = useMemo(() => {
    const orders = selectedStatus
      ? currentOrders.filter((order) => order.status === selectedStatus)
      : currentOrders

    return [...orders].sort(
      (a, b) =>
        new Date(a.pickUpTime).getTime() - new Date(b.pickUpTime).getTime(),
    )
  }, [currentOrders, selectedStatus])

  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([fetchOrders(), syncPendingOrders()])
    if (!isLoading) {
      setRefreshing(false)
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#3949AB" />
      </View>
    )
  }
  if (!authenticated) {
    router.replace("/sign-in")
    return
  }

  return (
    <View className="flex-1 bg-gray-50">
      <DashboardHeader title="Current Orders" />
      <OrderQueueIndicator />
      {/* Status Filters */}
      <View className="px-4 pb-2">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 12 }}
        >
          <StatusFilterChip
            label="All"
            isSelected={selectedStatus === null}
            onPress={() => setSelectedStatus(null)}
          />
          {statuses.map((status) => (
            <StatusFilterChip
              key={status}
              label={status.charAt(0) + status.slice(1).toLowerCase()}
              isSelected={selectedStatus === status}
              onPress={() => setSelectedStatus(status)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Orders List */}
      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            onPress={() => router.push(`/order-details/${item.id}`)}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View className="h-4" />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        // Above every accepted order, and scrolls with them rather than
        // permanently occupying a third of a small screen.
        ListHeaderComponent={<UpcomingOrders orders={pendingOrders} />}
        ListEmptyComponent={() => (
          <View className="items-center justify-center py-16 flex-1">
            <Ionicons name="cafe-outline" size={64} color="#D1D5DB" />
            <Text className="text-gray-400 text-lg mt-4">
              {pendingOrders.length > 0
                ? "Nothing being made yet"
                : "No orders found"}
            </Text>
            {selectedStatus ? (
              <Text className="text-gray-400 mt-1">Try a different filter</Text>
            ) : pendingOrders.length > 0 ? (
              <Text className="text-gray-400 mt-1">
                {pendingOrders.length} waiting to start
              </Text>
            ) : null}
          </View>
        )}
      />
    </View>
  )
}

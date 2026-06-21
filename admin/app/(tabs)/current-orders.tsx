"use client"

import { DashboardHeader } from "@/components/dashboard-header"
import { OrderCard } from "@/components/order-card"
import { OrderQueueIndicator } from "@/components/order-queue-indicator"
import { StatusFilterChip } from "@/components/status-filter-chip"
import { useAuth } from "@/providers/auth-provider"
import { useOrderContext } from "@/providers/order-provider"
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
  const { currentOrders, fetchOrders, isLoading } = useOrderContext()
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const { authenticated, loading } = useAuth()

  const statuses = ["ACCEPTED", "MAKING", "READY", "PICKED_UP"]

  const filteredOrders = useMemo(() => {
    let orders = [...currentOrders]

    // Add pending orders that haven't been accepted/declined yet

    // Filter by selected status
    if (selectedStatus) {
      orders = orders.filter((order) => order.status === selectedStatus)
    }

    // Sort by created time (earlist first)
    return orders.sort(
      (a, b) =>
        new Date(a.pickUpTime).getTime() - new Date(b.pickUpTime).getTime(),
    )
  }, [currentOrders, selectedStatus])

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchOrders()
    if (!isLoading) {
      setRefreshing(false)
    }
  }

  // const handleDeclineOrder = async (orderId: string) => {
  //   await updateOrderStatus(orderId, "DECLINED")
  // }

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
        ListEmptyComponent={() => (
          <View className="items-center justify-center py-16 flex-1">
            <Ionicons name="cafe-outline" size={64} color="#D1D5DB" />
            <Text className="text-gray-400 text-lg mt-4">No orders found</Text>
            {selectedStatus ? (
              <Text className="text-gray-400 mt-1">Try a different filter</Text>
            ) : null}
          </View>
        )}
      />
    </View>
  )
}

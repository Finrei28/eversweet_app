"use client"

import { DashboardHeader } from "@/components/dashboard-header"
import { PastOrderCard } from "@/components/past-order-card"
import { formatDate } from "@/lib/formatters"
import { useAuth } from "@/providers/auth-provider"
import { useOrderContext } from "@/providers/order-provider"
import { Ionicons } from "@expo/vector-icons"
import DateTimePicker from "@react-native-community/datetimepicker"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"

export default function PastOrders() {
  const router = useRouter()
  const { completedOrders, fetchCompletedOrders, isLoading } = useOrderContext()
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const { authenticated, loading } = useAuth()

  const onRefresh = async () => {
    setRefreshing(true)
    await fetchCompletedOrders()
    if (!isLoading) {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const getPastOrders = async () => {
      await fetchCompletedOrders(selectedDate)
    }
    getPastOrders()
  }, [selectedDate])

  // Filter orders based on search and date
  const filteredOrders = completedOrders.filter((order) => {
    const customerName = `${order.customerFirstName} ${order.customerLastName}`
    const matchesSearch = searchQuery
      ? order.tempOrderId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        customerName.toLowerCase().includes(searchQuery.toLowerCase())
      : true
    return matchesSearch
  })

  const onDateChange = (event: any, date?: Date) => {
    setShowDatePicker(false)
    if (event.type === "dismissed" || !date) {
      return
    }

    setSelectedDate(date)
  }

  const clearFilters = () => {
    setSearchQuery("")
    setSelectedDate(null)
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
      <DashboardHeader title="Past Orders" />

      {/* Search and Filter */}
      <View className="px-4 pt-2 pb-4">
        <View className="flex-row items-center mb-4">
          <View className="flex-1 bg-white border border-gray-200 rounded-lg flex-row items-center px-3 mr-2">
            <Ionicons name="search" size={20} color="#9CA3AF" />
            <TextInput
              className="flex-1 py-2 px-2 text-base"
              placeholder="Search order #, customer"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            className={`h-12 px-3 rounded-lg border flex-row items-center justify-center ${
              selectedDate
                ? "bg-indigo-50 border-indigo-200"
                : "bg-white border-gray-200"
            }`}
            onPress={() => setShowDatePicker(true)}
          >
            <Ionicons
              name="calendar-outline"
              size={20}
              color={selectedDate ? "#6366F1" : "#6B7280"}
            />
          </TouchableOpacity>
        </View>

        {/* Date selection and clear filters */}
        {selectedDate && (
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-indigo-600 font-medium">
              Date: {formatDate(selectedDate.toISOString())}
            </Text>
            <TouchableOpacity onPress={clearFilters}>
              <Text className="text-gray-600">Clear Filters</Text>
            </TouchableOpacity>
          </View>
        )}

        {showDatePicker && (
          <DateTimePicker
            value={selectedDate || new Date()}
            mode="date"
            display="default"
            onChange={onDateChange}
          />
        )}
      </View>

      {/* Order List */}
      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <PastOrderCard
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
          <View className="items-center justify-center flex-1">
            <Ionicons name="archive-outline" size={64} color="#D1D5DB" />
            <Text className="text-gray-400 text-lg mt-4">
              No completed orders found
            </Text>
            {searchQuery || selectedDate ? (
              <TouchableOpacity
                className="mt-4 bg-indigo-100 px-4 py-2 rounded-lg"
                onPress={clearFilters}
              >
                <Text className="text-indigo-600 font-medium">
                  Clear Filters
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
    </View>
  )
}

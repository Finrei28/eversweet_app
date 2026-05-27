"use client"
import { OrderStatus } from "@/lib/types"
import { Ionicons } from "@expo/vector-icons"
import {
  Modal,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native"

type StatusUpdateModalProps = {
  visible: boolean
  currentStatus: OrderStatus
  onClose: () => void
  onStatusUpdate: (status: OrderStatus) => void
}

export function StatusUpdateModal({
  visible,
  currentStatus,
  onClose,
  onStatusUpdate,
}: StatusUpdateModalProps) {
  const statusOptions = [
    {
      value: "ACCEPTED",
      label: "Accepted",
      icon: "checkmark-circle-outline",
      color: "#3B82F6", // blue
      description: "Order has been accepted and will be prepared",
    },
    {
      value: "MAKING",
      label: "Making",
      icon: "restaurant-outline",
      color: "#6366F1", // indigo
      description: "Order is being prepared in the kitchen",
    },
    {
      value: "READY",
      label: "Ready for Pickup",
      icon: "bag-check-outline",
      color: "#8B5CF6", // purple
      description: "Order is ready for customer pickup",
    },
    {
      value: "PICKED_UP",
      label: "Picked up",
      icon: "checkmark-done-outline",
      color: "#10B981", // green
      description: "Order has been picked up by the customer",
    },
    {
      value: "DECLINED",
      label: "Declined",
      icon: "close-circle-outline",
      color: "#EF4444", // red
      description: "Order has been declined and canceled",
    },
  ]
  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View className="flex-1 bg-black/50 justify-end">
          <TouchableWithoutFeedback>
            <View className="bg-white rounded-t-xl px-4 pt-4 pb-8">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-xl font-bold">Update Order Status</Text>
                <TouchableOpacity onPress={onClose}>
                  <Ionicons name="close" size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>

              <Text className="text-gray-500 mb-4">
                Current status:{" "}
                {currentStatus.charAt(0) + currentStatus.slice(1).toLowerCase()}
              </Text>

              <View>
                {statusOptions.map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    className={`flex-row items-center p-4 rounded-lg mb-2 ${
                      option.value === currentStatus
                        ? "bg-gray-100 border border-gray-200"
                        : "border border-gray-200"
                    }`}
                    onPress={() => onStatusUpdate(option.value as OrderStatus)}
                    disabled={option.value === currentStatus}
                  >
                    <View
                      style={{ backgroundColor: `${option.color}20` }}
                      className="w-10 h-10 rounded-full items-center justify-center mr-3"
                    >
                      <Ionicons
                        name={option.icon as any}
                        size={20}
                        color={option.color}
                      />
                    </View>
                    <View className="flex-1">
                      <Text className="font-medium">{option.label}</Text>
                      <Text className="text-gray-500 text-sm">
                        {option.description}
                      </Text>
                    </View>
                    {option.value === currentStatus && (
                      <Ionicons
                        name="checkmark-circle"
                        size={24}
                        color="#10B981"
                      />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  )
}

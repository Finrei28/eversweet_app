"use client"

import {
  formatCurrency,
  formatCustomisation,
  getCollectionTime,
  isRemoval,
} from "@/lib/formatters"
import { Order } from "@/lib/types"
import { useCountdown } from "@/lib/useCountdown"
import { Ionicons } from "@expo/vector-icons"
import { useMemo, useState } from "react"
import { Text, TouchableOpacity, View } from "react-native"

/**
 * Paid for, not yet due. Deliberately has no Accept button: an order here is
 * one the kitchen must not start, and `OrderCard` offers Accept on anything
 * PENDING, so these are rendered separately rather than reusing it. They move
 * to Current Orders on their own when the alert fires.
 */
type UpcomingOrdersProps = {
  orders: Order[]
}

const startsAt = (order: Order) => {
  const due = order.dueAt ? new Date(order.dueAt).getTime() : NaN
  // No usable due time sorts last rather than to the top of the queue.
  return Number.isNaN(due) ? Number.POSITIVE_INFINITY : due
}

const itemCount = (order: Order) =>
  order.desserts.reduce((total, item) => total + item.quantity, 0)

const customerName = (order: Order) =>
  `${order.customerFirstName} ${order.customerLastName}`.trim()

/**
 * The countdown badge — amber once an order is due, so "waiting on staff"
 * reads differently from "not yet".
 *
 * It owns its own clock rather than taking the time as a prop, so a tick
 * re-renders this badge alone and leaves the rows around it untouched.
 */
function StartsIn({ order }: { order: Order }) {
  const label = useCountdown(order.dueAt)
  const due = label === "Start now"

  return (
    <View
      className={`flex-row items-center rounded-full px-2.5 py-1 ${
        due ? "bg-amber-100" : "bg-indigo-50"
      }`}
    >
      <Ionicons
        name={due ? "alarm-outline" : "time-outline"}
        size={13}
        color={due ? "#B45309" : "#4F46E5"}
      />
      <Text
        className={`ml-1 text-lg font-semibold ${
          due ? "text-amber-700" : "text-indigo-700"
        }`}
      >
        {label}
      </Text>
    </View>
  )
}

/**
 * One order in full — who it is for, when it is collected, and what is in it.
 *
 * Used for the collapsed lead order as well as the expanded list. The kitchen
 * needs to see the dessert lines to know what to prep next, and a single
 * upcoming order has no dropdown to open, so there is nowhere else to see them.
 */
function UpcomingRow({ order }: { order: Order }) {
  return (
    <View className="border-t border-gray-100 px-4 py-3">
      <View className="flex-row items-start justify-between">
        <View className="mr-3 flex-1">
          <Text className="font-semibold" numberOfLines={1}>
            #{order.tempOrderId}
            <Text className="font-normal text-gray-500">
              {"  "}
              {customerName(order)}
            </Text>
          </Text>
          <Text className="mt-0.5 text-xs text-gray-500">
            {order.dineIn ? "Eat in" : "Pick up"}{" "}
            {getCollectionTime(new Date(order.pickUpTime))} · {itemCount(order)}{" "}
            item{itemCount(order) === 1 ? "" : "s"}
          </Text>
        </View>

        <View className="items-end">
          <StartsIn order={order} />
          <Text className="mt-1 text-sm font-semibold">
            {formatCurrency(
              (order.priceInCents - order.discountedAmountInCents) / 100,
            )}
          </Text>
        </View>
      </View>

      <View className="mt-2">
        {order.desserts.map((line) => (
          <Text key={line.id} className="text-xs text-gray-600">
            {line.quantity}× {line.dessert.name}
            {/* Removals in red: leaving something out is the change that gets
                missed, and the one that means remaking the dessert. */}
            {line.customisations.map((c) => (
              <Text
                key={c.id}
                className={
                  isRemoval(c) ? "font-bold text-rose-600" : "text-gray-500"
                }
              >
                {" · "}
                {formatCustomisation(c)}
              </Text>
            ))}
          </Text>
        ))}
      </View>
    </View>
  )
}

export function UpcomingOrders({ orders }: UpcomingOrdersProps) {
  const [expanded, setExpanded] = useState(false)

  const sorted = useMemo(
    () => [...orders].sort((a, b) => startsAt(a) - startsAt(b)),
    [orders],
  )

  if (sorted.length === 0) return null

  const next = sorted[0]!
  const count = sorted.length
  // A single order has nothing to drop down to.
  const collapsible = count > 1
  const open = collapsible && expanded

  return (
    <View className="mb-4 overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-md">
      <TouchableOpacity
        activeOpacity={collapsible ? 0.8 : 1}
        onPress={() => collapsible && setExpanded((prev) => !prev)}
        disabled={!collapsible}
        accessibilityRole={collapsible ? "button" : undefined}
        accessibilityState={collapsible ? { expanded: open } : undefined}
        accessibilityLabel={`Upcoming orders, ${count} waiting`}
      >
        {/* Header — the band that separates this from the white order cards */}
        <View className="flex-row items-center justify-between bg-indigo-600 px-4 py-3">
          <View className="mr-2 flex-1 flex-row items-center">
            <Ionicons name="hourglass-outline" size={18} color="white" />
            <Text className="ml-2 font-semibold text-white">Upcoming</Text>
          </View>

          <View className="flex-row items-center">
            {count > 1 && (
              // Solid rather than a translucent white, so the contrast holds
              // on both platforms without depending on an opacity modifier.
              <View className="rounded-full bg-white px-2.5 py-0.5">
                <Text className="text-xs font-bold text-indigo-700">
                  {count} orders
                </Text>
              </View>
            )}
            {collapsible && (
              <Ionicons
                name={open ? "chevron-up" : "chevron-down"}
                size={18}
                color="white"
                style={{ marginLeft: 8 }}
              />
            )}
          </View>
        </View>

        {/* Collapsed — the one the kitchen starts on next, in full. */}
        {!open && (
          <View>
            <UpcomingRow order={next} />
            {count > 1 && (
              <Text className="px-4 pb-3 text-xs text-gray-400">
                +{count - 1} more · tap to see {count === 2 ? "it" : "them"}
              </Text>
            )}
          </View>
        )}
      </TouchableOpacity>

      {/* Expanded — every order, with what is in it. */}
      {open &&
        sorted.map((order) => <UpcomingRow key={order.id} order={order} />)}

      {/* Explains the absence of an Accept button. */}
      <View className="border-t border-gray-100 bg-gray-50 px-4 py-2">
        <Text className="text-xs text-gray-500">
          These start automatically when it is time to make them.
        </Text>
      </View>
    </View>
  )
}

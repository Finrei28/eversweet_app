"use client"

import { PrepTimes } from "@/lib/types"
import { getPrepTimes, updatePrepTimes } from "@/services/api"
import { getErrorMessage } from "@/utilities/getError"
import { Ionicons } from "@expo/vector-icons"
import { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import Toast from "react-native-toast-message"

/**
 * The order in which the fields are shown, and what each one means in the
 * shop's own terms. The field names are the server's; the labels are what
 * staff would say.
 */
const FIELDS: {
  key: keyof PrepTimes
  label: string
  hint: string
}[] = [
  { key: "singleItem", label: "1 item", hint: "Minutes to make" },
  { key: "upToThree", label: "2 to 3 items", hint: "Minutes to make" },
  { key: "upToSix", label: "4 to 6 items", hint: "Minutes to make" },
  { key: "moreThanSix", label: "7 or more items", hint: "Minutes to make" },
  {
    key: "kitchenSlack",
    label: "Head start",
    hint: "Extra minutes before pick-up that the alert goes off",
  },
  {
    key: "quoteFloor",
    label: "Soonest offered",
    hint: "The earliest a customer can ever be offered, in minutes",
  },
]

/**
 * Lets the shop tune its own preparation times.
 *
 * These drive two things at once: when the kitchen is told to start an order,
 * and the soonest slot a customer is offered. Both the website and the app
 * read the same values, so a change here moves both without a deploy.
 */
export default function PrepTimesSetting({
  onClose,
}: {
  /** Closes the section, mirroring Cancel on the days off calendar. */
  onClose: () => void
}) {
  const [prepTimes, setPrepTimes] = useState<PrepTimes | null>(null)
  // Held as text so a half-typed value does not become 0 mid-keystroke.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const times = await getPrepTimes()
      setPrepTimes(times)
      setDrafts(
        Object.fromEntries(
          Object.entries(times).map(([key, value]) => [key, String(value)]),
        ),
      )
    } catch (error) {
      Toast.show({
        type: "error",
        text1: getErrorMessage(error, "Could not load preparation times"),
        position: "bottom",
        bottomOffset: 60,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Only what actually moved, so a field left alone is never rewritten.
  const changed = prepTimes
    ? FIELDS.reduce<Partial<PrepTimes>>((acc, { key }) => {
        const draft = drafts[key]?.trim() ?? ""
        const parsed = Number(draft)

        if (draft === "" || !Number.isInteger(parsed)) return acc
        if (parsed === prepTimes[key]) return acc

        return { ...acc, [key]: parsed }
      }, {})
    : {}

  const hasChanges = Object.keys(changed).length > 0

  /** Closes without saving, dropping any half-typed edits. */
  const handleCancel = () => {
    if (prepTimes) {
      setDrafts(
        Object.fromEntries(
          Object.entries(prepTimes).map(([key, value]) => [key, String(value)]),
        ),
      )
    }
    onClose()
  }

  const onSave = async () => {
    if (!hasChanges) return

    setSaving(true)
    try {
      const saved = await updatePrepTimes(changed)
      setPrepTimes(saved)
      setDrafts(
        Object.fromEntries(
          Object.entries(saved).map(([key, value]) => [key, String(value)]),
        ),
      )
      Toast.show({
        type: "success",
        text1: "Preparation times updated",
        position: "bottom",
        bottomOffset: 60,
      })
      // Collapses on success, as the days off calendar does.
      onClose()
    } catch (error) {
      // The server names the field and the range it allows.
      Toast.show({
        type: "error",
        text1: getErrorMessage(error, "Could not save preparation times"),
        position: "bottom",
        visibilityTime: 4000,
        bottomOffset: 60,
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <View className="items-center justify-center py-8">
        <ActivityIndicator size="small" color="#e6aa6b" />
      </View>
    )
  }

  if (!prepTimes) {
    return (
      <View className="py-4">
        <TouchableOpacity
          className="flex-row items-center justify-center py-4"
          onPress={() => void load()}
        >
          <Ionicons name="refresh-outline" size={18} color="#6B7280" />
          <Text className="ml-2 text-gray-500">
            Could not load preparation times. Tap to retry.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="mt-2 self-start rounded-lg border border-red-300 bg-red-50 px-4 py-3"
          onPress={onClose}
        >
          <Text className="font-medium text-red-600">Close</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View>
      <Text className="mb-4 text-gray-600">
        How long each size of order takes to make. The kitchen alert goes off
        this many minutes before pick-up, plus the head start.
      </Text>

      {FIELDS.map(({ key, label, hint }) => (
        <View
          key={key}
          className="flex-row items-center justify-between border-b border-gray-100 py-3"
        >
          <View className="mr-4 flex-1">
            <Text className="font-medium">{label}</Text>
            <Text className="text-xs text-gray-500">{hint}</Text>
          </View>
          <View className="flex-row items-center">
            <TextInput
              className="w-16 rounded-lg border border-gray-200 px-3 py-2 text-center"
              keyboardType="number-pad"
              value={drafts[key] ?? ""}
              onChangeText={(text) =>
                // Digits only: the server rejects anything else, and there is
                // no reason to let it get that far.
                setDrafts((prev) => ({
                  ...prev,
                  [key]: text.replace(/[^0-9]/g, ""),
                }))
              }
              maxLength={3}
            />
            <Text className="ml-2 w-8 text-gray-500">min</Text>
          </View>
        </View>
      ))}

      <View className="mt-6 flex-row items-center justify-between">
        <TouchableOpacity
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3"
          onPress={handleCancel}
          disabled={saving}
        >
          <Text className="font-medium text-red-600">Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`flex-row items-center rounded-lg px-6 py-3 ${
            hasChanges && !saving ? "bg-indigo-600" : "bg-gray-400"
          }`}
          onPress={onSave}
          disabled={!hasChanges || saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text className="font-medium text-white">
              {hasChanges ? "Save changes" : "No changes"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

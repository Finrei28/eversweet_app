"use client"

import { useState } from "react"
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import Toast from "react-native-toast-message"
import { assignWinnerReward } from "@/services/api"
import { getErrorMessage } from "@/utilities/getError"
import { MonthlyWinner } from "@/lib/types"

const TITLE_LIMIT = 80
const DESCRIPTION_LIMIT = 240

type AssignRewardFormProps = {
  /** Never null: the parent mounts this only with a winner selected, and keys
   * it on their id so the drafts below re-seed by remounting rather than by
   * being reset in an effect. */
  winner: MonthlyWinner
  visible: boolean
  onClose: () => void
  /** Reload the podium so the new code shows on the row behind this. */
  onSaved: () => Promise<void> | void
}

const displayName = (winner: MonthlyWinner) =>
  [winner.firstName, winner.lastName].filter(Boolean).join(" ") ||
  "this customer"

/**
 * Sets what a winner is owed.
 *
 * Free text on purpose: the prize is whatever the shop decides that month and
 * differs per winner, so there is nothing structured worth modelling.
 */
export default function AssignRewardForm({
  winner,
  visible,
  onClose,
  onSaved,
}: AssignRewardFormProps) {
  // Held as strings and seeded from whatever is already set, so editing the
  // wording of an existing prize starts from that wording rather than blank.
  const [title, setTitle] = useState(winner.reward?.title ?? "")
  const [description, setDescription] = useState(
    winner.reward?.description ?? "",
  )
  const [saving, setSaving] = useState(false)

  const isEdit = winner.reward !== null
  const trimmed = title.trim()
  const changed =
    trimmed !== (winner.reward?.title ?? "") ||
    description.trim() !== (winner.reward?.description ?? "")
  const canSave = trimmed.length > 0 && changed && !saving

  const close = () => onClose()

  const save = async () => {
    try {
      setSaving(true)
      await assignWinnerReward({
        winnerId: winner.id,
        title: trimmed,
        description: description.trim() || null,
      })
      await onSaved()
      Toast.show({
        type: "success",
        text1: isEdit ? "Prize updated" : "Prize set",
        // The push only goes out the first time. Say so, rather than leaving
        // staff to wonder whether an edit re-notified the customer.
        text2: isEdit
          ? "The customer keeps the same code."
          : `${displayName(winner)} has been notified.`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
      close()
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "Could not save the prize",
        text2: getErrorMessage(error, "Please try again."),
        position: "bottom",
        visibilityTime: 4000,
        autoHide: true,
        bottomOffset: 60,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1 justify-end"
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-xl px-4 pt-4 pb-8">
            <View className="flex-row justify-between items-center mb-1">
              <Text className="text-xl font-bold">
                {isEdit ? "Edit prize" : "Set prize"}
              </Text>
              <TouchableOpacity onPress={close}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text className="text-gray-500 mb-4">
              {`${winner.place === 1 ? "1st" : winner.place === 2 ? "2nd" : "3rd"} place · ${displayName(winner)}`}
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text className="font-medium mb-1">What they get</Text>
              <TextInput
                className="rounded-lg border border-gray-200 px-3 py-2 mb-1"
                placeholder="A free tub of mochi"
                value={title}
                onChangeText={setTitle}
                maxLength={TITLE_LIMIT}
                autoFocus={!isEdit}
              />
              <Text className="text-xs text-gray-500 mb-4">
                Shown to the customer in the app, and to whoever hands it over.
              </Text>

              <Text className="font-medium mb-1">Any conditions (optional)</Text>
              <TextInput
                className="rounded-lg border border-gray-200 px-3 py-2 mb-1"
                placeholder="Any flavour, one visit"
                value={description}
                onChangeText={setDescription}
                maxLength={DESCRIPTION_LIMIT}
                multiline
                numberOfLines={3}
                style={{ textAlignVertical: "top", minHeight: 72 }}
              />

              {isEdit && (
                <View className="flex-row items-start bg-gray-50 rounded-lg p-3 mt-3 border border-gray-100">
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color="#6B7280"
                  />
                  <Text className="ml-2 flex-1 text-xs text-gray-500">
                    The collection code stays the same. The customer may already
                    have it written down or screenshotted.
                  </Text>
                </View>
              )}

              <View className="flex-row gap-3 mt-6">
                <TouchableOpacity
                  className="flex-1 rounded-lg border border-gray-300 py-3 items-center"
                  onPress={close}
                  disabled={saving}
                >
                  <Text className="font-medium text-gray-700">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className={`flex-1 rounded-lg py-3 items-center ${
                    canSave ? "bg-indigo-600" : "bg-gray-400"
                  }`}
                  onPress={save}
                  disabled={!canSave}
                >
                  <Text className="font-medium text-white">
                    {saving ? "Saving..." : isEdit ? "Save changes" : "Set prize"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

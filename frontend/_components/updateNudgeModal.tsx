import { Modal, Text, TouchableOpacity, View } from "react-native"

import { openStore } from "@/lib/storeLinks"
import { useAppUpdateStore } from "@/store/appUpdate"

type UpdateNudgeModalProps = {
  onClose: () => void
}

/**
 * Offered once a launch when the server says a newer build exists but is still
 * willing to serve this one.
 *
 * "Not now" is remembered against the build it was said to, so the next release
 * asks again and this one does not.
 */
export default function UpdateNudgeModal({ onClose }: UpdateNudgeModalProps) {
  const dismiss = useAppUpdateStore((state) => state.dismiss)

  const notNow = () => {
    dismiss()
    onClose()
  }

  return (
    <Modal visible animationType="fade" transparent onRequestClose={notNow}>
      <View className="flex-1 bg-black/50 justify-center items-center px-4">
        <View className="bg-white rounded-2xl p-6 w-full max-w-md items-center">
          <Text className="text-2xl font-bold text-center mb-4">
            A new Eversweet is out
          </Text>
          <Text className="text-gray-600 text-center mb-6">
            Update for the latest menu, offers and fixes.
          </Text>

          <TouchableOpacity
            className="bg-primary px-6 py-3 rounded-lg w-[80%]"
            onPress={() => {
              void openStore()
              onClose()
            }}
          >
            <Text className="text-white text-center font-bold text-lg">
              Update
            </Text>
          </TouchableOpacity>

          <TouchableOpacity className="mt-3 px-6 py-3" onPress={notNow}>
            <Text className="text-gray-500 text-center">Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

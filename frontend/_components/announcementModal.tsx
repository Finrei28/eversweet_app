import { Announcements } from "@/utils/types"
import React, { useState } from "react"
import { Modal, View, Text, ScrollView, TouchableOpacity } from "react-native"

type AnnouncementsPopupProps = {
  setShowAnnounceModal: React.Dispatch<React.SetStateAction<boolean>>
  showAnnounceModal: boolean
  announcements: Announcements
}

export default function AnnouncementsPopup({
  announcements,
  showAnnounceModal,
  setShowAnnounceModal,
}: AnnouncementsPopupProps) {
  const [index, setIndex] = useState(0)

  const handleNext = () => {
    if (index < announcements.length - 1) {
      setIndex(index + 1)
    } else {
      setShowAnnounceModal(false) // close after last
    }
  }

  const handlePrev = () => {
    if (index > 0) {
      setIndex(index - 1)
    }
  }

  const current = announcements[index]

  return (
    <Modal
      visible={showAnnounceModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowAnnounceModal(false)}
    >
      <View className="flex-1 bg-black/50 justify-center items-center px-4">
        <View className="bg-white rounded-2xl p-6 w-full max-w-md relative items-center">
          <Text className="text-lg text-gray-500 mb-2 text-center">
            {index + 1} / {announcements.length}
          </Text>
          <ScrollView className="mb-4">
            <View className="mb-4 rounded-xl px-6">
              <Text className="text-2xl font-bold text-center mb-4">
                {current.title}
              </Text>
              <Text className="text-gray-600 text-center">{current.text1}</Text>
              {current.text2 && (
                <Text className="text-gray-600 text-center mt-2">
                  {current.text2}
                </Text>
              )}
            </View>
          </ScrollView>
          <View className="flex-row justify-between gap-6">
            {index > 0 ? (
              <TouchableOpacity
                onPress={handlePrev}
                className={`bg-primary px-6 py-3 rounded-lg w-32`}
              >
                <Text className={`text-white text-center font-bold text-lg`}>
                  Previous
                </Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}

            <TouchableOpacity
              className={`bg-primary px-6 py-3 rounded-lg ${
                index > 0 ? "w-32" : "w-[80%]"
              } `}
              onPress={handleNext}
            >
              <Text className="text-white text-center font-bold text-lg">
                {index < announcements.length - 1 ? "Next" : "Close"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

import { getAnnouncements } from "@/services/api"
import { Announcements } from "@/utils/types"
import React, { useEffect, useState } from "react"
import {
  Modal,
  View,
  Text,
  Button,
  ScrollView,
  TouchableOpacity,
} from "react-native"

export default function AnnouncementsPopup() {
  const [announcements, setAnnouncements] = useState<Announcements>([])
  const [visible, setVisible] = useState(false)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const fetchData = async () => {
      const data = await getAnnouncements()
      if (data?.length > 0) {
        setAnnouncements(data)
        setIndex(0) // start at first announcement
        setVisible(true) // show popup automatically if announcements exist
      }
    }
    fetchData()
  }, [])

  const handleNext = () => {
    if (index < announcements.length - 1) {
      setIndex(index + 1)
    } else {
      setVisible(false) // close after last
    }
  }

  const handlePrev = () => {
    if (index > 0) {
      setIndex(index - 1)
    }
  }

  if (announcements.length === 0) return null

  const current = announcements[index]

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => setVisible(false)}
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
              <Text className="text-gray-600 text-center">
                {current.description}
              </Text>
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

import { updateDaysOff } from "@/services/api"
import { Ionicons } from "@expo/vector-icons"
import { useCallback } from "react"
import { Text, TouchableOpacity, View } from "react-native"
import { Calendar } from "react-native-calendars"
import Toast from "react-native-toast-message"

type DaysOffSettingProps = {
  selectedDates: Set<Date>
  allDaysOff: Date[]
  loadingDaysOff: boolean
  setAllDaysOff: React.Dispatch<React.SetStateAction<Date[]>>
  setSelectedDates: React.Dispatch<React.SetStateAction<Set<Date>>>
  setShowDaysOffSetting: React.Dispatch<React.SetStateAction<boolean>>
}

type MultiDateSelectorProp = {
  selectedDates: Set<Date>
  allDaysOff: Date[]
  handleDateSelect: (date: Date, isSelected: boolean) => void
}

type DayOffConfirmationProp = {
  selectedDates: Set<Date>
  handleDateSelect: (date: Date, isSelected: boolean) => void
}

// Helper component to render selected/available dates for confirmation
const DayOffConfirmation = ({
  selectedDates,
  handleDateSelect,
}: DayOffConfirmationProp) => (
  <View className="mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
    <Text className="text-sm font-semibold text-indigo-700 mb-2">
      Selected Days Off ({selectedDates.size}):
    </Text>
    <View className="flex-row flex-wrap gap-2 max-h-32 overflow-y-auto py-1">
      {Array.from(selectedDates).map((date, index) => (
        <View
          key={index}
          className="bg-indigo-100 px-3 py-1 rounded-full flex-row items-center"
        >
          <Text className="text-sm text-indigo-800">
            {formatDateForDisplay(date)}
          </Text>
          {/* Deletion button */}
          <TouchableOpacity onPress={() => handleDateSelect(date, false)}>
            <Ionicons name="close" size={14} color="#6366F1" />
          </TouchableOpacity>
        </View>
      ))}
    </View>
  </View>
)

// Helper component for the Date Picker (Simulated Android/Multi-select UI)

// Helper to format date nicely for display (e.g., Mon, Jan 1)
const formatDateForDisplay = (date: Date): string => {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export const formatCalendarDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export default function DaysOffSetting({
  selectedDates,
  allDaysOff,
  loadingDaysOff,
  setAllDaysOff,
  setSelectedDates,
  setShowDaysOffSetting,
}: DaysOffSettingProps) {
  const isConfirmButtonDisabled =
    loadingDaysOff || selectedDates.size === allDaysOff.length
  const parseCalendarDate = (dateString: string) => {
    const [year, month, day] = dateString.split("-").map(Number)
    return new Date(year, month - 1, day)
  }

  const isDateSelected = (dateString: string) =>
    Array.from(selectedDates).some(
      (date) => formatCalendarDate(date) === dateString,
    )
  // get marked dates for react-native-calendar
  const getMarkedDates = () => {
    const marked: Record<string, { selected: boolean; selectedColor: string }> =
      {}
    selectedDates.forEach((date) => {
      marked[formatCalendarDate(date)] = {
        selected: true,
        selectedColor: "#6366F1",
      }
    })
    return marked
  }
  /**
   * Handler for date changes in the date picker/selector (simulated multi-select logic).
   * Adds or removes a date from the local state.
   */
  const handleDateSelect = useCallback(
    (date: Date, isSelected: boolean) => {
      const normalizedDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      )
      const normalizedKey = formatCalendarDate(normalizedDate)

      setSelectedDates((prevSelectedDates) => {
        const nextDates = new Set<Date>()
        let alreadySelected = false

        Array.from(prevSelectedDates).forEach((prevDate) => {
          if (formatCalendarDate(prevDate) === normalizedKey) {
            alreadySelected = true
            if (isSelected) {
              nextDates.add(prevDate)
            }
          } else {
            nextDates.add(prevDate)
          }
        })

        if (isSelected && !alreadySelected) {
          nextDates.add(normalizedDate)
        }

        return nextDates
      })
    },
    [allDaysOff],
  )

  const handleCancelDaysOff = () => {
    setShowDaysOffSetting(false)
    setSelectedDates(new Set(allDaysOff))
  }

  /**
   * Handles the confirmation button press, calling the API update function.
   */
  const handleConfirmUpdate = async () => {
    if (selectedDates.size === 0 && allDaysOff.length === 0) {
      Toast.show({
        type: "error",
        text1: "Please select at least one day off.",
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
      return
    }

    try {
      const datesArray = Array.from(selectedDates)

      Toast.show({
        type: "info",
        text1: `Updating ${Math.abs(allDaysOff.length - datesArray.length)} day/s off...`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })

      const newDates = await updateDaysOff(datesArray)
      setAllDaysOff(newDates)
      setSelectedDates(new Set(newDates))
      setShowDaysOffSetting(false)

      Toast.show({
        type: "success",
        text1: "Days Off updated successfully!",
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    } catch (error) {
      console.error("Error updating days off:", error)
      Toast.show({
        type: "error",
        text1: `Failed to update day off: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    }
  }

  return (
    <>
      <Calendar
        markedDates={getMarkedDates()}
        onDayPress={(day) => {
          const date = parseCalendarDate(day.dateString)
          handleDateSelect(date, !isDateSelected(day.dateString))
        }}
        minDate={formatCalendarDate(new Date())}
        enableSwipeMonths
      />
      {/* Confirmation and Action Buttons */}
      <View className="p-4 border-t border-gray-100">
        <DayOffConfirmation
          selectedDates={selectedDates}
          handleDateSelect={handleDateSelect}
        />

        <View className="mt-6 flex-row justify-between items-center">
          <TouchableOpacity
            className="border border-red-300 bg-red-50 py-3 px-4 rounded-lg"
            onPress={handleCancelDaysOff}
          >
            <Text className="text-red-600 font-medium">Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className={`py-3 px-6 rounded-lg ${
              isConfirmButtonDisabled ? "bg-gray-400" : "bg-indigo-600"
            }`}
            onPress={handleConfirmUpdate}
            disabled={isConfirmButtonDisabled}
          >
            <Text
              className={`font-medium ${allDaysOff.length > 0 ? "text-white" : "cursor-not-allowed"}`}
            >
              Confirm Update ({selectedDates.size}/{allDaysOff.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </>
  )
}

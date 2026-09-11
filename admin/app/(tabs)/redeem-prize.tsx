"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native"
import { useFocusEffect, useLocalSearchParams } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import Toast from "react-native-toast-message"
import { DashboardHeader } from "@/components/dashboard-header"
import { redeemPrizeCode, verifyPrizeCode } from "@/services/api"
import { getErrorMessage } from "@/utilities/getError"
import { formatAsTyped, isComplete } from "@/lib/prizeCode"
import { formatLeaderboardMonth, formatPlace } from "@/lib/formatters"
import { PrizeCodeCheck } from "@/lib/types"

/**
 * Collects a prize from a code the customer shows.
 *
 * Two steps on purpose. Checking and collecting in one action would mean a
 * mistyped code that happens to land on somebody else's prize is spent before
 * anyone has read the screen — so this looks the code up first, shows who is
 * standing there and what the shop owes them, and only commits when staff say
 * so.
 */
export default function RedeemPrize() {
  // Pre-filled when staff tapped a code on the winners screen, which is how a
  // customer who arrived without their phone gets served.
  const { code: fromWinnersScreen } = useLocalSearchParams<{ code?: string }>()

  const [code, setCode] = useState(() =>
    fromWinnersScreen ? formatAsTyped(fromWinnersScreen) : "",
  )
  const appliedParam = useRef<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [check, setCheck] = useState<PrizeCodeCheck | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  /** What was just handed over, kept after `check` is cleared. */
  const [collected, setCollected] = useState<{
    name: string
    title: string
  } | null>(null)

  const complete = isComplete(code)

  const winner = check?.winner ?? null
  const winnerName =
    [winner?.firstName, winner?.lastName].filter(Boolean).join(" ") ||
    "Name unavailable"

  const reset = useCallback(() => {
    setCode("")
    setCheck(null)
    setProblem(null)
    setDone(false)
    setCollected(null)
  }, [])

  // A code handed in from the winners screen. Applied once per distinct value:
  // the param stays on the route after a reset, so without the ref, returning
  // to this tab would silently refill the box with the last customer's code.
  useEffect(() => {
    if (fromWinnersScreen && fromWinnersScreen !== appliedParam.current) {
      appliedParam.current = fromWinnersScreen
      setCode(formatAsTyped(fromWinnersScreen))
      setCheck(null)
      setProblem(null)
      setDone(false)
      setCollected(null)
    }
  }, [fromWinnersScreen])

  // Cleared on the way out, so the next customer at the counter never finds the
  // previous one's name and prize already on screen. A tab stays mounted, so
  // without this the state would simply sit there between servings.
  useFocusEffect(
    useCallback(() => {
      return () => reset()
    }, [reset]),
  )

  const onChange = (raw: string) => {
    setCode(formatAsTyped(raw))
    // Any edit invalidates what was on screen — never leave a previous
    // customer's name sitting above a half-typed different code.
    if (check || problem || done) {
      setCheck(null)
      setProblem(null)
      setDone(false)
      setCollected(null)
    }
  }

  const runCheck = async () => {
    Keyboard.dismiss()
    try {
      setChecking(true)
      setProblem(null)
      const result = await verifyPrizeCode(code)
      setCheck(result)
      if (!result.valid) setProblem(result.message)
    } catch (error) {
      setCheck(null)
      setProblem(getErrorMessage(error, "That code does not match a prize."))
    } finally {
      setChecking(false)
    }
  }

  const confirm = async () => {
    try {
      setRedeeming(true)
      await redeemPrizeCode(code)
      setCollected({
        name: winnerName,
        title: winner?.reward?.title ?? "their prize",
      })
      setDone(true)
      Toast.show({
        type: "success",
        text1: "Prize collected",
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    } catch (error) {
      // Covers the race with another till as well as a second tap here: the
      // server refuses the second claim and says when the first happened.
      setProblem(getErrorMessage(error, "Could not collect that prize"))
      setCheck(null)
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1 bg-gray-50"
      >
        <DashboardHeader title="Collect a Prize" />
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-gray-500 mt-4 mb-2">
            Type the code from the customer&apos;s app.
          </Text>

          <View className="bg-white border border-gray-200 rounded-lg flex-row items-center px-3">
            <Ionicons name="ticket-outline" size={20} color="#9CA3AF" />
            <TextInput
              className="flex-1 py-3 px-2 text-xl tracking-widest"
              placeholder="XXXX-XXXX"
              value={code}
              onChangeText={onChange}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              maxLength={9}
              onSubmitEditing={() => complete && runCheck()}
              returnKeyType="search"
            />
            {code.length > 0 && (
              <TouchableOpacity onPress={reset}>
                <Ionicons name="close-circle" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            className={`mt-4 py-3 rounded-lg items-center ${
              complete && !checking ? "bg-indigo-600" : "bg-gray-400"
            }`}
            onPress={runCheck}
            disabled={!complete || checking}
          >
            <Text className="text-white font-medium">
              {checking ? "Checking..." : "Check code"}
            </Text>
          </TouchableOpacity>

          {checking && (
            <View className="items-center py-8">
              <ActivityIndicator size="large" color="#e6aa6b" />
            </View>
          )}

          {problem && !checking && (
            <View className="bg-white rounded-xl p-4 mt-4 shadow-sm border border-red-200">
              <View className="flex-row items-start">
                <Ionicons name="close-circle" size={22} color="#DC2626" />
                <Text className="ml-2 flex-1 text-red-700">{problem}</Text>
              </View>
              <Text className="text-xs text-gray-500 mt-2">
                Do not hand anything over.
              </Text>
            </View>
          )}

          {check?.valid && !done && (
            <View className="bg-white rounded-xl p-4 mt-4 shadow-sm">
              {/* Which month, because a customer can be holding prizes from
                  more than one — "2nd place" on its own does not say which. */}
              <Text className="text-xs font-semibold text-indigo-600">
                {`${formatPlace(check.winner.place)} place · ${formatLeaderboardMonth(check.winner.month, check.winner.year)}`}
              </Text>
              <Text className="text-xl font-bold mt-1">{winnerName}</Text>
              <Text className="text-xs text-gray-500 mt-0.5">
                {`${check.winner.points} points that month`}
              </Text>

              {/* A prize assigned before the customer closed their account
                  keeps a live code, so this can be valid with nobody behind it.
                  Staff decide — but they have to be told, or all they see is
                  "Name unavailable" and no reason for it. */}
              {check.winner.accountClosed && (
                <View className="flex-row items-start bg-amber-50 border border-amber-200 rounded-lg p-3 mt-3">
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color="#B45309"
                  />
                  <Text className="ml-2 flex-1 text-xs text-amber-800">
                    This customer has closed their account. The code is still
                    valid — use your judgement.
                  </Text>
                </View>
              )}

              <View className="border-t border-gray-100 mt-3 pt-3">
                <Text className="text-gray-500 text-xs">Hand over</Text>
                <Text className="text-lg font-semibold text-gray-900 mt-0.5">
                  {check.winner.reward?.title}
                </Text>
                {check.winner.reward?.description ? (
                  <Text className="text-sm text-gray-500 mt-1">
                    {check.winner.reward.description}
                  </Text>
                ) : null}
                {check.winner.reward?.expiresAt ? (
                  <Text className="text-xs text-gray-500 mt-2">
                    {`Collectable until ${new Date(check.winner.reward.expiresAt).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland" })}`}
                  </Text>
                ) : null}
              </View>

              <TouchableOpacity
                className={`mt-4 py-3 rounded-lg items-center ${
                  redeeming ? "bg-gray-400" : "bg-green-600"
                }`}
                onPress={confirm}
                disabled={redeeming}
              >
                <Text className="text-white font-medium">
                  {redeeming ? "Collecting..." : "Mark as collected"}
                </Text>
              </TouchableOpacity>
              <Text className="text-xs text-gray-500 mt-2 text-center">
                Only once they have it in hand. This cannot be undone.
              </Text>
            </View>
          )}

          {done && (
            <View className="bg-white rounded-xl p-6 mt-4 shadow-sm items-center border border-green-200">
              <Ionicons name="checkmark-circle" size={48} color="#059669" />
              <Text className="text-lg font-semibold mt-2">Collected</Text>
              {/* Repeated rather than cleared: staff get interrupted between
                  confirming and actually handing the thing over, and this is
                  the only place left saying what it was and who it is for. */}
              {collected && (
                <>
                  <Text className="text-gray-900 font-medium text-center mt-2">
                    {collected.title}
                  </Text>
                  <Text className="text-gray-500 text-center mt-0.5">
                    {`for ${collected.name}`}
                  </Text>
                </>
              )}
              <Text className="text-gray-500 text-xs text-center mt-2">
                Recorded against your account.
              </Text>
              <TouchableOpacity
                className="mt-4 bg-indigo-600 py-3 px-6 rounded-lg"
                onPress={reset}
              >
                <Text className="text-white font-medium">Next customer</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  )
}

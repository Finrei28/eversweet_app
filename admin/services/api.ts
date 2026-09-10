import {
  Order,
  OrderStatus,
  Overview,
  PrepTimes,
  RestaurantStatus,
  WinnerDetails,
  MonthlyWinners,
  MonthlyWinner,
  WinnerReward,
  PrizeCodeCheck,
} from "@/lib/types"
import { getToken, isUserAuthorised } from "./auth"
import { getErrorMessage } from "@/utilities/getError"

const url = process.env.EXPO_PUBLIC_SERVER_URL!

export async function signInAPI({
  username,
  password,
}: {
  username: string
  password: string
}) {
  if (!username || !password) {
    throw new Error("Username and password are required.")
  }
  // Fetch only necessary fields
  try {
    const res = await fetch(`${url}/api/admin/signin`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
      headers: {
        "Content-Type": "application/json",
      },
    })

    // 1. Read the RateLimit tracking headers
    const remaining = res.headers.get("RateLimit-Remaining")
    const resetTimeInSeconds = res.headers.get("RateLimit-Reset")

    // 3. Handle when the rate limit triggers (HTTP 429)
    if (res.status === 429) {
      const errorData = await res.json()
      const minutesLeft = Math.ceil(Number(resetTimeInSeconds) / 60)

      // Update your UI state with this text
      throw new Error(
        `${errorData.error} Try again in ${minutesLeft} minutes or reset your password.`,
      )
    }

    // Handle normal validation errors (e.g. status 401 wrong password)

    if (res.status === 403) {
      // Email doesn't exist
      throw new Error("You're unauthorised to access this!")
    }

    if (!res.ok) {
      if (remaining !== null) {
        throw new Error(
          `Incorrect email or password. ${Number(remaining) <= 5 ? `You have ${remaining} attempts remaining.` : ""}`,
        )
      }
      throw new Error(`Failed to sign in, please try again later`)
    }

    const data = await res.json()

    // const data = await res.json()
    return data.token
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getPendingOrders = async (): Promise<Order[]> => {
  const token = await getToken()
  const isAuthorised = await isUserAuthorised()
  if (!isAuthorised) {
    throw new Error("You're unauthorised to access this!")
  }
  try {
    const res = await fetch(`${url}/api/admin/getPendingOrders`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()

    if (res.status === 403) {
      throw new Error("You're unauthorised to access this!")
    }
    if (!res.ok) {
      throw new Error(
        getErrorMessage(data, "Server error. Please try again later."),
      )
    }
    return data.orders
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getCurrentOrders = async (): Promise<Order[]> => {
  const token = await getToken()
  const isAuthorised = await isUserAuthorised()
  if (!isAuthorised) {
    throw new Error("You're unauthorised to access this!")
  }
  const res = await fetch(`${url}/api/admin/getCurrentOrders`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  })

  const data = await res.json()

  if (res.status === 403) {
    throw new Error("You're unauthorised to access this!")
  }
  if (!res.ok) {
    throw new Error(
      getErrorMessage(data, "Server error. Please try again later."),
    )
  }
  return data.orders
}

export const getPastOrders = async (queryDate: Date): Promise<Order[]> => {
  const token = await getToken()
  const isAuthorised = await isUserAuthorised()
  if (!isAuthorised) {
    throw new Error("You're unauthorised to access this!")
  }
  const res = await fetch(`${url}/api/admin/getPastOrders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ queryDate }),
  })
  const data = await res.json()
  if (res.status === 403) {
    throw new Error("You're unauthorised to access this!")
  }
  if (!res.ok) {
    throw new Error(
      getErrorMessage(data, "Server error. Please try again later."),
    )
  }
  return data.orders
}

export const getPrepTimes = async (): Promise<PrepTimes> => {
  const token = await getToken()
  if (!(await isUserAuthorised())) {
    throw new Error("You're unauthorised to access this!")
  }

  const res = await fetch(`${url}/api/admin/getPrepTimes`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json()

  if (res.status === 403) {
    throw new Error("You're unauthorised to access this!")
  }
  if (!res.ok) {
    throw new Error(
      getErrorMessage(data, "Server error. Please try again later."),
    )
  }
  return data.prepTimes
}

export const updatePrepTimes = async (
  changes: Partial<PrepTimes>,
): Promise<PrepTimes> => {
  const token = await getToken()
  if (!(await isUserAuthorised())) {
    throw new Error("You're unauthorised to access this!")
  }

  const res = await fetch(`${url}/api/admin/updatePrepTimes`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(changes),
  })
  const data = await res.json()

  if (res.status === 403) {
    throw new Error("You're unauthorised to access this!")
  }
  if (!res.ok) {
    // The server explains which field was out of range; surfacing its message
    // is more use than a generic failure.
    throw new Error(
      getErrorMessage(data, "Server error. Please try again later."),
    )
  }
  return data.prepTimes
}

export const updateOrderStatusAPI = async (
  orderId: string,
  newStatus: OrderStatus,
  customerId: string | null,
) => {
  try {
    const token = await getToken()
    const isAuthorised = await isUserAuthorised()
    if (!isAuthorised) {
      throw new Error("You're unauthorised to access this!")
    }

    const res = await fetch(`${url}/api/admin/updateOrderStatus`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        orderId,
        newStatus,
        customerId,
      }),
    })
    const data = await res.json()
    if (res.status === 403) {
      throw new Error("You're unauthorised to access this!")
    }

    if (res.status === 400) {
      throw new Error(getErrorMessage(data))
    }

    if (!res.ok) {
      throw new Error("Failed to send notification")
    }

    return
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getOverviewAPI = async (): Promise<Overview> => {
  try {
    const token = await getToken()
    const isAuthorised = await isUserAuthorised()
    if (!isAuthorised) {
      throw new Error("You're unauthorised to access this!")
    }

    const res = await fetch(`${url}/api/admin/getOverview`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await res.json()
    if (res.status === 403) {
      throw new Error("You're unauthorised to access this!")
    }

    if (res.status === 400) {
      throw new Error(getErrorMessage(data))
    }

    if (!res.ok) {
      throw new Error("Failed to retrieve overview")
    }

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error))
  }
}

export const getRestaurantStatusAPI = async (): Promise<RestaurantStatus> => {
  try {
    const res = await fetch(`${url}/api/restaurantStatus`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Could not get restaurant status"))
    }

    return data.restaurantStatus
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get restaurant status"))
  }
}

export const updateRestaurantStatus = async (
  availability?: boolean,
  date?: Date,
): Promise<void> => {
  try {
    const token = await getToken()
    const isAuthorised = await isUserAuthorised()
    if (!isAuthorised) {
      throw new Error("You're unauthorised to access this!")
    }

    const res = await fetch(`${url}/api/admin/updateRestaurantStatus`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dineInAvailability: availability, date }),
    })

    const data = await res.json()

    if (res.status === 403) {
      throw new Error("You're unauthorised to access this!")
    }

    if (!res.ok) {
      throw new Error(
        getErrorMessage(data, "Could not update the restaurant status"),
      )
    }
  } catch (error) {
    throw new Error(
      getErrorMessage(error, "Could not update the restaurant status"),
    )
  }
}

export const getDaysOff = async (): Promise<Date[]> => {
  try {
    const res = await fetch(`${url}/api/getDaysOff`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Could not get days off"))
    }

    return data.dates.map((date: string) => new Date(date))
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not get days off"))
  }
}

export const updateDaysOff = async (newDates: Date[]): Promise<Date[]> => {
  try {
    const token = await getToken()
    const isAuthorised = await isUserAuthorised()
    if (!isAuthorised) {
      throw new Error("You're unauthorised to access this!")
    }

    const res = await fetch(`${url}/api/admin/updateDaysOff`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newDates }),
    })

    const data = await res.json()

    if (res.status === 403) {
      throw new Error("You're unauthorised to access this!")
    }

    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Could not update days off"))
    }
    return data.newDates.map((date: string) => new Date(date))
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not update days off"))
  }
}

export const getLoyaltyWinner = async (): Promise<WinnerDetails> => {
  try {
    const token = await getToken()
    const isAuthorised = await isUserAuthorised()
    if (!isAuthorised) {
      throw new Error("You're unauthorised to access this!")
    }
    const res = await fetch(`${url}/api/admin/getLoyaltyWinner`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Failed to get loyalty winner"))
    }

    return data.winnerDetails
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not fetch loyalty winner"))
  }
}

/**
 * Last month's podium by default, or a named month.
 *
 * Names come back unredacted — staff have to hand a prize to a person, so this
 * deliberately ignores the anonymity the public board honours.
 */
export const getMonthlyWinners = async (
  period?: { month: number; year: number },
): Promise<MonthlyWinners> => {
  try {
    const token = await getToken()
    if (!(await isUserAuthorised())) {
      throw new Error("You're unauthorised to access this!")
    }

    const query = period ? `?month=${period.month}&year=${period.year}` : ""
    const res = await fetch(`${url}/api/admin/getMonthlyWinners${query}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Failed to get monthly winners"))
    }

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not fetch monthly winners"))
  }
}

/** Sets or edits a winner's prize. The code is minted on the first assign. */
export const assignWinnerReward = async (input: {
  winnerId: string
  title: string
  description?: string | null
}): Promise<WinnerReward> => {
  try {
    const token = await getToken()
    if (!(await isUserAuthorised())) {
      throw new Error("You're unauthorised to access this!")
    }

    const res = await fetch(`${url}/api/admin/assignWinnerReward`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Failed to save the reward"))
    }

    return data.reward
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not save the reward"))
  }
}

/**
 * Reads a code without spending it.
 *
 * The whole point of the two steps: staff see who is standing there and what
 * the shop owes them before anything is committed, so a mistyped code that
 * happens to land on somebody else's prize costs nothing.
 *
 * A refused code still answers 200-shaped data through the thrown message, so
 * callers get "already collected at 2:14pm" rather than a bare failure.
 */
export const verifyPrizeCode = async (
  code: string,
): Promise<PrizeCodeCheck> => {
  try {
    const token = await getToken()
    if (!(await isUserAuthorised())) {
      throw new Error("You're unauthorised to access this!")
    }

    const res = await fetch(
      `${url}/api/admin/verifyPrizeCode?code=${encodeURIComponent(code)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    )

    const data = await res.json()

    if (!res.ok) {
      throw new Error(
        getErrorMessage(data, "That code does not match a prize."),
      )
    }

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not check that code"))
  }
}

/** Marks a prize collected. Refuses a second time, saying when the first was. */
export const redeemPrizeCode = async (
  code: string,
): Promise<{ redeemed: boolean; winner: MonthlyWinner }> => {
  try {
    const token = await getToken()
    if (!(await isUserAuthorised())) {
      throw new Error("You're unauthorised to access this!")
    }

    const res = await fetch(`${url}/api/admin/redeemPrizeCode`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code }),
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(getErrorMessage(data, "Could not collect that prize"))
    }

    return data
  } catch (error) {
    throw new Error(getErrorMessage(error, "Could not collect that prize"))
  }
}

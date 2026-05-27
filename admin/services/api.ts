import { Order, OrderStatus, Overview, RestaurantStatus } from "@/lib/types"
import { getToken, isUserAuthorised } from "./auth"

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
    const data = await res.json()

    if (res.status === 401) {
      // Email doesn't exist
      throw new Error("Incorrect username or password.")
    }
    if (res.status === 403) {
      // Email doesn't exist
      throw new Error("You're unauthorised to access this!")
    }
    if (!res.ok) {
      throw new Error(`Failed to sign in, please try again later`)
    }

    // const data = await res.json()
    return data.token
  } catch (error: any) {
    throw new Error(error?.message || "Something went wrong.")
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
      throw new Error(data?.message || "Server error. Please try again later.")
    }
    return data.orders
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Something went wrong.",
    )
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
    throw new Error(data?.message || "Server error. Please try again later.")
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
    throw new Error(data?.message || "Server error. Please try again later.")
  }
  return data.orders
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
      throw new Error(data.message)
    }

    if (!res.ok) {
      throw new Error("Failed to send notification")
    }

    return
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Something went wrong.",
    )
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
      throw new Error(data.message)
    }

    if (!res.ok) {
      throw new Error("Failed to retrieve overview")
    }

    return data
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Something went wrong.",
    )
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
      throw new Error(`Error: ${data.message}`)
    }

    return data.restaurantStatus
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Could not get restaurant status",
    )
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
      throw new Error(data?.message || "Server error. Please try again later.")
    }
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Could not update the restaurant status",
    )
  }
}

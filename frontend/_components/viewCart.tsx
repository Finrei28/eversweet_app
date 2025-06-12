import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { useRouter } from "expo-router"
import { useCartStore } from "@/store/cart"
import { useAuth } from "@/store/authProvider"

// import your cart state/store (example below)

const ViewCart = () => {
  const router = useRouter()
  const getTotalItems = useCartStore((state) => state.getTotalItems)
  const totalQuantity = getTotalItems()
  const { token } = useAuth()

  const handlePress = () => {
    router.push("/cart")
  }

  if (totalQuantity === 0) return null // hide if cart is empty

  if (!token) {
    return
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handlePress} style={styles.button}>
        <Text style={styles.text}>View Cart ({totalQuantity})</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 20,
    alignItems: "flex-end",
    zIndex: 100,
  },
  button: {
    backgroundColor: "#e6aa6b",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  text: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
  },
})

export default ViewCart

import React, { useState, useEffect } from "react"
import {
  Text,
  View,
  Image,
  StatusBar,
  FlatList,
  TouchableOpacity,
} from "react-native"
import { homepageCards } from "@/_components/_homepageContent"
import PageHeader from "@/_components/pageheader"
import { Stack, useRouter } from "expo-router"
import ViewCart from "@/_components/viewCart"
import { useCartStore } from "@/store/cart"
import { FontAwesome } from "@expo/vector-icons"

// This is needed for the order history screen to properly import FontAwesome
export { FontAwesome }

export default function Index() {
  const router = useRouter()
  const cartItems = useCartStore((state) => state.items)
  return (
    <View className="flex-1 bg-background">
      <PageHeader />
      {cartItems?.length > 0 && <ViewCart />}
      <FlatList
        data={homepageCards}
        renderItem={({ item }) => (
          <>
            {Object.values(item.categories).map((category, index) => {
              return (
                <View
                  key={index}
                  className="flex justify-center bg-white mx-10 py-5 my-4 gap-5 rounded-2xl shadow-sm"
                >
                  <Text className="text-primary font-bold text-2xl text-center">
                    {category.title}
                  </Text>
                  <Image
                    source={{ uri: category.image }}
                    className="w-full bg-white h-80 mx-auto object-cover rounded-lg mt-2"
                    resizeMode="contain"
                    alt={category.title}
                    accessibilityLabel={category.title}
                    accessibilityHint={`This is the ${category.title} image`}
                    accessibilityRole="image"
                    accessibilityState={{ selected: true }}
                    accessibilityLabelledBy="category-image"
                  />
                  <TouchableOpacity
                    onPress={() => {
                      // Handle button press
                      router.replace(`/menu?categoryParam=${category.category}`)
                    }}
                    accessibilityLabel={`View more for ${category.title}`}
                    accessibilityHint={`Press to view more about ${category.title}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: false }}
                    accessibilityLabelledBy="view-more-button"
                    className="bg-primary rounded-lg p-3 items-center w-1/2 mt-4 mx-auto"
                    // style={{
                    //   backgroundColor: "#007BFF", // Replace with your desired button color
                    //   padding: 10,
                    //   borderRadius: 5,
                    //   alignItems: "center",
                    // }}
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
                      View More
                    </Text>
                  </TouchableOpacity>
                </View>
              )
            })}
          </>
        )}
        ListHeaderComponent={
          <View>
            <Text className="mt-36 text-4xl font-bold text-primary p-5 text-center">
              Our dessert series
            </Text>
          </View>
        }
      />
    </View>
  )
}

# Welcome Eversweet Admin 👋

# App Audio Permission Explanation

This project uses the [`expo-av`](https://docs.expo.dev/versions/latest/sdk/av/) library to provide audio alert functionality for store staff.

## Why `expo-av` is used

- The app plays alert sounds whenever a **new order arrives**.
- This feature notifies store employees (admins) in real-time so they can **accept and prepare orders efficiently**.
- `expo-av` is used **only for audio playback** of alert tones, and **does not record or capture any audio** from the user’s device.

## Privacy and Permissions

- The `android.permission.RECORD_AUDIO` permission is included because `expo-av` supports audio recording features.
- **However, this app does NOT use or activate microphone recording in any way.**
- The microphone permission is required by `expo-av` internally but is **not utilized by the app**.

---

If you have any questions or concerns about privacy or app permissions, please contact us at [eversweet@eversweet.co.nz].

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.

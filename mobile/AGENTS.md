This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

This app uses **React Navigation**, NOT Expo Router. `expo-router` is not installed and there is no `src/app/` directory — do not add either.

- Stack: `@react-navigation/native` + `@react-navigation/native-stack`.
- Screens are plain components in `src/screens/`, each default-exported. They are not routes — a file's location does nothing until it is registered in the navigator.
- The navigator is `src/navigation/RootNavigator.tsx`. It also decides logged-out vs logged-in (it renders `LoginScreen` directly when there is no user, so the auth screen is outside the stack).
- `RootStackParamList` in `src/navigation/RootNavigator.tsx` is the single source of truth for route names and params. Add a new screen by adding its entry there, then typing the screen's props with `NativeStackScreenProps<RootStackParamList, 'YourScreen'>`.
- Navigate with the `navigation` prop from those props (`navigation.navigate('Attendance')`) — not with an imported `router` singleton.
- Docs: https://reactnavigation.org/docs/native-stack-navigator

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

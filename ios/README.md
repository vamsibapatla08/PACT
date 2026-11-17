# Pact iOS app

The iPhone app, in SwiftUI. It uses the same live Supabase project as the web app (sign in with Google, pacts, chat, invites) and the `wallet` Edge Function for the Circle wallet on Arc Testnet.

## Run it (needs a Mac)

- Install Xcode from the App Store, then the two tools: `brew install xcodegen cocoapods`
- `cd ios`
- `xcodegen generate` makes the Xcode project and runs `pod install` for Circle's wallet SDK
- Open `Pact_App.xcworkspace` (not the `.xcodeproj`), pick an iPhone simulator and press Run
- Run `xcodegen generate` again after pulling if files were added or removed

Google sign-in needs `pact://**` in Supabase under Authentication, URL Configuration, Redirect URLs.

## No Mac (Windows, Linux, Android)

Swift apps only build and run on a Mac with Xcode, so the app itself can't run here.

- Read the code on GitHub, or open the `ios` folder in VS Code with the Swift extension for highlighting
- Use the web app in your phone's browser to try the same live data

## Where things are

| Path | What it is |
|---|---|
| `Pact_App/Core/PactStore.swift` | All live data: sign in, pacts, members, chat, invites |
| `Pact_App/Core/Wallet.swift` | The Circle wallet: create, balance, send to a pact member, activity |
| `Pact_App/Core/CircleLayout.swift` | The backup questions Circle's setup offers |
| `Pact_App/Features/` | One folder per screen and tab |
| `Pact_App/Design/PactTheme.swift` | Colours, the silver gradient, buttons and cards |
| `CircleTheme/` | Pact's look and wording for Circle's PIN screens, copied in by the `Podfile` |
| `project.yml` | The Xcode project, for xcodegen |

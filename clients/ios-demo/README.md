# ios-demo

Reference SwiftUI app exercising every public method on `PasskeySDK` against the local `examples/hono-app`. Manual run target — there are no automated tests.

## Run against the simulator

1. **Start the server.** From the repo root:
   ```bash
   PORT=3001 NODE_ENV=test pnpm --filter hono-app-example dev
   ```
   The app starts on `http://localhost:3001`. `NODE_ENV=test` mounts the `/__test/last-otp` peek endpoint — handy for grabbing the OTP without checking the server logs.

2. **Open the demo in Xcode.** No `.xcodeproj` is committed (auto-generated metadata is brittle to share across machines). Create one once:
   - File → New → Project → iOS → App.
   - Product Name: `ios-demo`. Interface: SwiftUI. Language: Swift.
   - Save it inside `clients/ios-demo/` (or anywhere — the `.xcodeproj` is gitignored).
   - Delete the auto-generated `ContentView.swift`, `<name>App.swift`, and `Info.plist` from the project.
   - Drag in `Sources/ContentView.swift`, `Sources/ios_demoApp.swift`, and `Sources/Info.plist` from this directory.
   - Add the local Swift Package: File → Add Package Dependencies… → Add Local… → select `../PasskeySDK`.
   - Set the target's deployment target to iOS 26.

3. **Build and run** in any iOS 26 Simulator. The demo's `baseURL` points at `http://localhost:3001/auth`, which the simulator can reach over the host's loopback.

4. **Walk through the buttons** in any order. The status pane shows the latest result or error.

## Real-device runs

Real devices need:
- A real domain with HTTPS (e.g. `https://auth.example.com/auth`). Local-tunnel tools like Cloudflared work for development.
- An AASA file at `https://<apex>/.well-known/apple-app-site-association` (the SDK's `auth.appleAppSiteAssociation` helper produces it).
- An `Associated Domains` capability in Xcode → Signing & Capabilities, with entries `webcredentials:<apex>` and `applinks:<apex>`.
- `AuthClientConfig.rpIDOverride` set to `<apex>` so the RP ID matches what the AASA file declares.

Real-device testing is **not** part of Phase 3 acceptance — the simulator path is the default. This section is here for users who want to take the demo further.

## What's wired up

Every public `AuthClient` method has a button:

- **Email OTP**: Send OTP, Verify OTP (uses the `/__test/last-otp` peek endpoint to pre-fill the code field — saves a copy/paste).
- **Passkey**: Register, Sign In, Delete.
- **Session**: Get Current User, Sign Out, List Sessions, List Passkeys.

Errors are formatted as `ERROR <code>: <message>` in the status pane.

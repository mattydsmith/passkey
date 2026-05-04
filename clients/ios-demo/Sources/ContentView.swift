import SwiftUI
import PasskeySDK

struct ContentView: View {
    @State private var email = ""
    @State private var otp = ""
    @State private var status = "(no output yet)"
    @State private var pendingOtpId: String?
    @State private var pendingPasskeyId: String?

    private let client: AuthClient = {
        AuthClient(config: AuthClientConfig(
            baseURL: URL(string: "http://localhost:3001/auth")!
        ))
    }()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                section("Email OTP") {
                    TextField("you@example.com", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Button("Send OTP") { Task { await sendOTP() } }
                        Button("Peek OTP") { Task { await peekOTP() } }
                            .disabled(email.isEmpty)
                    }
                    TextField("6-digit code", text: $otp)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                    Button("Verify OTP") { Task { await verifyOTP() } }
                }

                section("Passkey") {
                    Button("Register Passkey") { Task { await registerPasskey() } }
                    Button("Sign in with Passkey") { Task { await signInWithPasskey() } }
                    Button("Delete Passkey") { Task { await deletePasskey() } }
                        .disabled(pendingPasskeyId == nil)
                }

                section("Session") {
                    Button("Get Current User") { Task { await getCurrentUser() } }
                    Button("Sign Out") { Task { await signOut() } }
                    Button("List Sessions") { Task { await listSessions() } }
                    Button("List Passkeys") { Task { await listPasskeys() } }
                }

                section("Status") {
                    Text(status)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                        .background(Color.gray.opacity(0.1))
                        .cornerRadius(4)
                }
            }
            .padding()
        }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content()
        }
        .padding(12)
        .background(Color.gray.opacity(0.05))
        .cornerRadius(8)
    }

    // MARK: - Actions

    private func sendOTP() async {
        do {
            let r = try await client.startEmailSignIn(email: email)
            pendingOtpId = r.otpId
            show("startEmailSignIn", "otpId=\(r.otpId), expiresInSeconds=\(r.expiresInSeconds)")
        } catch { show("startEmailSignIn", error) }
    }

    private func peekOTP() async {
        do {
            guard !email.isEmpty else { return }
            let url = URL(string: "http://localhost:3001/__test/last-otp?email=\(email.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? email)")!
            let (data, _) = try await URLSession.shared.data(from: url)
            struct PeekResponse: Decodable { let code: String }
            let response = try JSONDecoder().decode(PeekResponse.self, from: data)
            otp = response.code
            show("peekOTP", "filled otp=\(response.code)")
        } catch {
            show("peekOTP", error)
        }
    }

    private func verifyOTP() async {
        do {
            guard let otpId = pendingOtpId else {
                show("verifyEmailOtp", "no pending otpId")
                return
            }
            let r = try await client.verifyEmailOtp(otpId: otpId, code: otp)
            show("verifyEmailOtp", "user=\(r.user.id) email=\(r.user.email)")
        } catch { show("verifyEmailOtp", error) }
    }

    private func registerPasskey() async {
        do {
            let r = try await client.registerPasskey(deviceName: "iPhone Simulator")
            pendingPasskeyId = r.passkeyId
            show("registerPasskey", "passkeyId=\(r.passkeyId)")
        } catch { show("registerPasskey", error) }
    }

    private func signInWithPasskey() async {
        do {
            let r = try await client.signInWithPasskey()
            show("signInWithPasskey", "user=\(r.user.id)")
        } catch { show("signInWithPasskey", error) }
    }

    private func deletePasskey() async {
        do {
            guard let id = pendingPasskeyId else {
                show("deletePasskey", "no pending passkeyId")
                return
            }
            try await client.deletePasskey(id: id)
            show("deletePasskey", "ok (\(id))")
            pendingPasskeyId = nil
        } catch { show("deletePasskey", error) }
    }

    private func getCurrentUser() async {
        do {
            let r = try await client.getCurrentUser()
            show("getCurrentUser", "user=\(r.user.id) email=\(r.user.email)")
        } catch { show("getCurrentUser", error) }
    }

    private func signOut() async {
        do {
            try await client.signOut()
            show("signOut", "ok")
        } catch { show("signOut", error) }
    }

    private func listSessions() async {
        do {
            let r = try await client.listSessions()
            show("listSessions", "\(r.sessions.count) session(s)")
        } catch { show("listSessions", error) }
    }

    private func listPasskeys() async {
        do {
            let r = try await client.listPasskeys()
            show("listPasskeys", r.passkeys.map { "\($0.id) \($0.deviceName ?? "?")" }.joined(separator: "\n"))
        } catch { show("listPasskeys", error) }
    }

    // MARK: - Status helpers

    private func show(_ label: String, _ payload: String) {
        status = "[\(label)] \(payload)"
    }

    private func show(_ label: String, _ error: any Error) {
        if let e = error as? AuthClientError {
            status = "[\(label)] ERROR \(e.rawCode): \(e.message)"
        } else {
            status = "[\(label)] ERROR \(error.localizedDescription)"
        }
    }
}

#Preview {
    ContentView()
}

import SwiftUI

/// Sign in: the logo, one line on what Pact does, and Continue with Google, centered on black.
/// Signs in with Google through the live Supabase project.
struct SignInView: View {
    @Environment(PactStore.self) private var store
    @State private var appeared = false
    @State private var signingIn = false
    @State private var breathe = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 16) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 96)
                    .shadow(color: PactColor.silver.opacity(breathe ? 0.35 : 0.15), radius: breathe ? 34 : 22)
                    .scaleEffect(appeared ? 1 : 0.85)
                    .rise(appeared, after: 0)
                Text("Pact")
                    .font(.system(size: 48, weight: .heavy))
                    .silver()
                    .rise(appeared, after: 0.12)
                Text("Plan it together. Pay your share.")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .rise(appeared, after: 0.24)
            }
            .multilineTextAlignment(.center)
            Spacer()
            VStack(spacing: 14) {
                Button {
                    signingIn = true
                    Task { await store.signIn(); signingIn = false }
                } label: {
                    Label { Text("Continue with Google") } icon: { GoogleMark() }
                }
                .pactAction()
                .disabled(signingIn)
                if let error = store.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
                Text("No password. Test money only.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .rise(appeared, after: 0.4)
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity)
        .background(AmbientBackdrop())
        .onAppear {
            appeared = true
            // A slow glow behind the logo, so the screen feels alive without moving anything.
            withAnimation(.easeInOut(duration: 2.6).repeatForever()) { breathe = true }
        }
    }
}

extension View {
    /// Fades and lifts into place, a beat after the parts above it.
    func rise(_ shown: Bool, after delay: Double) -> some View {
        opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .animation(.smooth(duration: 0.7).delay(delay), value: shown)
    }
}

/// Google's four-colour G, drawn so it needs no image.
struct GoogleMark: View {
    var body: some View {
        Text("G")
            .font(.system(size: 19, weight: .bold, design: .rounded))
            .foregroundStyle(AngularGradient(colors: [Color(hex: 0xEA4335), Color(hex: 0xFBBC05), Color(hex: 0x34A853), Color(hex: 0x4285F4), Color(hex: 0xEA4335)],
                                             center: .center))
            .padding(2)
            .background(.white, in: .circle)
    }
}

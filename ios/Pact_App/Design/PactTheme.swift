import SwiftUI

/// Pact's few colours: mostly black, white text, soft silver for the one action on each screen, green for paid.
enum PactColor {
    static let ground = Color.black
    /// List rows are see-through, so every screen is one black page split only by thin lines.
    static let row = Color.clear
    static let silver = Color(hex: 0xC8CCD2)
    static let silverPale = Color(hex: 0xF4F5F7)
    static let silverDeep = Color(hex: 0x8E939B)
    /// Paid and checked on chain.
    static let paid = Color(hex: 0x7ED9A0)
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

extension LinearGradient {
    /// Pale silver into deep silver, for the one button on each screen.
    static let pactSilver = LinearGradient(colors: [PactColor.silverPale, PactColor.silver, PactColor.silverDeep],
                                           startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// The ground every screen sits on: black at the top fading into a slow mesh of graphite, steel blue and a little
/// violet lower down, so the glass above it has colour to bend.
struct AmbientBackdrop: View {
    /// Faint liquid gold and silver, slowly moving, the same as the website (LiquidGold.metal).
    /// Drawn at a third of the screen's resolution and scaled up: it's soft, so nobody sees the pixels.
    private let scale: CGFloat = 3

    var body: some View {
        GeometryReader { geo in
            TimelineView(.animation(minimumInterval: 1 / 24)) { timeline in
                let t = Float(timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600))
                let small = CGSize(width: max(1, geo.size.width / scale), height: max(1, geo.size.height / scale))
                Rectangle()
                    .frame(width: small.width, height: small.height)
                    .colorEffect(ShaderLibrary.liquidGold(.float2(small), .float(t)))
                    .scaleEffect(scale, anchor: .topLeading)
                    .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
            }
        }
        .background(Color.black)
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

/// Light catching the rim of a piece of glass: bright at the top left, fading round the sides.
struct GlassRim<S: InsettableShape>: View {
    let shape: S
    var strength = 1.0

    var body: some View {
        shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.42 * strength), .white.opacity(0.06 * strength),
                                                   .white.opacity(0.02), .white.opacity(0.16 * strength)],
                                          startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 0.9)
    }
}

/// A panel of liquid glass on the backdrop, with a soft sheen and no border.
struct PactCard: ViewModifier {
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [.white.opacity(0.07), .white.opacity(0.0), PactColor.silver.opacity(0.04)],
                                       startPoint: .top, endPoint: .bottom), in: shape)
            .glassEffect(.regular.tint(Color(hex: 0x8A93A6).opacity(0.08)), in: shape)
            .shadow(color: .black.opacity(0.35), radius: 24, y: 14)
    }
}

/// A recessed spot inside a card, for fields and option tiles. Not glass on glass, just a darker hollow.
struct PactWell: ViewModifier {
    var cornerRadius: CGFloat = 18

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background(LinearGradient(colors: [.black.opacity(0.32), .black.opacity(0.18)], startPoint: .top, endPoint: .bottom), in: shape)
            .overlay(shape.strokeBorder(LinearGradient(colors: [.black.opacity(0.4), .white.opacity(0.10)],
                                                       startPoint: .top, endPoint: .bottom), lineWidth: 0.8))
    }
}

/// Brushed liquid silver for the hero cards and the main button: the silver gradient with a wet highlight on top.
struct LiquidMetal<S: Shape>: View {
    let shape: S

    var body: some View {
        shape.fill(LinearGradient.pactSilver)
            .overlay(shape.fill(LinearGradient(colors: [.white.opacity(0.55), .white.opacity(0.0)],
                                               startPoint: .top, endPoint: .center)).blendMode(.softLight))
            .overlay(shape.fill(RadialGradient(colors: [.white.opacity(0.45), .clear],
                                               center: UnitPoint(x: 0.2, y: 0), startRadius: 0, endRadius: 220)).blendMode(.overlay))
            .overlay(shape.stroke(LinearGradient(colors: [.white.opacity(0.9), .white.opacity(0.1), .black.opacity(0.15)],
                                                 startPoint: .top, endPoint: .bottom), lineWidth: 1))
    }
}

extension LinearGradient {
    /// A faint brushed-silver fill for cards and fields on the dark backdrop.
    static let pactSheen = LinearGradient(colors: [PactColor.silverPale.opacity(0.16), PactColor.silver.opacity(0.07), PactColor.silverDeep.opacity(0.12)],
                                          startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// The second action next to the main one: a clear glass capsule that ripples when pressed.
struct PactGhostButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.bold))
            .foregroundStyle(LinearGradient.pactSilver)
            .frame(maxWidth: .infinity, minHeight: 54)
            .contentShape(.capsule)
            .glassEffect(.regular.interactive(), in: .capsule)
            .overlay(GlassRim(shape: Capsule()))
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

/// The one big action on a screen: a capsule of liquid silver with solid black text.
struct PactButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.bold))
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(LiquidMetal(shape: Capsule()))
            .shadow(color: PactColor.silver.opacity(enabled ? 0.25 : 0), radius: 22, y: 10)
            .opacity(enabled ? (configuration.isPressed ? 0.85 : 1) : 0.35)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

extension View {
    /// A system list or form on plain black, with see-through rows and solid text.
    func pactList() -> some View {
        scrollContentBackground(.hidden)
            .background(AmbientBackdrop())
            .fontWeight(.medium)
    }

    /// The one big action at the bottom of a screen.
    func pactAction() -> some View {
        buttonStyle(PactButtonStyle())
    }

    func pactGhost() -> some View {
        buttonStyle(PactGhostButtonStyle())
    }

    func pactCard() -> some View {
        modifier(PactCard())
    }

    func pactWell(_ cornerRadius: CGFloat = 18) -> some View {
        modifier(PactWell(cornerRadius: cornerRadius))
    }

    /// A hero card in liquid silver, like the balance and the PactSplit progress.
    func liquidMetal(_ cornerRadius: CGFloat = 28) -> some View {
        background(LiquidMetal(shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)))
            .shadow(color: PactColor.silver.opacity(0.22), radius: 28, y: 12)
    }

    /// A small round glass button, for close and other icon actions.
    func glassCircle() -> some View {
        glassEffect(.regular.interactive(), in: .circle)
    }

    /// A small glass capsule, for status tags and suggestion chips.
    func glassChip() -> some View {
        padding(.horizontal, 12).padding(.vertical, 7)
            .glassEffect(.regular.interactive(), in: .capsule)
            .overlay(GlassRim(shape: Capsule(), strength: 0.7))
    }

    /// Text filled with the silver gradient.
    /// Titles and labels in clean white, like the website. (The name stays so every screen picks it up.)
    func silver() -> some View {
        foregroundStyle(.white)
    }
}

func dollars(_ value: Double) -> String {
    value.formatted(.currency(code: "USD").locale(Locale(identifier: "en_US")).precision(.fractionLength(value.rounded() == value ? 0 : 2)))
}

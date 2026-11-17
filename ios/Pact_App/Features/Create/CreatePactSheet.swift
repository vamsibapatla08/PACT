import SwiftUI

/// A new pact: what it's called, what kind of plan it is, the details, and the friends to ask in.
/// A pact is the group chat for one plan.
struct CreatePactSheet: View {
    @Environment(PactStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var details = PactDetails()
    @State private var picked: Set<Friend.ID> = []
    @State private var saving = false

    var body: some View {
        let ready = !saving && !name.trimmingCharacters(in: .whitespaces).isEmpty
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                SheetTitle(title: "New pact")
                PactField(label: "Name") { TextField("Austin hackathon trip", text: $name) }
                PactDetailsForm(details: $details)
                FriendPicker(picked: $picked)
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            Button(saving ? "Creating…" : (picked.isEmpty ? "Create pact" : "Create and ask \(picked.count)")) {
                saving = true
                Task {
                    let friends = store.friends.filter { picked.contains($0.id) }
                    if await store.create(name: name, details: details, friends: friends) != nil { dismiss() }
                    saving = false
                }
            }
            .pactAction()
            .disabled(!ready)
            .padding(.horizontal, 24).padding(.top, 28).padding(.bottom, 8)
            // Only a look behind the button: it must never take taps meant for the form above it.
            .background {
                LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .top, endPoint: .center)
                    .ignoresSafeArea(edges: .bottom)
                    .allowsHitTesting(false)
            }
        }
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.large])
        .errorAlert()
    }
}

/// The big silver title and close button at the top of a sheet.
struct SheetTitle: View {
    @Environment(\.dismiss) private var dismiss
    let title: String

    var body: some View {
        HStack {
            Text(title).font(.system(size: 30, weight: .heavy)).silver()
            Spacer()
            Button("Close", systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly).font(.headline).foregroundStyle(.secondary)
                .frame(width: 36, height: 36).glassCircle()
        }
    }
}

/// The kind of plan, what it is, where, when, the budget each and the link. Used to make a pact and to edit one.
struct PactDetailsForm: View {
    @Binding var details: PactDetails

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Text("What kind").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(PactKind.allCases) { kind in
                            let on = details.kind == kind
                            Button { details.kind = kind } label: {
                                Label(kind.title, systemImage: kind.symbol)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(on ? AnyShapeStyle(Color.black) : AnyShapeStyle(LinearGradient.pactSilver))
                                    .padding(.horizontal, 14).padding(.vertical, 10)
                                    .background { if on { LiquidMetal(shape: Capsule()) } }
                                    .glassEffect(on ? .identity : .regular.interactive(), in: .capsule)
                            }
                            .buttonStyle(.plain)
                            .sensoryFeedback(.selection, trigger: on)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
            PactField(label: "What it is") { TextField("Hotel for the four of us", text: $details.about, axis: .vertical) }
            PactField(label: "Where") { TextField("Austin, TX", text: $details.location) }
            VStack(alignment: .leading, spacing: 10) {
                DatesField(on: $details.hasDates, from: $details.startsOn, to: $details.endsOn)
            }
            PactField(label: "Budget each") {
                TextField("Optional", value: $details.budget, format: .currency(code: "USD")).keyboardType(.decimalPad)
            }
            PactField(label: "Link") {
                TextField("Booking or event link", text: $details.link)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
        }
    }
}

/// A Dates switch with From and To underneath once it's on. The switch is a plain button, because a system
/// Toggle inside a scrolling sheet loses quick taps to the scroll view.
struct DatesField: View {
    @Binding var on: Bool
    @Binding var from: Date
    @Binding var to: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { withAnimation(.smooth) { on.toggle() } } label: {
                HStack {
                    Text("Dates").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Capsule()
                        .fill(on ? AnyShapeStyle(LinearGradient.pactSilver) : AnyShapeStyle(.white.opacity(0.14)))
                        .frame(width: 52, height: 30)
                        .overlay(alignment: on ? .trailing : .leading) {
                            Circle().fill(on ? .black : .white).padding(3).shadow(color: .black.opacity(0.25), radius: 2, y: 1)
                        }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.selection, trigger: on)
            .accessibilityValue(on ? "On" : "Off")
            if on {
                VStack(spacing: 10) {
                    row("From", selection: $from)
                    row("To", selection: $to)
                }
                .padding(14)
                .pactWell(16)
                // Both pickers are set up the same, or iOS shortens one's date; the order is kept here instead.
                .onChange(of: from) { if to < from { to = from } }
                .onChange(of: to) { if to < from { from = to } }
            }
        }
    }

    private func row(_ label: String, selection: Binding<Date>) -> some View {
        HStack {
            Text(label).font(.subheadline.weight(.semibold))
            Spacer()
            DayButton(label: label, day: selection)
        }
    }
}

/// A date shown as "Nov 19, 2026" that opens a calendar. iOS 26's compact picker prints other days as
/// "2026-11-19", so the label is drawn here and the calendar is the full graphical one.
private struct DayButton: View {
    let label: String
    @Binding var day: Date
    @State private var picking = false

    var body: some View {
        Button { picking = true } label: {
            Text(day.formatted(.dateTime.month(.abbreviated).day().year()))
                .font(.body.weight(.medium))
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(.white.opacity(0.08), in: .capsule)
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $picking) {
            VStack(spacing: 12) {
                HStack {
                    Text(label).font(.title3.weight(.heavy)).silver()
                    Spacer()
                    Button("Done") { picking = false }.font(.headline).silver()
                }
                DatePicker(label, selection: $day, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .tint(PactColor.silver)
            }
            .padding(20)
            .presentationDetents([.medium])
            .presentationBackground { AmbientBackdrop() }
        }
    }
}

/// Tap friends' faces to pick who to ask in.
struct FriendPicker: View {
    @Environment(PactStore.self) private var store
    @Binding var picked: Set<Friend.ID>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Who's coming").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            if store.friends.isEmpty {
                Text("Add friends in the Friends tab first. You can ask them in later from the pact.")
                    .font(.subheadline).foregroundStyle(.secondary).pactCard()
            }
            ScrollView(.horizontal) {
                HStack(spacing: 14) {
                    ForEach(store.friends) { friend in
                        let on = picked.contains(friend.id)
                        Button {
                            if on { picked.remove(friend.id) } else { picked.insert(friend.id) }
                        } label: {
                            VStack(spacing: 6) {
                                Avatar(name: friend.member.name, url: friend.member.avatarUrl, size: 54)
                                    .overlay(Circle().strokeBorder(LinearGradient.pactSilver, lineWidth: on ? 3 : 0))
                                    .overlay(alignment: .bottomTrailing) {
                                        if on {
                                            Image(systemName: "checkmark.circle.fill").font(.title3)
                                                .foregroundStyle(.black, PactColor.silverPale)
                                        }
                                    }
                                Text(firstName(friend.member.name)).font(.caption.weight(.semibold))
                                    .foregroundStyle(on ? .primary : .secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        .sensoryFeedback(.selection, trigger: on)
                    }
                }
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
            Text("They each get a request to join. Grok joins the chat too.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

/// A sheet with a silver title, its fields, and one big button at the bottom.
struct SheetLayout<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let action: String
    let enabled: Bool
    let onAction: () -> Void
    @ViewBuilder let content: Content

    init(title: String, action: String, enabled: Bool, onAction: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.title = title
        self.action = action
        self.enabled = enabled
        self.onAction = onAction
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text(title).font(.system(size: 30, weight: .heavy)).silver()
                Spacer()
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)
                    .glassCircle()
            }
            content
            Spacer()
            Button(action, action: onAction).pactAction().disabled(!enabled)
        }
        .padding(24)
        .presentationBackground { AmbientBackdrop() }
        .presentationDetents([.medium, .large])
        .errorAlert()
    }
}

/// A labelled input on a frosted rounded field.
struct PactField<Field: View>: View {
    let label: String
    @ViewBuilder let field: Field

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            field
                .font(.body.weight(.medium))
                .padding(16)
                .pactWell(16)
        }
    }
}

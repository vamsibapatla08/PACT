import CircleProgrammableWalletSDK

/// What Circle's wallet setup screens offer. Without this the question picker is empty.
/// Colours and wording live in CircleTheme/, copied into the SDK by the Podfile.
final class CircleLayout: WalletSdkLayoutProvider {
    static let shared = CircleLayout()

    func securityQuestions() -> [SecurityQuestion] {
        [
            SecurityQuestion(title: "What city were you born in?", inputType: .text),
            SecurityQuestion(title: "What was your first pet's name?", inputType: .text),
            SecurityQuestion(title: "What was your first car?", inputType: .text),
            SecurityQuestion(title: "What street did you grow up on?", inputType: .text),
            SecurityQuestion(title: "What was your first school called?", inputType: .text),
            SecurityQuestion(title: "What is your best friend's first name?", inputType: .text),
            SecurityQuestion(title: "What is your favourite food?", inputType: .text),
            SecurityQuestion(title: "What date will you never forget?", inputType: .datePicker),
        ]
    }

    func securityQuestionsRequiredCount() -> Int { 2 }
}

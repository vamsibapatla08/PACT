import AVFoundation
import Observation
import Speech

/// Talk instead of type: listens on the mic and streams what you say as text, on the phone, with Apple's
/// speech recognition. ElevenLabs can replace the recogniser once its key is on Supabase.
@Observable
final class Dictation {
    var listening = false
    var failure: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))

    /// Starts listening. `onText` gets the whole transcript so far each time it changes.
    func start(onText: @escaping (String) -> Void) async {
        failure = nil
        guard await allowed() else {
            failure = "Turn on the microphone and speech recognition for Pact in Settings."
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            failure = "Speech recognition isn't available right now."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.request = request

            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            engine.prepare()
            try engine.start()
            listening = true

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                if let result { Task { @MainActor in onText(result.bestTranscription.formattedString) } }
                if error != nil || result?.isFinal == true { Task { @MainActor in self?.stop() } }
            }
        } catch {
            failure = "Couldn't start the microphone."
            stop()
        }
    }

    func stop() {
        guard listening || engine.isRunning else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func allowed() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}

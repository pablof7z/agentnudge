import AVFoundation
import Foundation
import Speech

private struct Transcript: Encodable {
    let text: String
    let locale: String
    let engine = "apple_speech"
}

private enum TranscriptionError: LocalizedError {
    case invalidArguments
    case speechUnavailable
    case unsupportedLocale(String)
    case emptyAudio

    var errorDescription: String? {
        switch self {
        case .invalidArguments:
            return "usage: agentnudge-stt <audio-file> <locale>"
        case .speechUnavailable:
            return "Apple on-device speech transcription is unavailable on this Mac"
        case let .unsupportedLocale(locale):
            return "Apple on-device speech transcription does not support locale \(locale)"
        case .emptyAudio:
            return "the recording did not contain transcribable audio"
        }
    }
}

@available(macOS 26.0, *)
private func transcribe(audioURL: URL, requestedLocale: Locale) async throws -> Transcript {
    guard SpeechTranscriber.isAvailable else {
        throw TranscriptionError.speechUnavailable
    }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
        throw TranscriptionError.unsupportedLocale(requestedLocale.identifier)
    }

    let transcriber = SpeechTranscriber(locale: locale, preset: .transcription)
    if let installation = try await AssetInventory.assetInstallationRequest(
        supporting: [transcriber]
    ) {
        try await installation.downloadAndInstall()
    }

    let audioFile = try AVAudioFile(forReading: audioURL)
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    async let transcript = transcriber.results.reduce(into: "") { text, result in
        text += String(result.text.characters)
    }

    if let lastSample = try await analyzer.analyzeSequence(from: audioFile) {
        try await analyzer.finalizeAndFinish(through: lastSample)
    } else {
        await analyzer.cancelAndFinishNow()
    }

    let text = try await transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
        throw TranscriptionError.emptyAudio
    }
    return Transcript(text: text, locale: locale.identifier)
}

@main
private struct AgentNudgeSTT {
    static func main() async {
        do {
            guard CommandLine.arguments.count == 3 else {
                throw TranscriptionError.invalidArguments
            }
            guard #available(macOS 26.0, *) else {
                throw TranscriptionError.speechUnavailable
            }
            let audioURL = URL(fileURLWithPath: CommandLine.arguments[1])
            let requestedLocale = Locale(identifier: CommandLine.arguments[2])
            let result = try await transcribe(audioURL: audioURL, requestedLocale: requestedLocale)
            let data = try JSONEncoder().encode(result)
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([0x0A]))
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            Foundation.exit(1)
        }
    }
}

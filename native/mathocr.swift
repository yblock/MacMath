// Command-line helper that reads math from an image with Apple's on-device model
// (Foundation Models image input, macOS 27+). The Electron main process runs it:
//
//   mathocr check           -> {"available": true} or {"available": false, "reason": "..."}
//   mathocr recognize FILE  -> {"latex": "..."} or {"error": "..."}
//
// It prints one line of JSON and exits 0, or 1 when the result is an error.
// The instructions match recognize.js, which explains how they were chosen.

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

let instructions = """
You transcribe mathematics from images into LaTeX.
Rules:
- Reply with only the LaTeX. No explanation, no Markdown, no $ or $$.
- Write words with normal spacing inside \\text{}, for example \\text{at least one head}. Never put spaces between the letters of a word.
- Use \\bar{x} for a letter with a bar over it, \\hat{y} for a hat.
- Keep every bracket, brace and bar exactly as shown.
- Copy exactly what is shown. Do not solve, simplify or add anything.
"""

func emit(_ object: [String: Any], failed: Bool = false) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(failed ? 1 : 0)
}

// nil when the model can read images on this Mac, otherwise why not
func unavailableReason() -> String? {
  #if canImport(FoundationModels)
  guard #available(macOS 27.0, *) else {
    return "Reading math from images needs macOS 27 or later."
  }
  let model = SystemLanguageModel.default
  switch model.availability {
  case .available:
    break
  case .unavailable(.deviceNotEligible):
    return "This Mac doesn't support Apple Intelligence."
  case .unavailable(.appleIntelligenceNotEnabled):
    return "Turn on Apple Intelligence in System Settings to read math from images."
  case .unavailable(.modelNotReady):
    return "Apple Intelligence is still downloading. Try again later."
  case .unavailable:
    return "Apple Intelligence isn't available right now."
  }
  if !model.capabilities.contains(.vision) {
    return "The on-device model on this Mac can't read images."
  }
  return nil
  #else
  return "MacMath's image helper was built without the Foundation Models framework."
  #endif
}

#if canImport(FoundationModels)
@available(macOS 27.0, *)
func recognize(_ url: URL) async throws -> String {
  let session = LanguageModelSession(instructions: instructions)
  let response = try await session.respond(options: GenerationOptions(samplingMode: .greedy)) {
    "Transcribe the math in this image as LaTeX."
    Attachment(imageURL: url)
  }
  return response.content
}
#endif

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "check":
  if let reason = unavailableReason() {
    emit(["available": false, "reason": reason])
  }
  emit(["available": true])

case "recognize" where args.count > 2:
  if let reason = unavailableReason() {
    emit(["error": reason], failed: true)
  }
  let url = URL(fileURLWithPath: args[2])
  guard FileManager.default.isReadableFile(atPath: url.path) else {
    emit(["error": "Couldn't read the image file."], failed: true)
  }
  #if canImport(FoundationModels)
  if #available(macOS 27.0, *) {
    Task {
      do {
        emit(["latex": try await recognize(url)])
      } catch {
        emit(["error": "The on-device model couldn't read the image: \(error.localizedDescription)"], failed: true)
      }
    }
    dispatchMain()
  }
  #endif
  emit(["error": "Reading math from images needs macOS 27 or later."], failed: true)

default:
  FileHandle.standardError.write(Data("usage: mathocr check | mathocr recognize <image>\n".utf8))
  exit(2)
}

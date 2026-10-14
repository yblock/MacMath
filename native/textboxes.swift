// MacMath's word-box helper: finds the words in an image with the Vision framework and prints
// each one's box, so recognize.js can tell italic words from upright ones. Vision models
// don't see that slant themselves.
// Usage: textboxes <image>  →  {"words":[{"text":"unc","x":109,"y":270,"width":71,"height":51}, …]}
// Boxes are in pixels from the top left. Prints {"error": …} and exits 1 when it can't read the image.

import Foundation
import ImageIO
import Vision

func emit(_ object: [String: Any], failed: Bool = false) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(failed ? 1 : 0)
}

let args = CommandLine.arguments
guard args.count > 1 else {
  FileHandle.standardError.write(Data("usage: textboxes <image>\n".utf8))
  exit(2)
}
// ImageIO keeps the real pixel size, whatever the file is named
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  emit(["error": "Couldn't read the image file."], failed: true)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
// Correction would turn abbreviations like "unc" into dictionary words
request.usesLanguageCorrection = false
do {
  try VNImageRequestHandler(cgImage: image).perform([request])
} catch {
  emit(["error": "Couldn't find text in the image: \(error.localizedDescription)"], failed: true)
}

let width = Double(image.width), height = Double(image.height)
var words: [[String: Any]] = []
for observation in request.results ?? [] {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let text = candidate.string
  text.enumerateSubstrings(in: text.startIndex..., options: .byWords) { word, range, _, _ in
    guard let word, let box = (try? candidate.boundingBox(for: range))?.boundingBox else { return }
    // Vision's boxes are normalized with the origin at the bottom left
    words.append([
      "text": word,
      "x": Int((box.minX * width).rounded()),
      "y": Int(((1 - box.maxY) * height).rounded()),
      "width": Int((box.width * width).rounded()),
      "height": Int((box.height * height).rounded())
    ])
  }
}
emit(["words": words])

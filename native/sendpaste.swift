// Posts a ⌘V keystroke to whatever app is in front, for MacMath's Insert (paste.js).
//
// A separate helper rather than AppleScript's `keystroke`: System Events would need the
// Automation permission on top of Accessibility, and macOS refuses it silently to an app
// without a usage description. Posting a CGEvent needs only the Accessibility permission
// MacMath already has, and the grant covers this helper because MacMath launches it.
//
// Exit status: 0 posted, 2 when MacMath is not trusted for Accessibility, 1 otherwise.

import ApplicationServices
import CoreGraphics
import Foundation

if !AXIsProcessTrusted() {
    FileHandle.standardError.write("not trusted for Accessibility\n".data(using: .utf8)!)
    exit(2)
}

let keyV: CGKeyCode = 0x09
guard let source = CGEventSource(stateID: .combinedSessionState),
      let down = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: true),
      let up = CGEvent(keyboardEventSource: source, virtualKey: keyV, keyDown: false) else {
    FileHandle.standardError.write("could not create keyboard events\n".data(using: .utf8)!)
    exit(1)
}
down.flags = .maskCommand
up.flags = .maskCommand
down.post(tap: .cghidEventTap)
usleep(20_000)
up.post(tap: .cghidEventTap)

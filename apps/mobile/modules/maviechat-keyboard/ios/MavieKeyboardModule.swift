import ExpoModulesCore
import UIKit

/// Keyboard commands for an iPad with a keyboard attached (M9). JavaScript says which ones are on
/// (`setCommands`), and each press comes back as `onKeyCommand` with the command's name.
///
/// - `return`: sends from the message box. JavaScript turns it on only while a message box has
///   the cursor, and it goes before typing (iOS 15's `wantsPriorityOverSystemBehavior`), so Return
///   sends while Shift-Return still starts a new line. The on-screen keyboard never sends key
///   commands, so it types as before.
/// - The rest are Open WebUI's web shortcuts: new chat, search, settings, the sidebar, and back to
///   the message box. The iPad lists them while ⌘ is held.
public class MavieKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MavieKeyboard")

    Events("onKeyCommand")

    OnCreate {
      DispatchQueue.main.async { [weak self] in
        KeyCommandHub.shared.deliver = { name in
          self?.sendEvent("onKeyCommand", ["name": name])
        }
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        KeyCommandHub.shared.deliver = nil
        KeyCommandHub.shared.setCommands([])
      }
    }

    /// The commands that are on now, by name; any others are taken off.
    AsyncFunction("setCommands") { (names: [String]) in
      KeyCommandHub.shared.setCommands(names)
    }.runOnQueue(.main)
  }
}

/// Keeps the commands on the app's root view controller, which every screen's responder chain
/// reaches (a presented screen's chain goes on to the controller that presented it).
final class KeyCommandHub {
  static let shared = KeyCommandHub()

  var deliver: ((String) -> Void)?
  private var added: [UIKeyCommand] = []
  private weak var host: UIViewController?

  private struct Spec {
    let input: String
    let modifiers: UIKeyModifierFlags
    let title: String
    let beforeTyping: Bool
  }

  private static let catalog: [String: Spec] = [
    "return": Spec(input: "\r", modifiers: [], title: "Send Message", beforeTyping: true),
    "newChat": Spec(input: "o", modifiers: [.command, .shift], title: "New Chat", beforeTyping: false),
    "search": Spec(input: "k", modifiers: [.command], title: "Search", beforeTyping: false),
    "settings": Spec(input: ".", modifiers: [.command], title: "Settings", beforeTyping: false),
    "sidebar": Spec(input: "s", modifiers: [.command, .shift], title: "Show or Hide Sidebar", beforeTyping: false),
    "focusInput": Spec(input: UIKeyCommand.inputEscape, modifiers: [.shift], title: "Go to Message Box", beforeTyping: false),
  ]

  /// Takes off the commands that were on and puts on these. Main thread only.
  func setCommands(_ names: [String]) {
    if let host = host {
      for command in added {
        host.removeKeyCommand(command)
      }
    }
    added = []
    guard let root = KeyCommandHub.rootViewController() else {
      return
    }
    host = root
    for name in names {
      guard let spec = KeyCommandHub.catalog[name] else {
        continue
      }
      let command = UIKeyCommand(
        title: spec.title,
        action: #selector(UIViewController.maviechatKeyCommand(_:)),
        input: spec.input,
        modifierFlags: spec.modifiers,
        propertyList: name
      )
      command.wantsPriorityOverSystemBehavior = spec.beforeTyping
      root.addKeyCommand(command)
      added.append(command)
    }
  }

  private static func rootViewController() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let windows = scenes.flatMap { $0.windows }
    let window = windows.first(where: { $0.isKeyWindow }) ?? windows.first
    return window?.rootViewController
  }
}

extension UIViewController {
  /// Every command above lands here, in whichever view controller of the chain gets it first.
  @objc func maviechatKeyCommand(_ sender: UIKeyCommand) {
    guard let name = sender.propertyList as? String else {
      return
    }
    // While a word is still being composed (Chinese, Japanese, Korean…), Return finishes it
    // instead of sending, as it would without this command.
    if name == "return", let typing = UIResponder.maviechatFirstResponder() as? UITextInput, typing.markedTextRange != nil {
      typing.unmarkText()
      return
    }
    KeyCommandHub.shared.deliver?(name)
  }
}

extension UIResponder {
  private static weak var maviechatFound: UIResponder?

  /// The responder that has the keyboard now (asked by sending an action to the first responder).
  static func maviechatFirstResponder() -> UIResponder? {
    maviechatFound = nil
    UIApplication.shared.sendAction(#selector(UIResponder.maviechatTakeFirstResponder(_:)), to: nil, from: nil, for: nil)
    return maviechatFound
  }

  @objc func maviechatTakeFirstResponder(_ sender: Any?) {
    UIResponder.maviechatFound = self
  }
}

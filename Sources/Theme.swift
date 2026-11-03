import AppKit

enum Theme {
    static let paper = NSColor(calibratedWhite: 0.96, alpha: 1)
    static let surface = NSColor.white
    static let ink = NSColor.labelColor
    static let clay = NSColor.systemBlue
    static let muted = NSColor.secondaryLabelColor
    static func heading(_ size: CGFloat) -> NSFont {
        NSFont.systemFont(ofSize: size, weight: .semibold)
    }
    static func style(_ button: NSButton, prominent: Bool = false) {
        button.contentTintColor = prominent ? .white : clay
        if prominent { button.bezelColor = clay }
    }
    static func field(_ field: NSTextField) {
        field.textColor = ink
        if field.isEditable { field.backgroundColor = surface }
    }
}

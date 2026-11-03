import AppKit
import Foundation
import ImageIO

let arguments = Array(CommandLine.arguments.dropFirst())
if let command = arguments.first, ["--inspect", "--export-original", "--export-preview"].contains(command) {
    do {
        let count = command == "--inspect" ? 2 : 3
        guard arguments.count == count else { throw ViewerError.invalid("用法：--inspect 输入.sgd | --export-original 输入.sgd 输出.tif | --export-preview 输入.sgd 输出.png") }
        let url = URL(fileURLWithPath: arguments[1])
        if arguments.count == 3 {
            guard url.standardizedFileURL != URL(fileURLWithPath: arguments[2]).standardizedFileURL else {
                throw ViewerError.invalid("导出文件不能覆盖输入 SGD。")
            }
        }
        let gel = try GelImage(url: url)
        if command == "--inspect" {
            let info: [String: Any] = ["width": gel.width, "height": gel.height,
                "storageBits": 16, "minimum": gel.minimum, "maximum": gel.maximum,
                "stream": gel.streamPath, "autoLow": gel.autoLevels.0, "autoHigh": gel.autoLevels.1,
                "capture": gel.capture]
            let data = try JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted, .sortedKeys])
            print(String(decoding: data, as: UTF8.self))
        } else if command == "--export-original" {
            try GelImage.save(gel.originalCGImage(), to: URL(fileURLWithPath: arguments[2]), type: .tiff)
        } else {
            try GelImage.save(gel.preview(low: gel.autoLevels.0, high: gel.autoLevels.1, gamma: 1,
                                         inverted: false, flipY: false, turns: 0),
                              to: URL(fileURLWithPath: arguments[2]), type: .png)
        }
    } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8)); exit(1)
    }
} else {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    delegate.startupURLs = arguments.filter { !$0.hasPrefix("-") }.map { URL(fileURLWithPath: $0) }
    app.delegate = delegate
    app.run()
}

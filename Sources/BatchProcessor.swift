import Foundation
import CoreGraphics
import UniformTypeIdentifiers

struct DisplaySettings {
    var low = 0
    var high = 4095
    var gamma = 1.0
    var inverted = false
    var flipY = false
    var angle = 0.0
}

struct BatchOptions {
    enum Format: Int { case png, originalTIFF, both }
    enum Levels: Int { case automatic, current, fullRange }
    var format: Format = .png
    var levels: Levels = .automatic
    var display = DisplaySettings()
}

final class BatchCancellation {
    private let lock = NSLock()
    private var cancelled = false
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }
}

struct BatchRecord {
    let input: URL
    var outputs: [URL] = []
    var status = "成功"
    var message = ""
    var low: Int?
    var high: Int?
}

struct BatchResult {
    let directory: URL
    let records: [BatchRecord]
    let reportError: String?
    var succeeded: Int { records.filter { $0.status == "成功" }.count }
    var failed: Int { records.filter { $0.status == "失败" }.count }
    var cancelled: Int { records.filter { $0.status == "已取消" }.count }
}

enum BatchProcessor {
    static func run(inputs: [URL], parent: URL, options: BatchOptions, cancellation: BatchCancellation,
                    progress: (Int, String) -> Void) throws -> BatchResult {
        guard !inputs.isEmpty else { throw ViewerError.invalid("请先选择 SGD 文件。") }
        guard options.display.angle.isFinite, options.display.gamma.isFinite else { throw ViewerError.invalid("旋转角度和 Gamma 必须是有效数值。") }
        let fm = FileManager.default
        let formatter = DateFormatter(); formatter.dateFormat = "yyyyMMdd_HHmmss"
        let stem = "SGD批量_" + formatter.string(from: Date())
        var directory = parent.appendingPathComponent(stem, isDirectory: true)
        var suffix = 1
        while true {
            do { try fm.createDirectory(at: directory, withIntermediateDirectories: false); break }
            catch let error as CocoaError where error.code == .fileWriteFileExists {
                suffix += 1; directory = parent.appendingPathComponent(stem + "_\(suffix)", isDirectory: true)
            }
        }
        var records: [BatchRecord] = [], reserved = Set<String>()
        for (index, input) in inputs.enumerated() {
            if cancellation.isCancelled {
                var record = BatchRecord(input: input); record.status = "已取消"; records.append(record)
                continue
            }
            progress(index, "正在处理 \(index + 1)/\(inputs.count)：\(input.lastPathComponent)")
            let record: BatchRecord = autoreleasepool {
                var record = BatchRecord(input: input)
                do {
                    let gel = try GelImage(url: input)
                    var settings = options.display
                    switch options.levels {
                    case .automatic: (settings.low, settings.high) = gel.autoLevels
                    case .current: break
                    case .fullRange: settings.low = gel.minimum; settings.high = max(gel.minimum + 1, gel.maximum)
                    }
                    record.low = settings.low; record.high = settings.high
                    let originalStem = input.deletingPathExtension().lastPathComponent
                    var base = originalStem, duplicate = 1
                    while !reserved.insert(base.lowercased()).inserted {
                        duplicate += 1; base = originalStem + "_\(duplicate)"
                    }
                    func write(_ image: CGImage, name: String, tiff: Bool) throws {
                        let destination = directory.appendingPathComponent(name)
                        let temporary = directory.appendingPathComponent(UUID().uuidString + (tiff ? ".tif" : ".png"))
                        defer { try? fm.removeItem(at: temporary) }
                        try GelImage.save(image, to: temporary, type: tiff ? .tiff : .png)
                        // moveItem refuses overwrites; each completed image appears atomically.
                        try fm.moveItem(at: temporary, to: destination)
                        record.outputs.append(destination)
                    }
                    if options.format != .originalTIFF {
                        let image = try gel.preview(low: settings.low, high: settings.high, gamma: settings.gamma,
                                                    inverted: settings.inverted, flipY: settings.flipY, angle: settings.angle)
                        try write(image, name: base + "_preview.png", tiff: false)
                    }
                    if options.format != .png { try write(gel.originalCGImage(), name: base + "_raw16.tif", tiff: true) }
                } catch {
                    record.status = "失败"; record.message = error.localizedDescription
                }
                return record
            }
            records.append(record)
            progress(index + 1, "\(record.status)：\(input.lastPathComponent)")
        }
        func csv(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
        var lines = ["输入文件,状态,导出文件,说明,PNG旋转角度,PNG黑场,PNG白场,PNGGamma,PNG反相,PNG上下翻转"]
        for record in records {
            let png = record.outputs.contains { $0.pathExtension == "png" }
            let fields = [record.input.path, record.status, record.outputs.map(\.lastPathComponent).joined(separator: "; "),
                          record.message, png ? String(options.display.angle) : "", png ? String(record.low ?? 0) : "",
                          png ? String(record.high ?? 0) : "", png ? String(options.display.gamma) : "",
                          png ? String(options.display.inverted) : "", png ? String(options.display.flipY) : ""]
            lines.append(fields.map(csv).joined(separator: ","))
        }
        var reportError: String?
        do { try ("\u{feff}" + lines.joined(separator: "\r\n") + "\r\n").write(to: directory.appendingPathComponent("处理结果.csv"), atomically: true, encoding: .utf8) }
        catch { reportError = error.localizedDescription }
        return BatchResult(directory: directory, records: records, reportError: reportError)
    }
}

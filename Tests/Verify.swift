import Foundation
import CoreGraphics
import ImageIO
import CryptoKit

@main enum Verify {
    static var passed = 0
    static func check(_ condition: @autoclosure () -> Bool, _ name: String) throws {
        guard condition() else { throw ViewerError.invalid("FAIL: " + name) }
        passed += 1; print("PASS: " + name)
    }
    static func rejects(_ bytes: Data, _ name: String) throws {
        var rejected = false
        do { _ = try CompoundFile(data: bytes) } catch { rejected = true }
        try check(rejected, name)
    }
    static func values(_ image: CGImage) throws -> [UInt16] {
        guard image.bitsPerComponent == 16, image.bitsPerPixel == 16,
              let data = image.dataProvider?.data else { throw ViewerError.invalid("Not 16-bit grayscale") }
        let raw = data as Data
        var output: [UInt16] = []
        let little = image.bitmapInfo.intersection(.byteOrderMask) == .byteOrder16Little
        for y in 0..<image.height {
            for x in 0..<image.width {
                let i = y * image.bytesPerRow + x * 2
                output.append(little ? UInt16(raw[i]) | UInt16(raw[i+1]) << 8 : UInt16(raw[i]) << 8 | UInt16(raw[i+1]))
            }
        }
        return output
    }
    static func bytes(_ image: CGImage) -> [UInt8] {
        let data = image.dataProvider!.data! as Data
        return (0..<image.height).flatMap { y in Array(data[y * image.bytesPerRow..<y * image.bytesPerRow + image.width]) }
    }
    static func main() throws {
        let fixture = URL(fileURLWithPath: CommandLine.arguments[1])
        let source = CommandLine.arguments.count > 2 ? URL(fileURLWithPath: CommandLine.arguments[2]) : fixture
        let gel = try GelImage(url: fixture)
        try check(gel.width == 2 && gel.height == 3 && gel.samples == [0,100,200,300,400,500], "mini-stream pixels and dimensions")
        try check(gel.capture.contains("0.500 seconds"), "mini-stream capture metadata")
        let preview = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, turns: 0)
        try check(bytes(preview) == [0,51,102,153,204,255], "display levels")
        let inverse = try gel.preview(low: 0, high: 500, gamma: 1, inverted: true, flipY: false, turns: 0)
        try check(bytes(inverse) == [255,204,153,102,51,0], "invert")
        let flipped = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: true, turns: 0)
        try check(bytes(flipped) == [204,255,102,153,0,51], "vertical flip")
        let rotated = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, turns: 1)
        try check(rotated.width == 3 && rotated.height == 2 && bytes(rotated) == [204,102,0,255,153,51], "clockwise rotation")
        let gamma = try gel.preview(low: 0, high: 500, gamma: 2, inverted: false, flipY: false, turns: 0)
        try check(bytes(gamma)[2] == 161, "gamma mapping")
        let angle90 = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, angle: 90)
        try check(bytes(angle90) == bytes(rotated), "angle 90 matches exact pixel permutation")
        let negative = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, angle: -90)
        try check(bytes(negative) == [51,153,255,0,102,204], "negative angle rotates counterclockwise")
        let angle360 = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, angle: 360)
        try check(bytes(angle360) == bytes(preview), "full turn preserves exact pixels")
        let free = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, angle: 30)
        try check(free.width == 4 && free.height == 4 && bytes(free)[5] == 83 && bytes(free)[10] == 172, "free rotation expanded bounds and bilinear values")
        let freeInverse = try gel.preview(low: 0, high: 500, gamma: 1, inverted: true, flipY: false, angle: 30)
        try check(bytes(free)[0] == 0 && bytes(freeInverse)[0] == 255, "rotation background follows inversion")
        var invalidAngleRejected = false
        do { _ = try gel.preview(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, angle: .nan) }
        catch { invalidAngleRejected = true }
        try check(invalidAngleRejected, "non-finite rotation rejected")
        let real = try GelImage(url: source)
        if CommandLine.arguments.count > 2 {
            try check(real.width == 1392 && real.height == 1040 && real.maximum == 4095, "reference SGD dimensions and intensity")
            if real.capture.contains("SYNTHETIC PUBLIC FIXTURE") {
                var expected = Data(); expected.reserveCapacity(real.width * real.height * 2)
                for y in 0..<1040 { for x in 0..<1392 {
                    var value = 100 + (x * 17 + y * 31) % 37
                    for lane in [170, 380, 590, 800, 1010, 1220] {
                        if abs(Double(x - lane) - 0.04 * (Double(y) - 520)) < 22 {
                            for band in [180, 340, 520, 700, 860] {
                                value += Int(2400 * exp(-pow(Double(y - band) / 9, 2)))
                            }
                        }
                    }
                    if x == 0 && y == 0 { value = 0 }
                    if x == 1391 && y == 1039 { value = 4095 }
                    value = min(4095, value)
                    expected.append(UInt8(value & 255)); expected.append(UInt8(value >> 8))
                } }
                try check(real.pixelBytes == expected, "public synthetic reference: every pixel matches independent expected values")
            } else {
                try check(SHA256.hash(data: real.pixelBytes).description.hasSuffix("9095d2f4fb0d3e0f60408ee25a8ee8628edaf673f42e415921f621a7c0c1097a"), "local retained reference pixels match source hash")
            }
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let tiffURL = directory.appendingPathComponent("raw.tif")
        try GelImage.save(real.originalCGImage(), to: tiffURL, type: .tiff)
        let reader = CGImageSourceCreateWithURL(tiffURL as CFURL, nil)!
        let tiff = CGImageSourceCreateImageAtIndex(reader, 0, nil)!
        try check(tiff.width == real.width && tiff.height == real.height, "TIFF dimensions")
        let recovered = try values(tiff)
        try check(recovered == real.samples, "TIFF round trip: every 16-bit pixel equals source")
        let pngURL = directory.appendingPathComponent("preview.png")
        let realPreview = try real.preview(low: real.autoLevels.0, high: real.autoLevels.1, gamma: 1, inverted: false, flipY: false, turns: 0)
        try GelImage.save(realPreview, to: pngURL, type: .png)
        let png = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(pngURL as CFURL, nil)!, 0, nil)!
        try check(png.bitsPerComponent == 8 && bytes(png) == bytes(realPreview), "PNG round trip")
        var data = try Data(contentsOf: fixture)
        try rejects(Data(data.prefix(100)), "truncated header rejected")
        var bad = data; bad[0] = 0
        try rejects(bad, "incorrect signature rejected")
        bad = data; bad[1024 + 120] = 255; bad[1024 + 127] = 127
        try rejects(bad, "oversized stream rejected")
        // FAT sector is #2, directory sector #0: point #0 to itself.
        bad = data; for i in 1536..<1540 { bad[i] = 0 }
        try rejects(bad, "cyclic FAT chain rejected")
        bad = data; for i in 76..<80 { bad[i] = 255 }
        try rejects(bad, "invalid FAT index rejected")
        // Break a directory child index.
        bad = data; for i in 588..<592 { bad[i] = 0 }
        try rejects(bad, "cyclic directory rejected")
        // Pixel header has an unsupported version; outer CFB remains valid.
        data[2560] = 9
        let unknown = directory.appendingPathComponent("unknown.sgd")
        try data.write(to: unknown)
        var rejected = false
        do { _ = try GelImage(url: unknown) } catch { rejected = true }
        try check(rejected, "unsupported pixel schema rejected")
        let firstFolder = directory.appendingPathComponent("first"), secondFolder = directory.appendingPathComponent("second")
        try FileManager.default.createDirectory(at: firstFolder, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: secondFolder, withIntermediateDirectories: true)
        let first = firstFolder.appendingPathComponent("同名.sgd"), second = secondFolder.appendingPathComponent("同名.sgd")
        try FileManager.default.copyItem(at: fixture, to: first)
        try FileManager.default.copyItem(at: fixture, to: second)
        let sourceHash = SHA256.hash(data: try Data(contentsOf: first))
        let options = BatchOptions(format: .both, levels: .current,
                                   display: DisplaySettings(low: 0, high: 500, gamma: 1, inverted: false, flipY: false, angle: 90))
        let batch = try BatchProcessor.run(inputs: [first, unknown, second], parent: directory, options: options,
                                           cancellation: BatchCancellation()) { _, _ in }
        try check(batch.succeeded == 2 && batch.failed == 1, "batch continues after corrupt SGD")
        try check(batch.records[0].outputs.count == 2 && batch.records[2].outputs.count == 2, "batch exports both requested formats")
        try check(Set(batch.records.flatMap(\.outputs)).count == 4, "duplicate input basenames get distinct outputs")
        let batchPNG = batch.records[0].outputs.first { $0.pathExtension == "png" }!
        let batchImage = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(batchPNG as CFURL, nil)!, 0, nil)!
        try check(bytes(batchImage) == bytes(rotated), "batch PNG applies common rotation and levels")
        let batchTIFF = batch.records[0].outputs.first { $0.pathExtension == "tif" }!
        let originalBatch = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(batchTIFF as CFURL, nil)!, 0, nil)!
        let originalValues = try values(originalBatch)
        try check(originalBatch.width == 2 && originalBatch.height == 3 && originalValues == gel.samples, "batch raw TIFF retains original orientation and values")
        let afterHash = SHA256.hash(data: try Data(contentsOf: first))
        try check(afterHash == sourceHash, "batch leaves source file unchanged")
        let report = try String(contentsOf: batch.directory.appendingPathComponent("处理结果.csv"), encoding: .utf8)
        try check(report.contains("失败") && report.contains("同名_2_preview.png") && report.contains("90.0"), "batch report records failures, outputs and rotation")
        let automatic = try BatchProcessor.run(inputs: [first], parent: directory,
            options: BatchOptions(format: .png, levels: .automatic, display: DisplaySettings()), cancellation: BatchCancellation()) { _, _ in }
        try check(automatic.records[0].low == 0 && automatic.records[0].high == 500 && automatic.records[0].outputs.count == 1, "batch per-image automatic levels and PNG-only export")
        try check(automatic.directory != batch.directory, "repeated batch creates separate output folder")
        let token = BatchCancellation(); token.cancel()
        let cancelled = try BatchProcessor.run(inputs: [first, second], parent: directory, options: options, cancellation: token) { _, _ in }
        try check(cancelled.cancelled == 2 && cancelled.records.flatMap(\.outputs).isEmpty, "cancelled batch skips pending files")
        print("\(passed) checks passed")
        print("Reference pixel SHA-256: \(SHA256.hash(data: real.pixelBytes))")
    }
}

import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct GelImage {
    let width: Int
    let height: Int
    let samples: [UInt16]
    let pixelBytes: Data
    let capture: String
    let streamPath: String
    let histogram: [Int]
    let minimum: Int
    let maximum: Int

    init(url: URL) throws {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 256 * 1024 * 1024 else { throw ViewerError.invalid("当前版本支持 256 MB 以内的 SGD 文件。") }
        let compound = try CompoundFile(data: Data(contentsOf: url, options: .mappedIfSafe))
        let preferred = "/Detector/GeneSnap/RawData/PixelData"
        let candidates = compound.streams.keys.filter { $0.hasSuffix("/RawData/PixelData") }.sorted()
        let path: String
        if compound.streams[preferred] != nil { path = preferred }
        else if candidates.count == 1 { path = candidates[0] }
        else { throw ViewerError.invalid("未找到唯一的原始胶图。当前支持 GeneSnap RawData/PixelData 格式。") }
        let data = try compound.stream(path)
        guard data.count >= 26, try data.u16(0) == 1,
              try data.u32(10) == 1, try data.u32(14) == 1,
              try data.u32(18) == 1, try data.u32(22) == 4 else {
            throw ViewerError.invalid("此 SGD 的像素编码尚未支持。请提供样例以增加兼容性。")
        }
        let w = Int(try data.u32(2)), h = Int(try data.u32(6))
        guard w > 0, h > 0, w <= 20000, h <= 20000,
              w * h <= 50_000_000, data.count == 26 + w * h * 2 else {
            throw ViewerError.invalid("图像尺寸与像素数据长度不一致；文件可能损坏或属于其他 SGD 版本。")
        }
        width = w; height = h; streamPath = path
        pixelBytes = data.subdata(in: 26..<data.count)
        var pixels = [UInt16](); pixels.reserveCapacity(w * h)
        var bins = [Int](repeating: 0, count: 65536)
        for offset in stride(from: 26, to: data.count, by: 2) {
            let value = try data.u16(offset); pixels.append(value); bins[Int(value)] += 1
        }
        samples = pixels; histogram = bins
        minimum = bins.firstIndex(where: { $0 > 0 }) ?? 0
        maximum = bins.lastIndex(where: { $0 > 0 }) ?? 0
        let capturePath = String(path.dropLast("PixelData".count)) + "Capture"
        if compound.streams[capturePath] != nil {
            let rawCapture = try compound.stream(capturePath)
            // Capture is an MFC serialization. Only expose the identifiable text, not binary lengths.
            let text = String(data: rawCapture, encoding: .isoLatin1) ?? ""
            if let start = text.range(of: "GeneSnap version") {
                capture = String(text[start.lowerBound...]).trimmingCharacters(in: .controlCharacters)
            } else { capture = "未识别到可读采集记录。" }
        } else { capture = "文件中没有采集记录。" }
    }

    func percentile(_ fraction: Double) -> Int {
        let target = max(1, Int(ceil(Double(samples.count) * fraction)))
        var cumulative = 0
        for (value, count) in histogram.enumerated() {
            cumulative += count
            if cumulative >= target { return value }
        }
        return maximum
    }

    var autoLevels: (Int, Int) {
        let low = percentile(0.005), high = percentile(0.995)
        return (low, max(low + 1, high))
    }

    func originalCGImage() throws -> CGImage {
        guard let provider = CGDataProvider(data: pixelBytes as CFData),
              let image = CGImage(width: width, height: height, bitsPerComponent: 16, bitsPerPixel: 16,
                                  bytesPerRow: width * 2, space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue).union(.byteOrder16Little),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else {
            throw ViewerError.invalid("无法创建 16 位原始图像。")
        }
        return image
    }

    func preview(low: Int, high: Int, gamma: Double, inverted: Bool, flipY: Bool, turns: Int) throws -> CGImage {
        try preview(low: low, high: high, gamma: gamma, inverted: inverted, flipY: flipY, angle: Double(turns % 4) * 90)
    }

    func preview(low: Int, high: Int, gamma: Double, inverted: Bool, flipY: Bool, angle: Double) throws -> CGImage {
        guard gamma.isFinite, angle.isFinite else { throw ViewerError.invalid("旋转角度和 Gamma 必须是有效数值。") }
        let high = max(low + 1, high), gamma = max(0.1, gamma)
        var lookup = [UInt8](repeating: 0, count: 65536)
        for value in 0..<65536 {
            let scaled = min(1, max(0, Double(value - low) / Double(high - low)))
            let level = Int((pow(scaled, 1 / gamma) * 255).rounded())
            lookup[value] = UInt8(inverted ? 255 - level : level)
        }
        let normalized = ((angle.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360)
        let quarter = (normalized / 90).rounded()
        if abs(normalized - quarter * 90) > 0.00000001 {
            return try rotatedPreview(lookup: lookup, flipY: flipY, angle: normalized, background: inverted ? 255 : 0)
        }
        // Right-angle rotations only permute pixels; no interpolation or loss.
        let rotation = Int(quarter) % 4
        let outWidth = rotation % 2 == 0 ? width : height
        let outHeight = rotation % 2 == 0 ? height : width
        var output = [UInt8](repeating: 0, count: samples.count)
        for y in 0..<height {
            let sy = flipY ? height - 1 - y : y
            for x in 0..<width {
                let dx: Int, dy: Int
                switch rotation {
                case 1: dx = height - 1 - y; dy = x
                case 2: dx = width - 1 - x; dy = height - 1 - y
                case 3: dx = y; dy = width - 1 - x
                default: dx = x; dy = y
                }
                output[dy * outWidth + dx] = lookup[Int(samples[sy * width + x])]
            }
        }
        return try Self.grayPreview(output, width: outWidth, height: outHeight)
    }

    private func rotatedPreview(lookup: [UInt8], flipY: Bool, angle: Double, background: UInt8) throws -> CGImage {
        let radians = angle * .pi / 180, cosine = cos(radians), sine = sin(radians)
        let outWidth = Int(ceil(abs(Double(width) * cosine) + abs(Double(height) * sine)))
        let outHeight = Int(ceil(abs(Double(width) * sine) + abs(Double(height) * cosine)))
        guard outWidth * outHeight <= 120_000_000 else { throw ViewerError.invalid("旋转后的图像过大。") }
        var output = [UInt8](repeating: background, count: outWidth * outHeight)
        func value(_ x: Int, _ y: Int) -> Double {
            let sy = flipY ? height - 1 - y : y
            return Double(lookup[Int(samples[sy * width + x])])
        }
        for y in 0..<outHeight {
            for x in 0..<outWidth {
                let dx = Double(x) + 0.5 - Double(outWidth) / 2
                let dy = Double(y) + 0.5 - Double(outHeight) / 2
                let sx = cosine * dx + sine * dy + Double(width) / 2 - 0.5
                let sy = -sine * dx + cosine * dy + Double(height) / 2 - 0.5
                guard sx >= -0.5, sy >= -0.5, sx < Double(width) - 0.5, sy < Double(height) - 0.5 else { continue }
                let px = min(Double(width - 1), max(0, sx)), py = min(Double(height - 1), max(0, sy))
                let x0 = Int(floor(px)), y0 = Int(floor(py)), x1 = min(width - 1, x0 + 1), y1 = min(height - 1, y0 + 1)
                let fx = px - Double(x0), fy = py - Double(y0)
                let top = value(x0, y0) * (1 - fx) + value(x1, y0) * fx
                let bottom = value(x0, y1) * (1 - fx) + value(x1, y1) * fx
                output[y * outWidth + x] = UInt8(min(255, max(0, (top * (1 - fy) + bottom * fy).rounded())))
            }
        }
        return try Self.grayPreview(output, width: outWidth, height: outHeight)
    }

    private static func grayPreview(_ output: [UInt8], width: Int, height: Int) throws -> CGImage {
        guard let provider = CGDataProvider(data: Data(output) as CFData),
              let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8,
                                  bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else {
            throw ViewerError.invalid("无法创建预览图像。")
        }
        return image
    }

    static func save(_ image: CGImage, to url: URL, type: UTType) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil) else {
            throw ViewerError.invalid("无法写入导出文件。")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw ViewerError.invalid("图像导出失败。") }
    }
}

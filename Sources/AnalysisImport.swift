import Foundation
import CoreGraphics
import ImageIO
import CryptoKit

struct AnalysisChannel {
    let name: String
    let width: Int
    let height: Int
    let bitDepth: Int
    let samples: [UInt16]
    let sourceHash: String
    let source: String
    var sourceInfo: [String: String] = [:]
    var json: [String: Any] {
        var bytes = Data(); bytes.reserveCapacity(samples.count * 2)
        for value in samples { bytes.append(UInt8(value & 255)); bytes.append(UInt8(value >> 8)) }
        return ["id": UUID().uuidString, "name": name, "width": width, "height": height,
                "bitDepth": bitDepth, "raw": bytes.base64EncodedString(), "source": source,
                "sourceInfo": sourceInfo, "sourceHash": sourceHash, "rawHash": Self.hash(bytes), "encoding": "uint16le"]
    }
    static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
}

enum AnalysisImport {
    static let pixelLimit = 20_000_000
    static func read(_ url: URL) throws -> [AnalysisChannel] {
        let attributes = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
        let size = attributes.fileSize ?? 0
        guard size <= 256 * 1024 * 1024 else { throw ViewerError.invalid("文件不能超过 256 MB。") }
        let hash = AnalysisChannel.hash(try Data(contentsOf: url, options: .mappedIfSafe))
        var info = ["format": url.pathExtension.uppercased(), "fileBytes": String(size)]
        if let modified = attributes.contentModificationDate { info["modified"] = ISO8601DateFormatter().string(from: modified) }
        if url.pathExtension.lowercased() == "sgd" {
            let gel = try GelImage(url: url)
            guard gel.samples.count <= pixelLimit else { throw ViewerError.invalid("分析通道最多支持 2000 万像素。") }
            info["capture"] = gel.capture; info["stream"] = gel.streamPath; info["pages"] = "1"
            return [AnalysisChannel(name: url.deletingPathExtension().lastPathComponent, width: gel.width,
                height: gel.height, bitDepth: 16, samples: gel.samples, sourceHash: hash, source: url.lastPathComponent, sourceInfo: info)]
        }
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { throw ViewerError.invalid("无法解码图像。") }
        let pages = CGImageSourceGetCount(source)
        guard pages > 0, pages <= 8 else { throw ViewerError.invalid("最多支持 8 页 / 8 通道图像。") }
        info["pages"] = String(pages)
        var result: [AnalysisChannel] = []
        for page in 0..<pages {
            guard let image = CGImageSourceCreateImageAtIndex(source, page, [kCGImageSourceShouldCache: false] as CFDictionary) else {
                throw ViewerError.invalid("无法读取第 \(page + 1) 页。")
            }
            let suffix = pages > 1 ? " · 页\(page + 1)" : ""
            result += try decode(image, name: url.deletingPathExtension().lastPathComponent + suffix,
                                 source: url.lastPathComponent, sourceHash: hash)
        }
        guard result.count <= 8, result.reduce(0, { $0 + $1.samples.count }) <= 40_000_000 else {
            throw ViewerError.invalid("项目最多 8 个通道、合计 4000 万像素。")
        }
        for i in result.indices { result[i].sourceInfo = info }
        return result
    }
    static func decode(_ image: CGImage, name: String, source: String, sourceHash: String) throws -> [AnalysisChannel] {
        let w = image.width, h = image.height, bits = image.bitsPerComponent
        guard w > 0, h > 0, w * h <= pixelLimit, [8,16].contains(bits),
              !image.bitmapInfo.contains(.floatComponents), let data = image.dataProvider?.data else {
            throw ViewerError.invalid("仅支持 8 / 16 位整数图像，每通道最多 2000 万像素。")
        }
        let model = image.colorSpace?.model
        guard model == .monochrome || model == .rgb else {
            throw ViewerError.invalid("分析支持灰度或 RGB 图像。请将索引色 / CMYK 转为整数灰度 TIFF。")
        }
        let components = image.bitsPerPixel / bits, channels = model == .rgb ? 3 : 1
        let alpha = image.alphaInfo
        let first = alpha == .first || alpha == .premultipliedFirst || alpha == .noneSkipFirst
        let last = alpha == .last || alpha == .premultipliedLast || alpha == .noneSkipLast
        guard components == channels || (components == channels + 1 && (first || last)) else {
            throw ViewerError.invalid("不支持此图像的通道布局。")
        }
        let alphaPresent = [.first,.last,.premultipliedFirst,.premultipliedLast].contains(alpha)
        let order = image.bitmapInfo.rawValue & CGBitmapInfo.byteOrderMask.rawValue
        let little16 = order == CGBitmapInfo.byteOrder16Little.rawValue
        let reverse8 = bits == 8 && components == 4 && order == CGBitmapInfo.byteOrder32Little.rawValue
        let bytes = data as Data, step = bits / 8
        guard bytes.count >= image.bytesPerRow * h else { throw ViewerError.invalid("像素缓冲区不完整。") }
        var arrays = Array(repeating: [UInt16](), count: channels)
        for c in 0..<channels { arrays[c].reserveCapacity(w * h) }
        func value(_ row: Int, _ x: Int, _ logical: Int) -> UInt16 {
            let comp = reverse8 ? components - logical - 1 : logical
            let offset = row * image.bytesPerRow + x * components * step + comp * step
            if bits == 8 { return UInt16(bytes[offset]) }
            return little16 ? UInt16(bytes[offset]) | UInt16(bytes[offset+1]) << 8 : UInt16(bytes[offset]) << 8 | UInt16(bytes[offset+1])
        }
        for y in 0..<h { for x in 0..<w {
            if alphaPresent {
                let a = value(y,x,first ? 0 : components-1)
                guard a == (bits == 8 ? 255 : 65535) else { throw ViewerError.invalid("定量分析不接收半透明像素；请导出不含透明度的原始 TIFF。") }
            }
            for c in 0..<channels { arrays[c].append(value(y,x,c + (first ? 1 : 0))) }
        } }
        return arrays.enumerated().map { c, pixels in AnalysisChannel(name: name + (channels == 3 ? " · \(["R","G","B"][c])" : ""),
            width: w, height: h, bitDepth: bits, samples: pixels, sourceHash: sourceHash, source: source) }
    }
}

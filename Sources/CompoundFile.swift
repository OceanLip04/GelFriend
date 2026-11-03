import Foundation

enum ViewerError: LocalizedError {
    case invalid(String)
    var errorDescription: String? {
        switch self { case .invalid(let message): return message }
    }
}

// Read CFB integers byte-by-byte: directory fields need not be naturally aligned.
extension Data {
    func u16(_ offset: Int) throws -> UInt16 {
        guard offset >= 0, offset <= count - 2 else { throw ViewerError.invalid("文件数据不完整。") }
        return UInt16(self[offset]) | UInt16(self[offset + 1]) << 8
    }
    func u32(_ offset: Int) throws -> UInt32 {
        guard offset >= 0, offset <= count - 4 else { throw ViewerError.invalid("文件数据不完整。") }
        return UInt32(self[offset]) | UInt32(self[offset + 1]) << 8 |
            UInt32(self[offset + 2]) << 16 | UInt32(self[offset + 3]) << 24
    }
    func u64(_ offset: Int) throws -> UInt64 {
        return UInt64(try u32(offset)) | UInt64(try u32(offset + 4)) << 32
    }
}

struct CompoundFile {
    struct Entry {
        let name: String
        let type: UInt8
        let left: UInt32
        let right: UInt32
        let child: UInt32
        let start: UInt32
        let size: Int
    }
    private let bytes: Data
    private let sectorSize: Int
    private let fat: [UInt32]
    private let miniFAT: [UInt32]
    private let miniStream: Data
    private let entries: [Entry]
    private(set) var streams: [String: Int] = [:]
    private static let end: UInt32 = 0xfffffffe
    private static let free: UInt32 = 0xffffffff

    init(data: Data) throws {
        guard data.count >= 512,
              data.prefix(8) == Data([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) else {
            throw ViewerError.invalid("这不是支持的 SGD 复合文档。请使用成像软件保存的原始 .sgd 文件。")
        }
        let major = try data.u16(26), shift = try data.u16(30)
        guard try data.u16(28) == 0xfffe,
              (major == 3 && shift == 9) || (major == 4 && shift == 12),
              try data.u16(32) == 6, try data.u32(56) == 4096 else {
            throw ViewerError.invalid("不支持这个复合文档版本。")
        }
        let ss = 1 << Int(shift)
        guard data.count >= ss, data.count % ss == 0 else { throw ViewerError.invalid("文件被截断，扇区不完整。") }
        let sectorCount = data.count / ss - 1
        func sector(_ id: UInt32) throws -> Data {
            guard Int(id) < sectorCount else { throw ViewerError.invalid("文件扇区索引超出范围。") }
            return data.subdata(in: (Int(id) + 1) * ss..<(Int(id) + 2) * ss)
        }
        let fatCount = Int(try data.u32(44))
        let difatCount = Int(try data.u32(72))
        guard fatCount > 0, fatCount <= sectorCount, difatCount <= sectorCount else {
            throw ViewerError.invalid("文件分配表无效。")
        }
        var fatIDs: [UInt32] = []
        for offset in stride(from: 76, to: 512, by: 4) {
            let id = try data.u32(offset)
            if id != Self.free { fatIDs.append(id) }
        }
        var difatID = try data.u32(68), visitedDIFAT = Set<UInt32>()
        for _ in 0..<difatCount {
            guard visitedDIFAT.insert(difatID).inserted else { throw ViewerError.invalid("文件分配表包含循环。") }
            let block = try sector(difatID)
            for offset in stride(from: 0, to: ss - 4, by: 4) {
                let id = try block.u32(offset)
                if id != Self.free { fatIDs.append(id) }
            }
            difatID = try block.u32(ss - 4)
        }
        guard fatIDs.count == fatCount, Set(fatIDs).count == fatCount else {
            throw ViewerError.invalid("文件分配表长度或索引无效。")
        }
        var table: [UInt32] = []
        for id in fatIDs {
            let block = try sector(id)
            for offset in stride(from: 0, to: ss, by: 4) { table.append(try block.u32(offset)) }
        }
        guard table.count >= sectorCount else { throw ViewerError.invalid("文件分配表不完整。") }
        func chain(_ start: UInt32, size: Int? = nil) throws -> Data {
            try Self.readChain(start: start, table: table, blockSize: ss,
                               blockCount: sectorCount, size: size, read: sector)
        }
        let directory = try chain(data.u32(48))
        var list: [Entry] = []
        for offset in stride(from: 0, to: directory.count, by: 128) {
            let length = Int(try directory.u16(offset + 64)), type = directory[offset + 66]
            var name = ""
            if type != 0 {
                guard [1, 2, 5].contains(type), length >= 2, length <= 64, length % 2 == 0,
                      try directory.u16(offset + length - 2) == 0,
                      let decoded = String(data: directory.subdata(in: offset..<offset + length - 2), encoding: .utf16LittleEndian),
                      !decoded.contains("/") else { throw ViewerError.invalid("文件目录无效。") }
                name = decoded
            }
            let size = try directory.u64(offset + 120)
            guard type == 0 || size <= UInt64(data.count) else { throw ViewerError.invalid("文件流长度超出范围。") }
            list.append(Entry(name: name, type: type, left: try directory.u32(offset + 68),
                              right: try directory.u32(offset + 72), child: try directory.u32(offset + 76),
                              start: try directory.u32(offset + 116), size: type == 0 ? 0 : Int(size)))
        }
        guard let root = list.first, root.type == 5 else { throw ViewerError.invalid("缺少根目录。") }
        let miniCount = Int(try data.u32(64))
        guard miniCount <= sectorCount else { throw ViewerError.invalid("小文件分配表长度无效。") }
        let miniBytes = try chain(data.u32(60), size: miniCount * ss)
        var miniTable: [UInt32] = []
        for offset in stride(from: 0, to: miniBytes.count, by: 4) { miniTable.append(try miniBytes.u32(offset)) }
        bytes = data; sectorSize = ss; fat = table; entries = list; miniFAT = miniTable
        miniStream = try chain(root.start, size: root.size)
        var found: [String: Int] = [:], seen = Set<UInt32>()
        func walk(_ id: UInt32, parent: String, depth: Int) throws {
            if id == Self.free { return }
            guard Int(id) < list.count, id != 0, depth < 256, seen.insert(id).inserted else {
                throw ViewerError.invalid("文件目录包含循环或无效索引。")
            }
            let entry = list[Int(id)]
            guard entry.type == 1 || entry.type == 2 else { throw ViewerError.invalid("无效的目录项。") }
            try walk(entry.left, parent: parent, depth: depth + 1)
            let path = parent + "/" + entry.name
            if entry.type == 2 {
                guard found[path] == nil else { throw ViewerError.invalid("文件包含重复的数据流。") }
                found[path] = Int(id)
            } else { try walk(entry.child, parent: path, depth: depth + 1) }
            try walk(entry.right, parent: parent, depth: depth + 1)
        }
        try walk(root.child, parent: "", depth: 0)
        streams = found
    }

    private static func readChain(start: UInt32, table: [UInt32], blockSize: Int,
                                  blockCount: Int, size: Int?, read: (UInt32) throws -> Data) throws -> Data {
        if size == 0 { return Data() }
        if let size, size < 0 || size > blockCount * blockSize { throw ViewerError.invalid("文件流长度无效。") }
        var id = start, seen = Set<UInt32>(), result = Data()
        while id != end {
            guard Int(id) < blockCount, Int(id) < table.count, seen.insert(id).inserted else {
                throw ViewerError.invalid("文件数据链损坏或包含循环。")
            }
            result.append(try read(id))
            id = table[Int(id)]
            if let size, result.count > ((size + blockSize - 1) / blockSize) * blockSize {
                throw ViewerError.invalid("文件数据链长度异常。")
            }
        }
        if let size {
            guard result.count >= size, result.count < size + blockSize else { throw ViewerError.invalid("文件流不完整。") }
            return Data(result.prefix(size))
        }
        return result
    }

    func stream(_ path: String) throws -> Data {
        guard let index = streams[path] else { throw ViewerError.invalid("找不到图像数据流。") }
        let entry = entries[index]
        if entry.size < 4096 {
            return try Self.readChain(start: entry.start, table: miniFAT, blockSize: 64,
                                      blockCount: miniStream.count / 64, size: entry.size) { id in
                miniStream.subdata(in: Int(id) * 64..<(Int(id) + 1) * 64)
            }
        }
        return try Self.readChain(start: entry.start, table: fat, blockSize: sectorSize,
                                  blockCount: bytes.count / sectorSize - 1, size: entry.size) { id in
            bytes.subdata(in: (Int(id) + 1) * sectorSize..<(Int(id) + 2) * sectorSize)
        }
    }
}

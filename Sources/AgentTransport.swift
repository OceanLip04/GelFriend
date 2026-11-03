import Foundation
import Darwin
import CoreFoundation

struct GelAgentError: Error, LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
    var json: [String: Any] { ["code": code, "message": message] }
}

enum GelAgentWire {
    static func validID(_ value: Any) -> Bool {
        if value is String { return true }
        if let n = value as? NSNumber { return CFGetTypeID(n) != CFBooleanGetTypeID() }
        return false
    }
    static func rpcCode(_ code: String) -> Int {
        switch code {case "PARSE_ERROR": return -32700; case "INVALID_REQUEST": return -32600; case "METHOD_NOT_FOUND": return -32601; case "INVALID_PARAMS": return -32602; case "NOT_INITIALIZED": return -32002; default: return -32000}
    }
    static let maximumRequest = 1_048_576
    static let maximumResponse = 16_777_216
    static var defaultPath: String { "/tmp/gelfriend-\(getuid())/agent.sock" }
    static var socketPath: String { ProcessInfo.processInfo.environment["GELFRIEND_AGENT_SOCKET"] ?? defaultPath }
    static func address(_ path: String) throws -> sockaddr_un {
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8) + [0]
        guard path.hasPrefix("/"), bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else { throw GelAgentError("INVALID_SOCKET", "Socket 路径必须是绝对路径，UTF-8 长度不超过 103 字节") }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes + Array(repeating: 0, count: $0.count - bytes.count)) }
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size); return address
    }
    static func withAddress<T>(_ address: inout sockaddr_un, _ body: (UnsafePointer<sockaddr>, socklen_t) throws -> T) rethrows -> T {
        try withUnsafePointer(to: &address) { p in try p.withMemoryRebound(to: sockaddr.self, capacity: 1) { try body($0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
    }
    static func configure(_ fd: Int32) {
        _ = fcntl(fd, F_SETFD, FD_CLOEXEC)
        let flags = fcntl(fd, F_GETFL); if flags >= 0 { _ = fcntl(fd, F_SETFL, flags & ~O_NONBLOCK) }
        var yes: Int32 = 1; setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
        var limit = timeval(tv_sec: 90, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &limit, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &limit, socklen_t(MemoryLayout<timeval>.size))
    }
    static func readLine(_ fd: Int32, limit: Int) throws -> Data {
        var result = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = Darwin.read(fd, &buffer, buffer.count)
            if n < 0 { if errno == EINTR { continue }; throw GelAgentError("IO_TIMEOUT", "读取失败或超时；请先重新读取状态，勿盲目重试写入") }
            if n == 0 { throw GelAgentError("CONNECTION_CLOSED", "连接在完整响应前关闭") }
            if let end = buffer[..<n].firstIndex(of: 10) {
                result.append(contentsOf: buffer[..<end]); guard result.count <= limit else { throw GelAgentError("MESSAGE_TOO_LARGE", "消息超过大小限制") }; return result
            }
            result.append(contentsOf: buffer[..<n]); guard result.count <= limit else { throw GelAgentError("MESSAGE_TOO_LARGE", "消息超过大小限制") }
        }
    }
    static func write(_ data: Data, to fd: Int32) throws {
        try data.withUnsafeBytes { raw in
            var offset = 0
            while offset < data.count {
                let n = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), data.count - offset)
                if n < 0 && errno == EINTR { continue }
                guard n > 0 else { throw GelAgentError("CONNECTION_CLOSED", "写入连接失败") }; offset += n
            }
        }
    }
    static func encode(_ value: Any) throws -> Data { var d = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]); d.append(10); return d }
    static func call(method: String, params: [String: Any], path: String) throws -> [String: Any] {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0); guard fd >= 0 else { throw GelAgentError("SOCKET_ERROR", "无法创建本机连接") }; defer { Darwin.close(fd) }; configure(fd)
        var address = try address(path)
        guard withAddress(&address, { Darwin.connect(fd, $0, $1) }) == 0 else { throw GelAgentError("NOT_CONNECTED", "无法连接 GelFriend。请打开软件并从 Agent 菜单开启本机接口；也可用 --agent 启动软件。") }
        let request: [String: Any] = ["jsonrpc": "2.0", "id": UUID().uuidString, "method": method, "params": params]
        let bytes = try encode(request); guard bytes.count <= maximumRequest else { throw GelAgentError("MESSAGE_TOO_LARGE", "请求超过 1 MiB") }
        try write(bytes, to: fd)
        guard let response = try JSONSerialization.jsonObject(with: readLine(fd, limit: maximumResponse)) as? [String: Any] else { throw GelAgentError("INVALID_RESPONSE", "响应格式无效") }; return response
    }
}

import Foundation
import Darwin

final class GelAgentServer {
    typealias Handler = ([String: Any], @escaping ([String: Any]) -> Void) -> Void
    private var source: DispatchSourceRead?
    private let path: String
    private let queue = DispatchQueue(label: "gelfriend.agent.listener")
    private let slots = DispatchSemaphore(value: 8)
    private let handler: Handler
    init(path: String = GelAgentWire.socketPath, handler: @escaping Handler) { self.path = path; self.handler = handler }
    func start() throws {
        let folder = URL(fileURLWithPath: path).deletingLastPathComponent().path
        var directory = stat()
        if lstat(folder, &directory) != 0 {
            guard errno == ENOENT, mkdir(folder, 0o700) == 0 else { throw GelAgentError("SOCKET_DIRECTORY", "无法创建本机接口目录") }
        } else {
            guard directory.st_uid == getuid(), directory.st_mode & S_IFMT == S_IFDIR, directory.st_mode & 0o077 == 0 else { throw GelAgentError("SOCKET_DIRECTORY", "接口目录必须属于当前用户且权限为 0700") }
        }
        var existing = stat()
        if lstat(path, &existing) == 0 {
            guard existing.st_uid == getuid(), existing.st_mode & S_IFMT == S_IFSOCK else { throw GelAgentError("SOCKET_EXISTS", "接口路径已被其他文件占用") }
            let probe = socket(AF_UNIX, SOCK_STREAM, 0); defer { Darwin.close(probe) }; var address = try GelAgentWire.address(path)
            if GelAgentWire.withAddress(&address, { Darwin.connect(probe, $0, $1) }) == 0 { throw GelAgentError("ALREADY_RUNNING", "另一份 GelFriend 已开启接口，请先关闭它的接口") }
            guard errno == ECONNREFUSED || errno == ENOENT else { throw GelAgentError("SOCKET_EXISTS", "无法确认旧接口状态") }
            guard unlink(path) == 0 else { throw GelAgentError("SOCKET_EXISTS", "无法清理已停止的接口") }
        }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0); guard fd >= 0 else { throw GelAgentError("SOCKET_ERROR", "无法创建接口") }
        GelAgentWire.configure(fd); var address = try GelAgentWire.address(path)
        guard GelAgentWire.withAddress(&address, { Darwin.bind(fd, $0, $1) }) == 0 else { Darwin.close(fd); throw GelAgentError("BIND_FAILED", "无法绑定本机接口") }
        guard chmod(path, 0o600) == 0, listen(fd, 8) == 0 else { Darwin.close(fd); unlink(path); throw GelAgentError("LISTEN_FAILED", "无法监听本机接口") }
        _ = fcntl(fd, F_SETFL, O_NONBLOCK)
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in
            guard let self else { return }
            while true {
                let client = accept(fd, nil, nil); if client < 0 { break }
                var uid: uid_t = 0, gid: gid_t = 0
                guard getpeereid(client, &uid, &gid) == 0, uid == getuid(), self.slots.wait(timeout: .now()) == .success else { Darwin.close(client); continue }
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    defer { Darwin.close(client); self?.slots.signal() }; self?.serve(client)
                }
            }
        }
        source.setCancelHandler { Darwin.close(fd) }; self.source = source; source.resume()
    }
    func stop() { source?.cancel(); source = nil; unlink(path) }
    deinit { if source != nil { stop() } }
    private func serve(_ fd: Int32) {
        GelAgentWire.configure(fd)
        var id: Any = NSNull()
        let response: [String: Any]
        do {
            let data = try GelAgentWire.readLine(fd, limit: GelAgentWire.maximumRequest)
            guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any], request["jsonrpc"] as? String == "2.0", let method = request["method"] as? String, !method.isEmpty, let requestID = request["id"], GelAgentWire.validID(requestID),
                  request["params"] == nil || request["params"] is [String: Any] else { throw GelAgentError("INVALID_REQUEST", "需要带 id、method、对象 params 的 JSON-RPC 2.0 请求") }
            id = requestID
            let done = DispatchSemaphore(value: 0), lock = NSLock(); var output: [String: Any]?
            DispatchQueue.main.async { [weak self] in
                guard let self else { done.signal(); return }
                self.handler(request) { value in lock.lock(); output = value; lock.unlock(); done.signal() }
            }
            if done.wait(timeout: .now() + 90) == .timedOut { throw GelAgentError("OPERATION_TIMEOUT", "操作超时，执行状态未知；先读取 workspace.state，勿自动重复写入") }
            lock.lock(); let answer = output; lock.unlock()
            guard let answer else { throw GelAgentError("STOPPED", "接口已停止") }; response = answer
        } catch {
            let e = error as? GelAgentError ?? GelAgentError("PARSE_ERROR", error.localizedDescription)
            response = ["jsonrpc": "2.0", "id": id, "error": ["code": GelAgentWire.rpcCode(e.code), "message": e.message, "data": e.json]]
        }
        if let bytes = try? GelAgentWire.encode(response) {
            if bytes.count <= GelAgentWire.maximumResponse { try? GelAgentWire.write(bytes, to: fd) }
            else if let error = try? GelAgentWire.encode(["jsonrpc":"2.0","id":id,"error":["code":-32000,"message":"Response exceeds 16 MiB; request a smaller result page","data":["code":"MESSAGE_TOO_LARGE"]]]) { try? GelAgentWire.write(error,to:fd) }
        }
    }
}

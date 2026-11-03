import AppKit
import WebKit
import UniformTypeIdentifiers

final class AnalysisWindow: NSWindowController, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    private var web: WKWebView!
    private var ready = false
    private var pendingAbout = false
    private var initialURL: URL?
    private var busy = false
    private var pendingHelp = false
    var onShowViewer: (([String: Any]) -> Void)?
    private var projectURL: URL?
    private var pendingProjectURL: URL?
    private var revision = 0
    private var savedRevision = 0
    private var hasDocument = false
    private var allowClose = false
    private var leavePending = false
    private var afterSave: ((Bool) -> Void)?
    private let recoveryQueue = DispatchQueue(label: "gelfriend.recovery")
    private var recoveryURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "local.research.gelfriend")
            .appendingPathComponent("Recovery.gelproject")
    }
    var hasUnsavedChanges: Bool { hasDocument && revision != savedRevision }
    init(url: URL?) {
        initialURL = url
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1420, height: 960),
            styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "胶个朋友"
        window.minSize = NSSize(width: 1150, height: 740)
        window.backgroundColor = Theme.paper; window.appearance = NSAppearance(named: .aqua); window.center()
        super.init(window: window)
        window.delegate = self
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "native")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        window.contentView = web
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("Analysis") else { return }
        web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
    }
    required init?(coder: NSCoder) { fatalError() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        ready = true
        if pendingAbout { pendingAbout = false; showAbout() }
        if pendingHelp { pendingHelp = false; showHelp() }
        send("setGelAgentConnection", ["enabled":agentEnabled])
        if let url = initialURL { initialURL = nil; open(url) } else { offerRecovery() }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.isFileURL == true ? .allow : .cancel)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "help": showHelp()
        case "viewer": requestBatch()
        case "batchSettings": onShowViewer?(body)
        case "import": chooseImages(append: body["append"] as? Bool ?? false)
        case "saveProject": if isAgentBusy { send("nativeStatus", "Agent 正在操作文件，请稍后保存") } else { saveProject(body) }
        case "documentEdited":
            hasDocument = true; revision = body["revision"] as? Int ?? revision + 1
            window?.isDocumentEdited = hasUnsavedChanges
        case "documentReady":
            hasDocument = true; revision = body["revision"] as? Int ?? 0
            savedRevision = body["saved"] as? Bool == true ? revision : -1
            window?.isDocumentEdited = hasUnsavedChanges
        case "rawLoaded":
            if body["append"] as? Bool != true {
                projectURL = nil; window?.representedURL = nil
                send("documentReplacementReady", ["saved": false, "name": body["name"] as? String ?? "未命名实验"])
            }
        case "projectLoaded":
            projectURL = pendingProjectURL; pendingProjectURL = nil
            revision = 0; savedRevision = projectURL == nil ? -1 : 0; hasDocument = true
            send("documentReplacementReady", ["saved": projectURL != nil, "name": projectURL?.deletingPathExtension().lastPathComponent ?? "恢复的实验"])
            window?.representedURL = projectURL
        case "recovery": writeRecovery(body)
        case "openProject": openText(ext: "gelproject", callback: "receiveProject")
        case "exportMarkers": saveText(body["text"] as? String ?? "", title: "导出个人 Marker 库", ext: "json", name: "我的Marker库.json")
        case "importMarkers": openText(ext: "json", callback: "receiveMarkers")
        case "report": saveReport(body)
        default: break
        }
    }
    func showAbout() {
        guard ready else { pendingAbout = true; return }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        send("showGelAbout", ["version": version])
    }
    func viewerCommand(_ command: String) { send("viewerCommand", command) }
    func chooseImages(append: Bool = false) {
        guard !busy, !isAgentBusy, let window else { return }
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [UTType(filenameExtension: "sgd") ?? .data, .tiff, .png]
        panel.message = "可选择 SGD、灰度或 RGB 的 8/16 位 TIFF、PNG；同一项目各通道尺寸须一致。"
        panel.beginSheetModal(for: window) { [weak self] response in
            if response == .OK {
                if append { self?.load(panel.urls, append: true) }
                else { self?.confirmLeaving { ok in if ok { self?.load(panel.urls, append: false) } } }
            }
        }
    }
    private func showHelp() {
        guard ready else { pendingHelp = true; return }
        send("showGelHelp", [:])
    }
    private func send(_ function: String, _ value: Any) {
        guard ready, let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.\(function)(\(text)); void 0;") { [weak self] _, error in
            if let error { self?.alert(error.localizedDescription) }
        }
    }
    private func alert(_ message: String) {
        let a = NSAlert(); a.messageText = "胶个朋友"; a.informativeText = message
        a.beginSheetModal(for: window!)
    }
    private func load(_ urls: [URL], append: Bool) {
        guard !busy, !isAgentBusy else { return }; busy = true; send("nativeStatus", "正在读取原始像素…")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                var channels: [AnalysisChannel] = []
                for url in urls { channels += try AnalysisImport.read(url) }
                guard channels.count <= 8, channels.reduce(0, { $0 + $1.samples.count }) <= 40_000_000 else { throw ViewerError.invalid("最多 8 通道、合计 4000 万像素。") }
                let result = channels.map { $0.json }
                DispatchQueue.main.async { self?.busy = false; self?.protectedImagePaths.formUnion(urls.map { $0.standardizedFileURL.resolvingSymlinksInPath().path }); self?.send("receiveChannels", ["append": append, "channels": result]) }
            } catch { DispatchQueue.main.async { self?.busy = false; self?.send("nativeStatus", "读取失败"); self?.alert(error.localizedDescription) } }
        }
    }
    func open(_ url: URL) {
        if isAgentBusy { send("nativeStatus", "Agent 正在操作文件，请稍后打开") ; return }
        if !ready { initialURL = url; return }
        if url.pathExtension.lowercased() == "gelproject" { confirmLeaving { [weak self] ok in if ok { self?.openProject(url) } }; return }
        if ["sgd", "tiff", "tif", "png"].contains(url.pathExtension.lowercased()) { confirmLeaving { [weak self] ok in if ok { self?.load([url], append: false) } } }
        else { alert("此应用用于胶图；流式 FCS 请使用细数生命。") }
    }
    private func openProject(_ url: URL) {
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size < 300_000_000 else { throw ViewerError.invalid("项目文件过大。") }
            let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
            pendingProjectURL = url
            send("receiveProject", json)
        } catch { alert(error.localizedDescription) }
    }
    private func saveText(_ text: String, title: String, ext: String, name: String) {
        let panel = NSSavePanel(); panel.title = title; panel.nameFieldStringValue = (name as NSString).deletingPathExtension
        panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        panel.beginSheetModal(for: window!) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do { try text.write(to: url, atomically: true, encoding: .utf8); self?.send("nativeStatus", "已保存：" + url.lastPathComponent) }
            catch { self?.alert(error.localizedDescription) }
        }
    }
    private func openText(ext: String, callback: String) {
        guard !isAgentBusy else { return }
        let panel = NSOpenPanel(); panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
        panel.beginSheetModal(for: window!) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size < (ext == "json" ? 1_000_000 : 300_000_000) else { throw ViewerError.invalid("文件过大。") }
                let data = try Data(contentsOf: url)
                let json = try JSONSerialization.jsonObject(with: data)
                if callback == "receiveProject" {
                    self?.confirmLeaving { ok in if ok { self?.pendingProjectURL = url; self?.send(callback, json) } }
                } else { self?.send(callback, json) }
            } catch { self?.alert(error.localizedDescription) }
        }
    }

    func projectCommand(_ command: String) { send("nativeProjectCommand", command) }
    func requestBatch() { guard !isAgentBusy else { return }; projectCommand("batch") }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if isAgentBusy { return false }
        if allowClose || !hasUnsavedChanges { return true }
        confirmLeaving(discardForExit: true) { [weak self] ok in
            guard ok else { return }; self?.allowClose = true; self?.window?.performClose(nil); self?.allowClose = false
        }
        return false
    }
    func confirmLeaving(discardForExit: Bool = false, _ completion: @escaping (Bool) -> Void) {
        guard hasUnsavedChanges else { completion(true); return }
        guard !leavePending, let window else { completion(false); return }
        leavePending = true
        let a = NSAlert(); a.messageText = "要保存这个实验的修改吗？"
        a.informativeText = "保存泳道、条带、标准对应和当前视野，之后可以继续编辑。"
        a.addButton(withTitle: "保存"); a.addButton(withTitle: "不保存"); a.addButton(withTitle: "取消")
        a.beginSheetModal(for: window) { [weak self] response in
            guard let self else { completion(false); return }
            self.leavePending = false
            if response == .alertFirstButtonReturn { self.afterSave = completion; self.projectCommand("save") }
            else if response == .alertSecondButtonReturn { if discardForExit { self.savedRevision = self.revision; self.window?.isDocumentEdited = false }; self.removeRecovery(); completion(true) }
            else { completion(false) }
        }
    }
    private func saveProject(_ body: [String: Any]) {
        guard let text = body["text"] as? String, let version = body["revision"] as? Int else { return }
        let finish: (URL?) -> Void = { [weak self] url in
            guard let self else { return }
            guard let url else { let next = self.afterSave; self.afterSave = nil; next?(false); return }
            do {
                try text.write(to: url, atomically: true, encoding: .utf8)
                self.projectURL = url; self.savedRevision = version; self.window?.representedURL = url
                self.window?.isDocumentEdited = self.hasUnsavedChanges
                self.send("projectSaved", ["revision": version, "name": url.deletingPathExtension().lastPathComponent])
                self.send("nativeStatus", "已保存：" + url.lastPathComponent)
                if !self.hasUnsavedChanges { self.removeRecovery() }
                let next = self.afterSave; self.afterSave = nil; next?(!self.hasUnsavedChanges)
            } catch { self.alert(error.localizedDescription); let next = self.afterSave; self.afterSave = nil; next?(false) }
        }
        if let url = projectURL, body["saveAs"] as? Bool != true { finish(url); return }
        let panel = NSSavePanel(); panel.title = "保存可继续编辑的实验"
        panel.nameFieldStringValue = projectURL?.deletingPathExtension().lastPathComponent ?? "胶图实验"
        panel.allowedContentTypes = [UTType(filenameExtension: "gelproject") ?? .data]
        panel.beginSheetModal(for: window!) { response in finish(response == .OK ? panel.url : nil) }
    }
    private func writeRecovery(_ body: [String: Any]) {
        guard let text = body["text"] as? String, text.utf8.count < 300_000_000,
              body["revision"] as? Int == revision, hasUnsavedChanges else { return }
        let url = recoveryURL
        recoveryQueue.async { [weak self] in
            do { try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try text.write(to: url, atomically: true, encoding: .utf8)
            } catch { DispatchQueue.main.async { self?.send("nativeStatus", "恢复副本写入失败，请保存项目：" + error.localizedDescription) } }
        }
    }
    private func removeRecovery() { let url = recoveryURL; recoveryQueue.async { try? FileManager.default.removeItem(at: url) } }
    private func offerRecovery() {
        guard FileManager.default.fileExists(atPath: recoveryURL.path) else { return }
        let a = NSAlert(); a.messageText = "继续上次未保存的实验？"
        a.informativeText = "发现保存在本机的恢复副本。恢复后请另存为项目。"
        a.addButton(withTitle: "恢复实验"); a.addButton(withTitle: "稍后")
        a.beginSheetModal(for: window!) { [weak self] response in
            guard let self, response == .alertFirstButtonReturn else { return }
            self.openProject(self.recoveryURL); self.pendingProjectURL = nil
        }
    }

    private func saveReport(_ body: [String: Any]) {
        guard !isAgentBusy else { return }
        guard let files = body["files"] as? [[String: String]], files.count <= 20 else { return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = false
        panel.canCreateDirectories = true; panel.message = "选择保存位置；软件会新建报告文件夹。"
        panel.beginSheetModal(for: window!) { [weak self] response in
            guard response == .OK, let url = panel.url else { return }
            do {
                let folder = url.appendingPathComponent("胶个朋友报告-" + UUID().uuidString.prefix(8))
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                for file in files {
                    guard let name = file["name"], name == URL(fileURLWithPath: name).lastPathComponent,
                          !name.hasPrefix("."), let contents = file["contents"] else { throw ViewerError.invalid("报告文件名无效。") }
                    try contents.write(to: folder.appendingPathComponent(name), atomically: true, encoding: .utf8)
                }
                self?.send("nativeStatus", "报告已保存：" + folder.lastPathComponent)
                NSWorkspace.shared.activateFileViewerSelecting([folder])
            } catch { self?.alert(error.localizedDescription) }
        }
    }
    var agentEnabled = false {
        didSet { if ready { send("setGelAgentConnection", ["enabled": agentEnabled]) } }
    }
    private(set) var isAgentBusy = false
    private var protectedImagePaths = Set<String>()
    func handleAgent(_ request: [String: Any], completion: @escaping ([String: Any]) -> Void) {
        let id = request["id"] ?? NSNull(), method = request["method"] as? String ?? ""
        func fail(_ error: Error) {
            let e = error as? GelAgentError ?? GelAgentError("OPERATION_FAILED", error.localizedDescription)
            completion(["jsonrpc":"2.0", "id":id,"error":["code":GelAgentWire.rpcCode(e.code),"message":e.message,"data":e.json]])
        }
        guard agentEnabled else { fail(GelAgentError("DISABLED", "Agent 接口已关闭")); return }
        guard ready else { fail(GelAgentError("NOT_READY", "工作区尚未就绪，请稍后读取状态")); return }
        guard !busy, !isAgentBusy, !leavePending, window?.attachedSheet == nil else { fail(GelAgentError("BUSY", "当前有文件操作或系统弹窗，请稍后读取状态")); return }
        isAgentBusy = true
        let params = request["params"] as? [String: Any] ?? [:]
        // Only structured parameters enter WebKit; no caller-provided code is evaluated.
        let call: [String: Any] = ["method":method,"params":params,"requestId":String(describing:id)]
        let finish: ([String: Any]) -> Void = { [weak self] reply in
            self?.isAgentBusy = false
            if reply["ok"] as? Bool == true {
                var result = reply["result"] as? [String: Any] ?? [:]
                if method == "workspace.state" { result["projectPath"] = self?.projectURL?.path ?? NSNull(); result["agentEnabled"] = self?.agentEnabled ?? false }
                completion(["jsonrpc":"2.0","id":id,"result":result])
            } else {
                var error = reply["error"] as? [String: Any] ?? ["code":"OPERATION_FAILED","message":"操作失败"]
                if let token = reply["documentId"] { error["documentId"] = token }; if let revision = reply["revision"] { error["revision"] = revision }
                completion(["jsonrpc":"2.0","id":id,"error":["code":GelAgentWire.rpcCode(error["code"] as? String ?? "OPERATION_FAILED"),"message":error["message"] ?? "操作失败","data":error]])
            }
        }
        agentJavaScript("gelAgentPreflight", call) { [weak self] preflight in
            guard let self else { finish(["ok":false,"error":["code":"STOPPED","message":"工作区已关闭"]]); return }
            guard preflight["ok"] as? Bool == true else { finish(preflight); return }
            if method == "document.open" {
                if (preflight["result"] as? [String: Any])?["unsaved"] as? Bool == true, params["discardChanges"] as? Bool != true { finish(["ok":false,"error":["code":"UNSAVED_CHANGES","message":"当前实验未保存；先保存或明确 discardChanges=true"]]); return }
                do {
                    let url = try self.agentURL(params["path"], directory: false)
                    let ext = url.pathExtension.lowercased()
                    guard ["sgd","tif","tiff","png","gelproject"].contains(ext) else { throw GelAgentError("UNSUPPORTED_FORMAT", "仅支持 SGD/TIFF/PNG/gelproject") }
                    if ext != "gelproject", params["experiment"] == nil { throw GelAgentError("EXPERIMENT_REQUIRED", "打开原图需指定 experiment") }
                    DispatchQueue.global(qos: .userInitiated).async {
                        do {
                            var payload: [String: Any] = ["kind":ext == "gelproject" ? "project" : "channels","name":url.deletingPathExtension().lastPathComponent]
                            if ext == "gelproject" {
                                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                                guard size < 300_000_000 else { throw GelAgentError("FILE_TOO_LARGE", "项目上限 300 MB") }
                                payload["project"] = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
                            } else { payload["channels"] = try AnalysisImport.read(url).map { $0.json } }
                            DispatchQueue.main.async {
                                self.agentJavaScript("gelAgentImport", call, payload:payload) { reply in
                                    if reply["ok"] as? Bool == true {
                                        self.projectURL = ext == "gelproject" ? url : nil; self.window?.representedURL = self.projectURL
                                        if ext != "gelproject" { self.protectedImagePaths.insert(url.path) }
                                        let result = reply["result"] as? [String: Any] ?? [:]
                                        self.revision = result["documentRevision"] as? Int ?? 0; self.savedRevision = ext == "gelproject" ? self.revision : -1; self.hasDocument = true; self.window?.isDocumentEdited = self.hasUnsavedChanges
                                    }
                                    finish(reply)
                                }
                            }
                        } catch { DispatchQueue.main.async { finish(self.agentFailure(error)) } }
                    }
                } catch { finish(self.agentFailure(error)) }
            } else if ["document.save","document.exportImage","document.exportReport"].contains(method) {
                do {
                    let output = try self.agentURL(params[method == "document.exportReport" ? "directory" : "path"], directory:method == "document.exportReport")
                    if method != "document.exportReport" {
                        guard output.pathExtension.lowercased() == (method == "document.save" ? "gelproject" : "png") else { throw GelAgentError("INVALID_OUTPUT", "输出扩展名须为 gelproject 或 png") }
                        guard !self.protectedImagePaths.contains(output.path) else { throw GelAgentError("SOURCE_PROTECTED", "不能覆盖已读取的原始图像") }
                    }
                    self.agentJavaScript("gelAgentCapture", call) { capture in
                        guard capture["ok"] as? Bool == true, let value = capture["result"] as? [String: Any] else { finish(capture); return }
                        DispatchQueue.global(qos: .userInitiated).async {
                            do {
                                var result: [String: Any] = ["documentId":value["documentId"] ?? NSNull(),"revision":value["revision"] ?? NSNull(),"documentRevision":value["documentRevision"] ?? NSNull()]
                                if method == "document.exportReport" {
                                    guard let files = value["files"] as? [[String: String]], !files.isEmpty, files.count <= 20 else { throw GelAgentError("EXPORT_FAILED", "报告内容无效") }
                                    let folder = output.appendingPathComponent("GelFriend-"+UUID().uuidString)
                                    try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:false)
                                    for file in files {
                                        guard let name = file["name"], name == URL(fileURLWithPath:name).lastPathComponent, !name.hasPrefix("."), let content=file["contents"] else { throw GelAgentError("INVALID_OUTPUT", "报告文件名无效") }
                                        try Data(content.utf8).write(to:folder.appendingPathComponent(name),options:.withoutOverwriting)
                                    }
                                    result["directory"] = folder.path; result["files"] = files.compactMap { $0["name"] }; result["reviewRequired"] = value["draft"] as? Bool ?? true; result["issueCount"] = value["issueCount"] ?? 0
                                } else {
                                    let data: Data
                                    if method == "document.save", let text = value["text"] as? String { data = Data(text.utf8) }
                                    else if let png = value["png"] as? String, png.hasPrefix("data:image/png;base64,"), let comma = png.firstIndex(of:","), let bytes = Data(base64Encoded:String(png[png.index(after:comma)...])), bytes.starts(with:[137,80,78,71,13,10,26,10]) { data = bytes }
                                    else { throw GelAgentError("EXPORT_FAILED", "导出内容无效") }
                                    try data.write(to:output,options:params["overwrite"] as? Bool == true ? .atomic : .withoutOverwriting)
                                    result["path"] = output.path; result["bytes"] = data.count
                                }
                                DispatchQueue.main.async {
                                    if method == "document.save" {
                                        self.projectURL = output; self.savedRevision = value["documentRevision"] as? Int ?? self.revision
                                        self.window?.representedURL = output; self.window?.isDocumentEdited = self.hasUnsavedChanges
                                        self.send("projectSaved", ["revision":self.savedRevision,"name":output.deletingPathExtension().lastPathComponent]);if !self.hasUnsavedChanges { self.removeRecovery() }
                                    }
                                    finish(["ok":true,"result":result])
                                }
                            } catch { DispatchQueue.main.async { finish(self.agentFailure(error)) } }
                        }
                    }
                } catch { finish(self.agentFailure(error)) }
            } else { self.agentJavaScript("gelAgentCall",call,completion:finish) }
        }
    }
    private func agentURL(_ value: Any?, directory: Bool) throws -> URL {
        guard let path=value as? String, path.hasPrefix("/"), !path.contains("\0") else { throw GelAgentError("INVALID_PATH", "需要绝对本机路径") }
        let url=URL(fileURLWithPath:path).standardizedFileURL.resolvingSymlinksInPath()
        if directory { var isDirectory: ObjCBool=false;guard FileManager.default.fileExists(atPath:url.path,isDirectory:&isDirectory),isDirectory.boolValue else { throw GelAgentError("INVALID_PATH","导出父目录必须已存在") } }
        return url
    }
    private func agentFailure(_ error: Error) -> [String: Any] { let e=error as? GelAgentError ?? GelAgentError("IO_ERROR",error.localizedDescription);return ["ok":false,"error":e.json] }
    private func agentJavaScript(_ function: String, _ request: [String: Any], payload: [String: Any]? = nil, completion: @escaping ([String: Any]) -> Void) {
        var arguments: [String: Any] = ["request":request];if let payload { arguments["payload"]=payload }
        let code = payload == nil ? "return await window.\(function)(request);" : "return await window.\(function)(request,payload);"
        web.callAsyncJavaScript(code,arguments:arguments,in:nil,in:.page) { [weak self] result in
            switch result {case .success(let value):completion(value as? [String: Any] ?? ["ok":false,"error":["code":"BRIDGE_ERROR","message":"工作区响应格式无效"]]);case .failure(let error):completion(self?.agentFailure(error) ?? ["ok":false])}
        }
    }

}

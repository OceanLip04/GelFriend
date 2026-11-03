import AppKit
import UniformTypeIdentifiers

final class GelCanvas: NSView {
    var image: NSImage?
    var imageSize = NSSize.zero
    var zoom: CGFloat = 1
    var onDrop: ((URL) -> Void)?
    override var isFlipped: Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL])
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.09, alpha: 1).setFill(); bounds.fill()
        guard let image else {
            let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
            let message = "拖入 .sgd 文件\n或点击左上角“打开胶图”"
            (message as NSString).draw(in: NSRect(x: 0, y: max(40, bounds.midY - 35), width: bounds.width, height: 80),
                withAttributes: [.font: NSFont.systemFont(ofSize: 18), .foregroundColor: NSColor.lightGray,
                                 .paragraphStyle: paragraph])
            return
        }
        let size = NSSize(width: imageSize.width * zoom, height: imageSize.height * zoom)
        let rect = NSRect(x: max(0, (bounds.width - size.width) / 2),
                          y: max(0, (bounds.height - size.height) / 2), width: size.width, height: size.height)
        image.draw(in: rect, from: .zero, operation: .copy, fraction: 1, respectFlipped: true,
                   hints: [.interpolation: NSImageInterpolation.none])
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        dropURL(sender) == nil ? [] : .copy
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let url = dropURL(sender) else { return false }
        onDrop?(url); return true
    }
    private func dropURL(_ sender: NSDraggingInfo) -> URL? {
        let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]
        return urls?.first(where: { $0.pathExtension.lowercased() == "sgd" })
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    var startupURLs: [URL] = []
    private var window: NSWindow!
    private let canvas = GelCanvas(frame: NSRect(x: 0, y: 0, width: 820, height: 700))
    private let scroll = NSScrollView()
    private let status = NSTextField(labelWithString: "打开或拖入 SGD 文件，即可查看原始胶图。")
    private let info = NSTextField(wrappingLabelWithString: "尚未打开文件")
    private let details = NSTextView()
    private let lowSlider = NSSlider(value: 0, minValue: 0, maxValue: 4095, target: nil, action: nil)
    private let highSlider = NSSlider(value: 4095, minValue: 1, maxValue: 4095, target: nil, action: nil)
    private let gammaSlider = NSSlider(value: 1, minValue: 0.2, maxValue: 3, target: nil, action: nil)
    private let lowField = NSTextField(string: "0")
    private let highField = NSTextField(string: "4095")
    private let gammaValue = NSTextField(labelWithString: "1.00")
    private let invert = NSButton(checkboxWithTitle: "反相（黑白转换）", target: nil, action: nil)
    private let flip = NSButton(checkboxWithTitle: "上下翻转", target: nil, action: nil)
    private let angleField = NSTextField(string: "0.00")
    private let angleSlider = NSSlider(value: 0, minValue: -180, maxValue: 180, target: nil, action: nil)
    private var imageButtons: [NSButton] = []
    private var previewButton: NSButton?
    private var gel: GelImage?
    private var fileURL: URL?
    private var currentPreview: CGImage?
    private var angle = 0.0
    private var analysisWindow: AnalysisWindow?
    private var agentServer: GelAgentServer?
    private var agentMenuItem: NSMenuItem?
    private var batchSheet: BatchSheet?
    private var fitMode = true
    private var generation = 0
    private var loadGeneration = 0
    private var renderWork: DispatchWorkItem?
    private let renderQueue = DispatchQueue(label: "sgd.render", qos: .userInitiated)

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu(); buildWindow()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        if let url = startupURLs.first, url.pathExtension.lowercased() == "sgd" { load(url) }
        makeAnalysis(url: startupURLs.first)
        if CommandLine.arguments.contains("--agent") { toggleAgentInterface() }
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        if window == nil { startupURLs = urls }
        else if let url = urls.first {
            if url.pathExtension.lowercased() == "sgd" { load(url) }
            if analysisWindow == nil { makeAnalysis(url: url) }
            else { analysisWindow?.open(url); analysisWindow?.showWindow(nil) }
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if analysisWindow?.isAgentBusy == true { return .terminateCancel }
        if batchSheet?.running == true { batchSheet?.stop(); return .terminateCancel }
        if let analysisWindow, analysisWindow.hasUnsavedChanges {
            analysisWindow.confirmLeaving(discardForExit: true) { ok in NSApp.reply(toApplicationShouldTerminate: ok) }
            return .terminateLater
        }
        return .terminateNow
    }

    @objc private func openAnalysis() {
        if analysisWindow == nil { makeAnalysis(url: fileURL) }
        analysisWindow?.showWindow(nil)
        analysisWindow?.window?.makeKeyAndOrderFront(nil)
    }

    private func makeAnalysis(url: URL?) {
        analysisWindow = AnalysisWindow(url: url)
        analysisWindow?.onShowViewer = { [weak self] settings in self?.presentBatch(settings) }
        analysisWindow?.showWindow(nil)
    }

    func applicationWillTerminate(_ notification: Notification) { agentServer?.stop() }
    @objc private func toggleAgentInterface() {
        if let server = agentServer { server.stop(); agentServer = nil; analysisWindow?.agentEnabled = false; agentMenuItem?.title = "开启本机 Agent 接口"; agentMenuItem?.state = .off; return }
        do {
            let server = GelAgentServer { [weak self] request, completion in
                guard let window = self?.analysisWindow else { completion(["jsonrpc":"2.0","id":request["id"] ?? NSNull(),"error":["code":-32000,"message":"工作区未打开"]]); return }
                window.handleAgent(request,completion:completion)
            }
            try server.start(); agentServer = server; analysisWindow?.agentEnabled = true; agentMenuItem?.title = "关闭本机 Agent 接口"; agentMenuItem?.state = .on
        } catch { let a = NSAlert(); a.messageText = "Agent 接口未开启"; a.informativeText = error.localizedDescription; presentWorkspaceNotice(a) }
    }

    private func buildMenu() {
        let bar = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 胶个朋友", action: #selector(about), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let root = NSMenuItem(); root.submenu = appMenu; bar.addItem(root)
        let file = NSMenu(title: "文件")
        file.addItem(withTitle: "打开胶图…", action: #selector(openFile), keyEquivalent: "o")
        file.addItem(withTitle: "保存实验", action: #selector(saveExperiment), keyEquivalent: "s")
        file.addItem(withTitle: "实验另存为…", action: #selector(saveExperimentAs), keyEquivalent: "S")
        file.addItem(withTitle: "分析工作台…", action: #selector(openAnalysis), keyEquivalent: "")
        file.addItem(withTitle: "批量处理…", action: #selector(openBatch), keyEquivalent: "B")
        let png = file.addItem(withTitle: "导出当前预览 PNG…", action: #selector(exportPreview), keyEquivalent: "")
        png.target = self
        let tiff = file.addItem(withTitle: "导出原始 16 位 TIFF…", action: #selector(exportOriginal), keyEquivalent: "E")
        tiff.target = self
        file.addItem(.separator())
        file.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let fileRoot = NSMenuItem(); fileRoot.submenu = file; bar.addItem(fileRoot)
        let view = NSMenu(title: "查看")
        view.addItem(withTitle: "适应窗口", action: #selector(fit), keyEquivalent: "0")
        view.addItem(withTitle: "100%", action: #selector(actualSize), keyEquivalent: "1")
        view.addItem(withTitle: "放大", action: #selector(zoomIn), keyEquivalent: "+")
        view.addItem(withTitle: "缩小", action: #selector(zoomOut), keyEquivalent: "-")
        view.addItem(withTitle: "顺时针旋转 90°", action: #selector(rotate), keyEquivalent: "r")
        view.addItem(withTitle: "逆时针旋转 90°", action: #selector(rotateLeft), keyEquivalent: "R")
        let viewRoot = NSMenuItem(); viewRoot.submenu = view; bar.addItem(viewRoot)
        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "撤销实验编辑", action: #selector(undoExperiment), keyEquivalent: "z")
        edit.addItem(withTitle: "重做实验编辑", action: #selector(redoExperiment), keyEquivalent: "Z")
        let editRoot = NSMenuItem(); editRoot.submenu = edit; bar.insertItem(editRoot, at: 2)
        let agent = NSMenu(title: "Agent")
        let toggle = agent.addItem(withTitle: "开启本机 Agent 接口", action: #selector(toggleAgentInterface), keyEquivalent: "")
        toggle.target = self; agentMenuItem = toggle
        let agentRoot = NSMenuItem(); agentRoot.submenu = agent; bar.addItem(agentRoot)
        NSApp.mainMenu = bar
    }

    private func button(_ title: String, _ action: Selector, needsImage: Bool = true) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        Theme.style(button)
        if needsImage { imageButtons.append(button); button.isEnabled = false }
        return button
    }
    private func label(_ text: String, size: CGFloat = 12, bold: Bool = false) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: text)
        field.font = bold ? Theme.heading(size) : .systemFont(ofSize: size)
        field.textColor = Theme.ink
        return field
    }
    private func row(_ views: [NSView]) -> NSStackView {
        let row = NSStackView(views: views); row.orientation = .horizontal; row.spacing = 7
        row.alignment = .centerY
        return row
    }
    private func buildWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "胶个朋友 · 胶图浏览与批量"
        window.minSize = NSSize(width: 1040, height: 800); window.center()
        window.appearance = NSAppearance(named: .aqua); window.backgroundColor = Theme.paper
        let content = window.contentView!
        let icon = NSImageView(image: NSImage(named: NSImage.applicationIconName) ?? NSImage())
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.widthAnchor.constraint(equalToConstant: 46).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 46).isActive = true
        let identity = NSStackView(views: [label("胶个朋友", size: 26, bold: true), label("SGD 胶图浏览 · 旋转 · 批量 · 生命科学分析", size: 12)])
        identity.orientation = .vertical; identity.alignment = .leading; identity.spacing = 2
        let header = row([icon, identity]); header.spacing = 12
        header.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(header)
        let open = button("打开胶图…", #selector(openFile), needsImage: false)
        Theme.style(open, prominent: true)
        let preview = button("导出 PNG…", #selector(exportPreview)); previewButton = preview
        let toolbar = row([open, button("适应窗口", #selector(fit)), button("100%", #selector(actualSize)),
                           button("−", #selector(zoomOut)), button("+", #selector(zoomIn)),
                           preview,
                           button("原始 TIFF…", #selector(exportOriginal)),
                           button("批量处理…", #selector(openBatch), needsImage: false),
                           button("分析工作台…", #selector(openAnalysis), needsImage: false)])
        toolbar.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(toolbar)
        angleField.widthAnchor.constraint(equalToConstant: 76).isActive = true
        angleField.alignment = .right; angleField.target = self; angleField.action = #selector(angleEntered)
        angleField.toolTip = "输入顺时针旋转角度；负数为逆时针。"
        Theme.field(angleField)
        angleSlider.widthAnchor.constraint(equalToConstant: 180).isActive = true
        angleSlider.target = self; angleSlider.action = #selector(angleMoved); angleSlider.isContinuous = true
        angleSlider.trackFillColor = Theme.clay
        let rotationBar = row([label("旋转", size: 12, bold: true), button("左转 90°", #selector(rotateLeft)),
                               button("右转 90°", #selector(rotate)), angleSlider, angleField, label("°"),
                               button("归零", #selector(clearAngle)), label("正值顺时针 · 保留完整画面", size: 11)])
        rotationBar.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(rotationBar)
        let sidebar = NSStackView(); sidebar.orientation = .vertical; sidebar.alignment = .leading; sidebar.spacing = 13
        sidebar.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(sidebar)
        info.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        info.textColor = Theme.ink
        sidebar.addArrangedSubview(label("图像信息", size: 14, bold: true)); sidebar.addArrangedSubview(info)
        let separator = NSBox(); separator.boxType = .separator
        sidebar.addArrangedSubview(separator)
        sidebar.addArrangedSubview(label("显示调整", size: 14, bold: true))
        sidebar.addArrangedSubview(label("只影响预览和 PNG；原始 TIFF 保留像素数据。"))
        for (name, slider, field) in [("黑场", lowSlider, lowField), ("白场", highSlider, highField)] {
            field.alignment = .right; field.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
            Theme.field(field)
            field.target = self; field.action = #selector(levelFieldChanged(_:))
            field.widthAnchor.constraint(equalToConstant: 70).isActive = true
            let heading = row([label(name), field]); sidebar.addArrangedSubview(heading)
            slider.target = self; slider.action = #selector(levelSliderChanged(_:)); slider.isContinuous = true
            slider.trackFillColor = Theme.clay
            sidebar.addArrangedSubview(slider)
        }
        sidebar.addArrangedSubview(row([label("Gamma"), gammaValue]))
        gammaSlider.target = self; gammaSlider.action = #selector(adjust); gammaSlider.isContinuous = true
        gammaSlider.trackFillColor = Theme.clay
        sidebar.addArrangedSubview(gammaSlider)
        sidebar.addArrangedSubview(row([button("自动对比度", #selector(autoContrast)), button("重置", #selector(reset))]))
        invert.target = self; invert.action = #selector(adjust); sidebar.addArrangedSubview(invert)
        flip.target = self; flip.action = #selector(adjust); sidebar.addArrangedSubview(flip)
        Theme.style(invert); Theme.style(flip)
        sidebar.addArrangedSubview(label("采集记录", size: 14, bold: true))
        details.isEditable = false; details.isSelectable = true
        details.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        details.backgroundColor = Theme.surface; details.textColor = Theme.ink
        details.textContainerInset = NSSize(width: 5, height: 6)
        details.string = "打开文件后显示曝光时间、相机等记录。"
        let detailsScroll = NSScrollView(); detailsScroll.documentView = details
        detailsScroll.hasVerticalScroller = true; detailsScroll.borderType = .bezelBorder
        details.minSize = .zero; details.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        details.isVerticallyResizable = true; details.isHorizontallyResizable = false
        details.autoresizingMask = [.width]; details.textContainer?.widthTracksTextView = true
        sidebar.addArrangedSubview(detailsScroll)
        for view in [info, separator, lowSlider, highSlider, gammaSlider, detailsScroll] as [NSView] {
            view.widthAnchor.constraint(equalTo: sidebar.widthAnchor).isActive = true
        }
        detailsScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 90).isActive = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.hasHorizontalScroller = true; scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true; scroll.documentView = canvas
        scroll.drawsBackground = true; scroll.backgroundColor = NSColor(calibratedWhite: 0.09, alpha: 1)
        content.addSubview(scroll)
        canvas.onDrop = { [weak self] url in self?.load(url) }
        status.font = .systemFont(ofSize: 11); status.textColor = Theme.muted
        status.lineBreakMode = .byTruncatingMiddle; status.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(status)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: content.topAnchor, constant: 14),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            header.heightAnchor.constraint(equalToConstant: 48),
            toolbar.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 12),
            toolbar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            toolbar.heightAnchor.constraint(equalToConstant: 32),
            rotationBar.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 8),
            rotationBar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            rotationBar.heightAnchor.constraint(equalToConstant: 30),
            sidebar.topAnchor.constraint(equalTo: rotationBar.bottomAnchor, constant: 15),
            sidebar.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -14),
            sidebar.widthAnchor.constraint(equalToConstant: 262),
            sidebar.bottomAnchor.constraint(equalTo: status.topAnchor, constant: -12),
            scroll.topAnchor.constraint(equalTo: rotationBar.bottomAnchor, constant: 12),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: -15),
            scroll.bottomAnchor.constraint(equalTo: status.topAnchor, constant: -10),
            status.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 14),
            status.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -14),
            status.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -9)
        ])
        scroll.contentView.postsBoundsChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(resized), name: NSWindow.didResizeNotification, object: window)
        setControlsEnabled(false)
        DispatchQueue.main.async { self.layoutCanvas() }
    }

    private func setControlsEnabled(_ enabled: Bool) {
        for button in imageButtons { button.isEnabled = enabled }
        for slider in [lowSlider, highSlider, gammaSlider] { slider.isEnabled = enabled }
        lowField.isEnabled = enabled; highField.isEnabled = enabled
        invert.isEnabled = enabled; flip.isEnabled = enabled
        angleField.isEnabled = enabled; angleSlider.isEnabled = enabled
    }
    private var analysisIsKey: Bool { NSApp.keyWindow === analysisWindow?.window }
    @objc private func openFile() {
        if analysisIsKey { analysisWindow?.chooseImages(); return }
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [UTType(filenameExtension: "sgd") ?? .data]
        panel.message = "选择 GeneSnap / Syngene 胶图文件"
        panel.beginSheetModal(for: window) { result in
            if result == .OK, let url = panel.url { self.load(url) }
        }
    }
    private func load(_ url: URL) {
        loadGeneration += 1; let ticket = loadGeneration
        status.stringValue = "正在读取 \(url.lastPathComponent)…"
        DispatchQueue.global(qos: .userInitiated).async {
            let result = Result { try GelImage(url: url) }
            DispatchQueue.main.async {
                guard ticket == self.loadGeneration else { return }
                switch result {
                case .success(let image):
                    self.gel = image; self.fileURL = url
                    self.window.title = "\(url.lastPathComponent) — SGD 胶图查看器"
                    self.window.representedURL = url
                    self.info.stringValue = "\(image.width) × \(image.height) px\n16 位灰度存储\n像素范围：\(image.minimum) – \(image.maximum)"
                    self.details.string = image.capture
                    let scale = Double(max(image.maximum, 255))
                    self.lowSlider.maxValue = scale - 1; self.highSlider.maxValue = scale
                    self.angle = 0; self.fitMode = true
                    self.invert.state = .off; self.flip.state = .off; self.gammaSlider.doubleValue = 1
                    let (low, high) = image.autoLevels
                    self.lowSlider.doubleValue = Double(low); self.highSlider.doubleValue = Double(high)
                    self.setControlsEnabled(true); self.updateFields(); self.scheduleRender()
                    NSDocumentController.shared.noteNewRecentDocumentURL(url)
                case .failure(let error): self.showError(error)
                }
            }
        }
    }
    @objc private func levelSliderChanged(_ sender: NSSlider) {
        if lowSlider.intValue >= highSlider.intValue {
            if sender === lowSlider { highSlider.doubleValue = lowSlider.doubleValue + 1 }
            else { lowSlider.doubleValue = highSlider.doubleValue - 1 }
        }
        adjust()
    }
    @objc private func levelFieldChanged(_ sender: NSTextField) {
        guard let value = Int(sender.stringValue) else { updateFields(); return }
        if sender === lowField {
            lowSlider.doubleValue = Double(min(max(0, value), Int(highSlider.intValue) - 1))
        } else {
            highSlider.doubleValue = Double(min(Int(highSlider.maxValue), max(Int(lowSlider.intValue) + 1, value)))
        }
        adjust()
    }
    @objc private func adjust() { updateFields(); scheduleRender() }
    private func updateFields() {
        lowField.stringValue = "\(lowSlider.intValue)"; highField.stringValue = "\(highSlider.intValue)"
        gammaValue.stringValue = String(format: "%.2f", gammaSlider.doubleValue)
        angleField.stringValue = String(format: "%.2f", angle); angleSlider.doubleValue = angle
    }
    @objc private func autoContrast() {
        guard let gel else { return }
        let (low, high) = gel.autoLevels
        lowSlider.doubleValue = Double(low); highSlider.doubleValue = Double(high)
        gammaSlider.doubleValue = 1; adjust()
    }
    @objc private func reset() {
        guard let gel else { return }
        lowSlider.doubleValue = Double(gel.minimum); highSlider.doubleValue = Double(max(gel.minimum + 1, gel.maximum))
        gammaSlider.doubleValue = 1; invert.state = .off; flip.state = .off; angle = 0; fitMode = true
        adjust()
    }
    private func setAngle(_ value: Double) {
        guard value.isFinite else { updateFields(); return }
        angle = value.truncatingRemainder(dividingBy: 360)
        angle = (angle * 100).rounded() / 100
        if angle > 180 { angle -= 360 }; if angle < -180 { angle += 360 }
        fitMode = true; adjust()
    }
    @objc private func rotate() { if analysisIsKey { analysisWindow?.viewerCommand("right"); return }; setAngle(angle + 90) }
    @objc private func rotateLeft() { if analysisIsKey { analysisWindow?.viewerCommand("left"); return }; setAngle(angle - 90) }
    @objc private func clearAngle() { setAngle(0) }
    @objc private func angleMoved() { setAngle(angleSlider.doubleValue) }
    @objc private func angleEntered() {
        guard let value = Double(angleField.stringValue), value.isFinite else { updateFields(); return }
        setAngle(value)
    }
    @objc private func saveExperiment() { analysisWindow?.projectCommand("save") }
    @objc private func saveExperimentAs() { analysisWindow?.projectCommand("saveAs") }
    @objc private func undoExperiment() { analysisWindow?.projectCommand("undo") }
    @objc private func redoExperiment() { analysisWindow?.projectCommand("redo") }
    @objc private func openBatch() { analysisWindow?.requestBatch() }
    private func presentBatch(_ current: [String: Any]) {
        guard batchSheet == nil else { return }
        let parent = NSApp.keyWindow ?? window!
        parent.makeFirstResponder(nil)
        let picker = NSOpenPanel(); picker.canChooseDirectories = false; picker.allowsMultipleSelection = true
        picker.allowedContentTypes = [UTType(filenameExtension: "sgd") ?? .data]
        picker.message = "选择多张 SGD 胶图进行批量处理"; picker.prompt = "下一步"
        picker.beginSheetModal(for: parent) { [self] response in
            guard response == .OK, !picker.urls.isEmpty else { return }
            let settings = DisplaySettings(low: current["low"] as? Int ?? 0, high: current["high"] as? Int ?? 65535,
                                           gamma: current["gamma"] as? Double ?? 1, inverted: current["inverted"] as? Bool ?? false,
                                           flipY: false, angle: current["angle"] as? Double ?? 0)
            let sheet = BatchSheet(inputs: picker.urls, settings: settings, hasCurrentImage: current["high"] != nil)
            sheet.onClose = { [weak self] in self?.batchSheet = nil }
            self.batchSheet = sheet; sheet.present(on: parent)
        }
    }
    private func scheduleRender() {
        guard let gel else { return }
        generation += 1; let ticket = generation
        renderWork?.cancel()
        let low = Int(lowSlider.intValue), high = Int(highSlider.intValue), gamma = gammaSlider.doubleValue
        let inverted = invert.state == .on, flipY = flip.state == .on, rotation = angle
        // Prevent exporting a stale preview while a new one is rendering.
        currentPreview = nil
        previewButton?.isEnabled = false
        status.stringValue = "正在更新预览…"
        let work = DispatchWorkItem { [weak self] in
            let result = Result { try gel.preview(low: low, high: high, gamma: gamma, inverted: inverted, flipY: flipY, angle: rotation) }
            DispatchQueue.main.async {
                guard let self, ticket == self.generation else { return }
                switch result {
                case .success(let image):
                    self.currentPreview = image
                    self.previewButton?.isEnabled = true
                    self.canvas.imageSize = NSSize(width: image.width, height: image.height)
                    self.canvas.image = NSImage(cgImage: image, size: self.canvas.imageSize)
                    self.layoutCanvas()
                case .failure(let error): self.showError(error)
                }
            }
        }
        renderWork = work; renderQueue.asyncAfter(deadline: .now() + 0.08, execute: work)
    }
    @objc private func resized() { layoutCanvas() }
    private func layoutCanvas() {
        let viewport = scroll.contentSize, size = canvas.imageSize
        if fitMode, size.width > 0, size.height > 0 {
            canvas.zoom = max(0.01, min((viewport.width - 16) / size.width, (viewport.height - 16) / size.height))
        }
        canvas.setFrameSize(NSSize(width: max(viewport.width, size.width * canvas.zoom),
                                   height: max(viewport.height, size.height * canvas.zoom)))
        canvas.needsDisplay = true
        if let url = fileURL {
            status.stringValue = "\(url.lastPathComponent)  ·  \(Int((canvas.zoom * 100).rounded()))%  ·  当前为显示预览；原始 TIFF 保留 16 位像素"
        }
    }
    @objc private func fit() { if analysisIsKey { analysisWindow?.viewerCommand("fit"); return }; fitMode = true; layoutCanvas(); canvas.scroll(.zero) }
    @objc private func actualSize() { if analysisIsKey { analysisWindow?.viewerCommand("actual"); return }; fitMode = false; canvas.zoom = 1; layoutCanvas() }
    @objc private func zoomIn() { if analysisIsKey { analysisWindow?.viewerCommand("plus"); return }; fitMode = false; canvas.zoom = min(8, canvas.zoom * 1.25); layoutCanvas() }
    @objc private func zoomOut() { if analysisIsKey { analysisWindow?.viewerCommand("minus"); return }; fitMode = false; canvas.zoom = max(0.05, canvas.zoom / 1.25); layoutCanvas() }
    @objc private func exportPreview() {
        guard let image = currentPreview else { return }
        export(image, type: .png, suffix: "_preview")
    }
    @objc private func exportOriginal() {
        guard let gel else { return }
        do { export(try gel.originalCGImage(), type: .tiff, suffix: "_raw16") }
        catch { showError(error) }
    }
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(exportPreview) { return !analysisIsKey && currentPreview != nil }
        if menuItem.action == #selector(exportOriginal) { return !analysisIsKey && gel != nil }
        if [#selector(fit), #selector(actualSize), #selector(zoomIn), #selector(zoomOut), #selector(rotate), #selector(rotateLeft)].contains(menuItem.action) {
            return analysisIsKey || gel != nil
        }
        return true
    }
    private func export(_ image: CGImage, type: UTType, suffix: String) {
        let panel = NSSavePanel(); panel.allowedContentTypes = [type]
        let stem = fileURL?.deletingPathExtension().lastPathComponent ?? "gel"
        panel.nameFieldStringValue = stem + suffix + (type == .png ? ".png" : ".tif")
        panel.message = type == .png ? "导出当前显示效果（8 位 PNG）。" : "导出原始 16 位灰度像素，不应用显示调整或旋转。"
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { return }
            if let source = self.fileURL, url.standardizedFileURL == source.standardizedFileURL {
                self.showError(ViewerError.invalid("请选择新的导出文件名。")); return
            }
            do {
                try GelImage.save(image, to: url, type: type)
                self.status.stringValue = "已导出：\(url.path)"
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } catch { self.showError(error) }
        }
    }
    private func showError(_ error: Error) {
        status.stringValue = error.localizedDescription
        let alert = NSAlert(); alert.messageText = "无法完成操作"; alert.informativeText = error.localizedDescription
        alert.alertStyle = .warning; presentWorkspaceNotice(alert)
    }
    // The legacy canvas window is retained only for the batch/export backend.
    // Presenting a sheet on it would make that hidden window appear.
    private func presentWorkspaceNotice(_ alert: NSAlert) {
        if let parent = analysisWindow?.window {
            guard parent.attachedSheet == nil else { return }
            alert.beginSheetModal(for: parent)
        } else {
            alert.runModal()
        }
    }
    @objc private func about() {
        if let analysisWindow { analysisWindow.showAbout(); return }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let alert = NSAlert(); alert.messageText = "胶个朋友 \(version)"
        alert.informativeText = "胶图查看、泳道条带、Marker 标定、定量与批量处理。\n全部数据在本机处理，原始像素随项目保留。\n独立研究辅助软件；定量结果需人工核对。"
        alert.addButton(withTitle: "好")
        presentWorkspaceNotice(alert)
    }
}

import AppKit
import UniformTypeIdentifiers

final class BatchSheet: NSObject {
    private let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 670, height: 720),
                                styleMask: [.titled], backing: .buffered, defer: false)
    private let inputs: [URL]
    private var settings: DisplaySettings
    private let hasCurrentImage: Bool
    private let format = NSPopUpButton()
    private let levels = NSPopUpButton()
    private let angle = NSTextField(string: "0")
    private let directoryLabel = NSTextField(wrappingLabelWithString: "请选择导出文件夹")
    private let progress = NSProgressIndicator()
    private let message = NSTextField(wrappingLabelWithString: "每次导出创建一个新文件夹，并附上处理结果 CSV。")
    private let log = NSTextView()
    private let start = NSButton(title: "开始批量导出", target: nil, action: nil)
    private let cancel = NSButton(title: "取消", target: nil, action: nil)
    private let choose = NSButton(title: "选择导出文件夹…", target: nil, action: nil)
    private let reveal = NSButton(title: "查看导出结果", target: nil, action: nil)
    private var parent: URL?
    private var result: BatchResult?
    private let cancellation = BatchCancellation()
    private(set) var running = false
    var onClose: (() -> Void)?

    init(inputs: [URL], settings: DisplaySettings, hasCurrentImage: Bool) {
        self.inputs = inputs; self.settings = settings; self.hasCurrentImage = hasCurrentImage
        super.init(); build()
    }
    func present(on window: NSWindow) { window.beginSheet(panel) }
    func stop() {
        cancellation.cancel(); cancel.isEnabled = false
        message.stringValue = "正在停止，等待当前文件处理完成…"
    }
    private func build() {
        panel.title = "批量处理胶图"; panel.appearance = NSAppearance(named: .aqua); panel.backgroundColor = Theme.paper
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false; panel.contentView!.addSubview(stack)
        let heading = NSTextField(labelWithString: "批量处理 · \(inputs.count) 张胶图")
        heading.font = Theme.heading(22); heading.textColor = Theme.ink; stack.addArrangedSubview(heading)
        let fileList = inputs.map(\.lastPathComponent).joined(separator: "\n")
        let note = NSTextField(wrappingLabelWithString: "统一导出 PNG 与原始 TIFF，保留逐文件处理记录。")
        note.textColor = Theme.muted; stack.addArrangedSubview(note)
        format.addItems(withTitles: ["PNG 预览图", "原始 16 位 TIFF", "PNG + 原始 16 位 TIFF"])
        format.selectItem(at: 2); format.target = self; format.action = #selector(formatChanged)
        levels.addItems(withTitles: ["每张图分别自动对比度", "沿用当前胶图的黑场 / 白场", "每张图使用完整像素范围"])
        if !hasCurrentImage { levels.item(at: 1)?.isEnabled = false }
        angle.stringValue = String(format: "%.2f", settings.angle)
        angle.widthAnchor.constraint(equalToConstant: 90).isActive = true; Theme.field(angle)
        func row(_ label: String, _ view: NSView) {
            let title = NSTextField(labelWithString: label); title.textColor = Theme.ink
            title.widthAnchor.constraint(equalToConstant: 90).isActive = true
            let line = NSStackView(views: [title, view]); line.orientation = .horizontal; line.spacing = 12
            stack.addArrangedSubview(line)
        }
        row("导出格式", format); row("PNG 对比度", levels); row("顺时针角度 °", angle)
        let explanation = NSTextField(wrappingLabelWithString:
            "PNG 应用旋转、Gamma \(String(format: "%.2f", settings.gamma))、\(settings.inverted ? "反相" : "不反相")、\(settings.flipY ? "上下翻转" : "不翻转")。自由旋转使用插值并扩展画布。原始 TIFF 保留原始方向与像素值。")
        explanation.font = .systemFont(ofSize: 12); explanation.textColor = Theme.muted
        stack.addArrangedSubview(explanation)
        choose.target = self; choose.action = #selector(selectDirectory); Theme.style(choose)
        stack.addArrangedSubview(choose)
        directoryLabel.font = .systemFont(ofSize: 11); directoryLabel.textColor = Theme.muted
        directoryLabel.lineBreakMode = .byTruncatingMiddle; stack.addArrangedSubview(directoryLabel)
        progress.isIndeterminate = false; progress.minValue = 0; progress.maxValue = Double(inputs.count)
        progress.style = .bar; stack.addArrangedSubview(progress)
        message.font = .systemFont(ofSize: 12); message.textColor = Theme.ink; stack.addArrangedSubview(message)
        log.isEditable = false; log.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        log.backgroundColor = Theme.surface; log.textColor = Theme.ink; log.string = fileList
        log.textContainerInset = NSSize(width: 8, height: 8)
        log.isVerticallyResizable = true; log.isHorizontallyResizable = false
        log.autoresizingMask = [.width]; log.textContainer?.widthTracksTextView = true
        let logScroll = NSScrollView(); logScroll.documentView = log; logScroll.hasVerticalScroller = true
        logScroll.borderType = .bezelBorder; stack.addArrangedSubview(logScroll)
        start.target = self; start.action = #selector(begin); start.isEnabled = false; Theme.style(start, prominent: true)
        cancel.target = self; cancel.action = #selector(cancelOrClose); Theme.style(cancel)
        reveal.target = self; reveal.action = #selector(showResults); reveal.isHidden = true; Theme.style(reveal)
        let actions = NSStackView(views: [reveal, cancel, start]); actions.orientation = .horizontal; actions.spacing = 10
        stack.addArrangedSubview(actions)
        for view in [note, explanation, directoryLabel, progress, message, logScroll] as [NSView] {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: panel.contentView!.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: panel.contentView!.bottomAnchor, constant: -22),
            logScroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 110)
        ])
    }
    @objc private func formatChanged() {
        let png = format.indexOfSelectedItem != 1
        levels.isEnabled = png; angle.isEnabled = png
    }
    @objc private func selectDirectory() {
        let picker = NSOpenPanel(); picker.canChooseDirectories = true; picker.canChooseFiles = false
        picker.canCreateDirectories = true; picker.prompt = "选择导出位置"
        picker.beginSheetModal(for: panel) { response in
            if response == .OK, let url = picker.url {
                self.parent = url; self.directoryLabel.stringValue = url.path; self.start.isEnabled = true
            }
        }
    }
    @objc private func begin() {
        guard let parent, let value = Double(angle.stringValue), value.isFinite else {
            message.stringValue = "请输入有效的旋转角度。"; return
        }
        settings.angle = value
        let options = BatchOptions(format: BatchOptions.Format(rawValue: format.indexOfSelectedItem) ?? .both,
                                   levels: BatchOptions.Levels(rawValue: levels.indexOfSelectedItem) ?? .automatic,
                                   display: settings)
        running = true; start.isEnabled = false; choose.isEnabled = false; format.isEnabled = false
        levels.isEnabled = false; angle.isEnabled = false; cancel.title = "停止处理"
        log.string = ""; message.stringValue = "准备开始…"
        DispatchQueue.global(qos: .userInitiated).async {
            let outcome = Result { try BatchProcessor.run(inputs: self.inputs, parent: parent, options: options,
                                                          cancellation: self.cancellation) { count, text in
                DispatchQueue.main.async {
                    self.progress.doubleValue = Double(count)
                    if !self.cancellation.isCancelled { self.message.stringValue = text }
                }
            } }
            DispatchQueue.main.async {
                self.running = false; self.cancel.isEnabled = true; self.cancel.title = "关闭"
                switch outcome {
                case .success(let result):
                    self.result = result; self.reveal.isHidden = false
                    self.message.stringValue = "处理结束：成功 \(result.succeeded)，失败 \(result.failed)，取消 \(result.cancelled)。"
                    self.directoryLabel.stringValue = result.directory.path
                    self.log.string = result.records.map {
                        "\($0.status) · \($0.input.lastPathComponent)" + ($0.message.isEmpty ? "" : "\n  " + $0.message)
                    }.joined(separator: "\n")
                    if let warning = result.reportError { self.log.string += "\n处理记录保存失败：" + warning }
                case .failure(let error): self.message.stringValue = error.localizedDescription
                }
            }
        }
    }
    @objc private func cancelOrClose() {
        if running { stop(); return }
        panel.sheetParent?.endSheet(panel); panel.orderOut(nil); onClose?()
    }
    @objc private func showResults() {
        if let result { NSWorkspace.shared.open(result.directory) }
    }
}

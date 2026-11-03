# GelFriend 2.4.0 · Agent 接口

胶个朋友提供本机 API、命令行工具和 MCP stdio 适配器。Agent 操作当前打开的工作区，界面同步显示结果，使用与手工操作相同的校验、积分算法、结果依赖与撤销机制。

## 开启与接入

1. 打开 `GelFriend-v2.4.0.app`。
2. 在 macOS 顶部菜单选择 **Agent → 开启本机 Agent 接口**。窗口顶部出现开启提示；同一菜单随时关闭。
3. 在支持本机 MCP stdio 服务的 Agent 客户端中添加下方配置，把路径替换成实际安装位置。

```json
{
  "mcpServers": {
    "gelfriend": {
      "command": "/实际安装目录/GelFriend-v2.4.0.app/Contents/MacOS/gelfriend-agent",
      "args": ["--stdio"]
    }
  }
}
```

不同客户端的配置入口与外层字段可能不同；这里提供通用 `mcpServers` 示例，软件不会自动修改你的客户端设置。普通云端 ChatGPT 对话不能直接启动本机 stdio 进程，需要客户端自身提供本机工具连接能力。没有本机能力的远程服务需要另外的桥接；本版没有开放公网服务。

接口每次启动默认关闭，不持久保存开启状态。也可通过 LaunchServices 启动：`open -a "/实际安装目录/GelFriend-v2.4.0.app" --args --agent`。如果软件已经运行，请使用菜单开关。自定义 socket 时，应用进程与 CLI 均需设置 `GELFRIEND_AGENT_SOCKET`，或者 CLI 使用 `--socket /绝对路径/agent.sock`。父目录须属于当前用户且权限为 0700。

## 命令行

工具位于 `.app/Contents/MacOS/gelfriend-agent`，无需另装 Python、Node 或服务。以下是终端示例；路径含空格时保留引号：

```sh
GF_AGENT="/实际安装目录/GelFriend-v2.4.0.app/Contents/MacOS/gelfriend-agent"
"$GF_AGENT" describe
"$GF_AGENT" state
"$GF_AGENT" call markers.list '{}'
"$GF_AGENT" call results.read '{"offset":0,"limit":200}'
```

`describe` 可离线读取接口清单；其他命令需要应用开启接口。命令行输出 JSON，API 错误时返回非零退出码。`Agent/example.py` 是可选的 Python 标准库示例，演示读取上下文、打开图像、导出显示图和另存项目；Python 只用于运行这个示例，不是应用或 MCP 的依赖。

## 每次修改前，读取当前上下文

先调用 `workspace.state`，从响应的 `result` 读取 `documentId` 和 `revision`。每个写方法都必须带：

```json
{
  "expectedDocumentId": "刚刚读取的 documentId",
  "expectedRevision": 12,
  "angle": 3
}
```

这份参数用于 `view.set`，其中 12 只是示例，应替换为刚读到的 `revision`。每次写完重新读状态，再准备下一次修改。打开文档需要同样的两个字段，即使当前还是首页。

上下文版本包含项目编辑、通道、泳道、步骤与 Marker 库变化。你在界面切换通道后，Agent 不能按旧选择继续修改。`documentRevision` 是用于项目保存回执的另一计数器，不能拿它替代 `expectedRevision`。`STALE_CONTEXT` 表示需要重新读取并评估意图，不能简单地把新版本号填进去盲目重放。

## 可用操作（API 1.0，共 28 个）

精确字段、必填项、类型和枚举见随包的 `Agent/api.json`，也可调用 `system.describe`。MCP 工具名使用 `gelfriend_` 前缀，点号替换为下划线，例如 `gelfriend_document_preview`。

| 用途 | 方法 |
| --- | --- |
| 发现能力、当前步骤和问题 | `system.describe`、`workspace.state` |
| 查看胶图 | `document.preview`，MCP 返回图片内容块；最长边不超过 1600 像素 |
| 打开、保存、导出 | `document.open`、`document.save`、`document.exportImage`、`document.exportReport` |
| 显示与上下文 | `view.set`（旋转、反相、黑白点、Gamma）、`selection.set`、`workflow.go` |
| 泳道 | `lanes.create`、`lanes.update`、`lanes.delete`、`lanes.setMarker`、`lanes.confirm` |
| 条带 | `bands.detect`、`bands.upsert`、`bands.delete` |
| 标准与标定 | `markers.list`、`markers.create`、`markers.pair`、`calibration.fitSize`、`calibration.fitQuantity` |
| Western | `western.normalise`（明确目标、内参、参考样本与位置核对） |
| 数值与曲线 | `results.read`、`profile.read` |
| 纠正编辑 | `history.undo`、`history.redo` |

`workspace.state` 不返回完整原始像素，但包含尺寸、位深、通道、显示参数、泳道、条带数、允许步骤、未保存状态与问题清单。问题最多返回 200 条，并提供总数与截断标志。`results.read` 默认每页 200 条，最多 1000 条，用 `nextOffset` 继续读；曲线返回原始强度、背景和净值数组。

## 推荐流程

1. 读状态并检查未保存内容。使用 `document.open` 打开绝对本机路径；原图指定 `experiment`：`dna`、`protein`、`western`、`colony` 或 `spots`。已有项目恢复自己的实验类型，缺少类型的旧项目需要显式指定。
2. 用 `document.preview` 看图，用 `view.set` 调整显示；显示旋转、反相与 Gamma 不改原始积分。
3. 用原始像素坐标创建泳道，或读取已有泳道并修改。选择泳道 Marker 后调用 `lanes.confirm` 进入核对条带。
4. 用 `bands.detect` 生成候选，再通过曲线数值和预览检查，使用 `bands.upsert` / `bands.delete` 修改。自动候选不能冒充人工核对。
5. 大小标定先 `markers.list`，选择用户明确指定的标准，逐带 `markers.pair` 后 `calibration.fitSize`。不要根据文件名猜标准值。缺失标准可 `skip:true`，排除对应可 `bandId:null`。
6. 已知量标定使用独立的真实标准值调用 `calibration.fitQuantity`；Western 明确实际目标与内参条带，按工作区要求核对多通道位置。
7. 读结果与问题清单，保存新 `.gelproject`，导出 PNG 或报告。报告继续携带草稿、待更新与人工核对状态。

界面规定的步骤约束仍然生效，例如未确认泳道不能开始条带检测。API 不提供设置“本泳道已人工核对”的方法。实验记录中保留 Agent 来源和请求标识；撤销历史仍受当前会话已有的数量/内存上限约束。

## 坐标与预览

新建泳道没有 `frame`，`xTop`、`xBottom`、`y0`、`y1`、`width` 均为原图像素；原点左上、x 向右、y 向下。`xTop` / `xBottom` 是泳道在起止位置的中心，允许倾斜；高度至少 4 像素、宽度至少 2 像素，框必须在原图内。

界面旋转后建立的已有泳道可能带 `frame`。更新时沿用该 frame，条带的 `y0` / `y1` 和曲线 y 坐标也在泳道 frame 内。`frame` 的 `sourceWidth` / `sourceHeight` 是原图尺寸，`width` / `height` 是该角度包围框，`angle` 为顺时针显示角。弯曲中心线泳道可查看，但本版 API 不直接修改其几何，需在界面调整。

预览是整张胶图的显示栅格，不是当前窗口裁剪。响应含 `transform`：原图宽高、旋转后的显示宽高、角度和两个缩放系数。将预览坐标 `(u,v)` 转回原图：先令 `dx=u/scaleX-displayWidth/2`、`dy=v/scaleY-displayHeight/2`，再计算 `x=dx*cosθ+dy*sinθ+rawWidth/2`、`y=-dx*sinθ+dy*cosθ+rawHeight/2`；θ 为 `angleDegrees` 转弧度。超出原图的旋转边角为空白，不应拿来创建泳道。

`document.preview` / PNG 导出是显示图，可能有旋转透明边角，不是原始定量输入。要保留原始像素及分析配置，应保存 `.gelproject`。定量导入仍拒绝半透明原始图像。

## 文件、错误与范围

- 所有文件路径为绝对路径。保存扩展名为 `.gelproject`，图像导出为 `.png`。报告写到指定已存在目录下的新建唯一子目录。
- 默认不覆盖输出文件；确需替换才显式 `overwrite:true`。已读取的原始图像路径受保护，不能用导出覆盖。输入项目另存与原位覆盖仍由调用者决定。
- 替换未保存实验需先保存，或明确 `discardChanges:true`。替换泳道需 `replaceExisting:true`；重识别覆盖手工条带需 `replaceManual:true`。这些标志应来自用户对相应操作的授权。
- `BUSY` / `NOT_READY`：等当前文件操作、拖动、待提交输入或弹层结束，重新读状态。`WRONG_STEP` / `WRONG_EXPERIMENT`：读取步骤和实验类型，按正常动线操作。
- `INVALID_PARAMS` / `VALIDATION_ERROR`：参数或科学校验失败，按具体错误修正；失败不应当成成功继续处理。`UNSAVED_CHANGES`、`MANUAL_BANDS`、`EXISTING_LANES` 是需要明确替换意图的保护。
- `OPERATION_TIMEOUT` / `IO_TIMEOUT` / 连接中断：写入状态可能未知，先读取状态及文件，禁止自动重复写入。
- 默认 socket 为 `/tmp/gelfriend-<uid>/agent.sock`。目录 0700、socket 0600，并核对对端同一 UID。没有公网端口、认证令牌或任意代码执行接口；开启后，同一用户运行的本机进程均可请求允许的方法。
- 每请求上限 1 MiB、响应上限 16 MiB、连接槽位 8、单操作等待上限 90 秒。原生工作区串行接受操作，忙时返回错误。JSON-RPC 每连接一条换行分隔请求/响应；MCP stdio 支持持续换行消息、初始化、工具发现与调用。
- MCP 支持 `2024-11-05`、`2025-03-26`、`2025-06-18` 协议版本，工具失败返回 `isError:true`；支持图片的客户端可直接查看预览。协议对应 [stdio 传输](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) 与 [工具调用](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)。

本机应用本身不上传数据。接入外部模型后，客户端可能按其配置把预览、元数据和结果发送给模型服务；选择接入方时应了解其数据设置。此版本没有无人值守的独立计算引擎、菌落/斑点区域编辑 API、批量分析模板 API 或自动跨图配准。

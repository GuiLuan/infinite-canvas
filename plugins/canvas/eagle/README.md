# Eagle 资源插件

Eagle 节点使用 Item ID 引用资源，图片由 Eagle Agent 在运行时读取并通过 HTTP 返回。

开发时可以把构建产物加入 `VITE_DEV_PLUGINS`：

```env
VITE_DEV_PLUGINS=/plugins/eagle.js
```

插件需要 Eagle Agent 正常运行。节点面板支持粘贴 `http://localhost:41595/item?id=...`、`eagle://item/...` 或裸 Item ID，并可同步描述、标签和当前画布节点链接。

在「节点插件 → Eagle 资源 → 设置」中统一填写 Agent 地址、Agent Token 和 Eagle API Token，点击「保存并检查连接」。连接成功后保存在当前浏览器站点中，所有画布的 Eagle 节点与图片同步共用这份设置。已有节点的原图地址和 Eagle 生成历史会随配置更新。

Eagle API Token 留空时，Agent 使用容器环境变量 `EAGLE_API_TOKEN`。节点面板用于编辑 Item 链接、描述、标签和来源 URL。

启用插件并连接 Agent 后，可从 Eagle 拖入图片、复制图片后在画布粘贴，或直接粘贴 Eagle 的 HTTP Item 链接与资源库原图 `file:///` 链接。节点使用原 Item 的原图引用。

Eagle 原生拖放和复制仅提供文件时，Agent 按文件名与大小查询候选，浏览器再核对原图内容，优先匹配 Eagle 当前选中项。同组候选有多个相同内容 Item 时，界面会提示使用具体 Item 链接。未匹配的文件按普通本地图片导入。插件启用期间需保持 Agent 可连接，以完成文件识别。

# Eagle 资源插件

Eagle 节点只保存 Item ID 和 Agent 地址，图片由 Eagle Agent 在运行时读取并通过 HTTP 返回。

开发时可以把构建产物加入 `VITE_DEV_PLUGINS`：

```env
VITE_DEV_PLUGINS=/plugins/eagle.js
```

插件需要 Eagle Agent 正常运行。节点面板支持粘贴 `http://localhost:41595/item?id=...`、`eagle://item/...` 或裸 Item ID，并可同步描述、标签和当前画布节点链接。

# Eagle Agent

Eagle Agent 是 Infinite Canvas 的本地桥接服务。它负责访问 Eagle Web API，并把 Eagle 返回的本地缩略图路径转换成浏览器可以读取的 HTTP 图片响应。

## 本地运行

```bash
npm install
npm start
```

默认监听 `http://127.0.0.1:23211`，Eagle API 默认使用 `http://127.0.0.1:41595`。

## Docker Compose

Docker 容器需要访问 Eagle 资源库目录。Windows Docker Desktop 可以在 `.env` 中配置：

```env
EAGLE_LIBRARY_HOST_PATH=E:/EagleData
EAGLE_PATH_REWRITE_FROM=E:\\EagleData
EAGLE_PATH_REWRITE_TO=/eagle-data
EAGLE_LIBRARY_ROOT=/eagle-data
```

然后执行：

```bash
docker compose up -d --build
```

画布插件默认检查 `http://127.0.0.1:23211/health`。如果服务未启动，会显示启动提示，而不会把 Eagle 节点标记为损坏。

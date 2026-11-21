# Eagle Agent

Eagle Agent 是 Infinite Canvas 的本地桥接服务。它负责访问 Eagle Web API，并将资源库中的原图和缩略图提供给浏览器。

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

从 Eagle 打开画布节点链接时，如果系统浏览器没有对应的本地画布，页面会通过 Eagle Agent 将定位请求交给已打开且保存了该画布的页面。需要保持 Eagle Agent 和该页面运行。

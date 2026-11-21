# Eagle Agent

Eagle Agent 是 Infinite Canvas 的本地桥接服务。它负责访问 Eagle Web API，并将资源库中的原图和缩略图提供给浏览器。

## Docker Compose

在项目根目录将 `.env.example` 复制为 `.env`，按实际位置填写 Eagle 资源库的父目录。

```env
EAGLE_LIBRARY_HOST_PATH=E:/EagleData
COMPOSE_PROFILES=eagle
EAGLE_PATH_REWRITE_FROM=E:/EagleData
EAGLE_PATH_REWRITE_TO=/eagle-data
EAGLE_LIBRARY_ROOT=/eagle-data
```

本地构建部署使用以下命令，Eagle Agent 与前端、代理由同一个 Compose 项目管理。

```bash
docker compose -f docker-compose.local.yml up -d --build
```

使用根目录的 `docker-compose.yml` 部署时，可以执行 `docker compose --profile eagle up -d --build eagle-agent`。子目录的 Compose 文件也支持单独部署。

容器通过 `host.docker.internal:41595` 访问 Eagle，资源库只读挂载到 `/eagle-data`。插件从浏览器访问映射出的 `http://127.0.0.1:23211`，Agent 随容器自动重启。

## 连接设置

在画布「节点插件 → Eagle 资源 → 设置」中填写「Eagle API Token」，点击「保存并检查连接」。Token 可以从 Eagle 的「偏好设置 → 开发者选项」获取。连接成功后保存的配置供当前浏览器站点内所有画布的 Eagle 节点和新图片同步使用。

「Eagle API Token」用于 Agent 访问 Eagle。「Agent Token」用于浏览器访问启用了认证的 Agent，可与 `EAGLE_AGENT_TOKEN` 环境变量配合使用。插件连接配置保存在当前浏览器中。

也可以在本机 `.env` 中设置 `EAGLE_API_TOKEN` 作为容器的默认值。插件传入的 Token 优先使用。`.env` 已由 Git 忽略。

插件通过 `/health` 检查连接，认证失败时提示填写或检查 Eagle API Token。

`POST /items/candidates` 接收文件名和大小，通过 Eagle 官方 `/api/v2/item/get` 查询当前选中项与同名候选，供画布拖放和粘贴时核对原图内容。此过程只读取已有 Item。

从 Eagle 打开画布节点链接时，如果系统浏览器没有对应的本地画布，页面会通过 Eagle Agent 将定位请求交给已打开且保存了该画布的页面。需要保持 Eagle Agent 和该页面运行。

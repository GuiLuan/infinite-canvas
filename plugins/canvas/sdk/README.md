# @infinite-canvas/plugin-sdk

Infinite Canvas 画布节点插件的 **TypeScript SDK**。插件作者只写节点 UI 与逻辑,类型、JSX、运行时桥接、构建全部由 SDK 提供;产物仍是宿主加载器现有契约的 ESM(React external,宿主单例)。

## 提供什么

| 能力 | 说明 |
| --- | --- |
| **完整类型** | `CanvasPlugin` / `CanvasNodeDefinition` / `CanvasNodeContext` / `CanvasAgentOp` / `CanvasTheme` / `CanvasNodeData` … 全部有提示 |
| `definePlugin(...)` | 给插件对象(或工厂)补全类型;对象形式无需再 `const { React } = runtime` |
| automatic JSX | `jsxImportSource` 指向本包,TSX 自动转发到宿主 React,**不打包第二份 React** |
| 类型化 hooks | `import { useState, useEffect, useMemo, useRef, ... }`,运行时转发宿主 React |
| `buildPlugin(...)` | 统一 esbuild 构建,插件 `build.mjs` 只需一行 |

## 最小插件

```tsx
// src/index.tsx
import { definePlugin, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

function Content({ ctx }: CanvasNodeContentProps) {
    const [n, setN] = useState(0);
    return (
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setN((v) => v + 1)} style={{ color: ctx.theme.node.text }}>
            {ctx.node.title}: {n}
        </button>
    );
}

export default definePlugin({
    id: "my-plugin",
    name: "我的插件",
    version: "1.0.0",
    nodes: [
        {
            type: "my-plugin:node",
            title: "示例",
            icon: "✨",
            defaultSize: { width: 240, height: 160 },
            Content,
        },
    ],
});
```

```js
// build.mjs
import { buildPlugin } from "@infinite-canvas/plugin-sdk/build";
await buildPlugin(import.meta.url);
```

`npm run build` 产出 `dist/<目录名>.js` 并同步到 `web/public/plugins/`。

## 依赖接入

插件 `package.json`:

```json
{
    "type": "module",
    "scripts": { "build": "node build.mjs", "dev": "node build.mjs --watch", "typecheck": "tsc --noEmit" },
    "devDependencies": {
        "@infinite-canvas/plugin-sdk": "file:../sdk",
        "@types/react": "19.1.12",
        "typescript": "^5"
    }
}
```

插件 `tsconfig.json` 关键项:`"jsx": "react-jsx"`、`"jsxImportSource": "@infinite-canvas/plugin-sdk"`、`"moduleResolution": "bundler"`。

## 插件设置

插件可提供可选的 `Settings` 组件，宿主在「节点插件」中显示「设置」入口。组件接收 `CanvasPluginSettingsProps`，其中 `theme` 提供当前画布主题，`onClose` 用于关闭设置窗口。连接参数等小配置可保存在当前浏览器站点的 `localStorage` 中。

```tsx
import type { CanvasPluginSettingsProps } from "@infinite-canvas/plugin-sdk";

function Settings({ theme, onClose }: CanvasPluginSettingsProps) {
    return <button onClick={onClose} style={{ color: theme.node.text }}>关闭设置</button>;
}

// 将 Settings 添加到 definePlugin({ id, name, version, nodes, Settings }) 中。
```

## 设计约束

- **React 单例**:JSX 与 hooks 惰性读取 `globalThis.InfiniteCanvasRuntime.React`(宿主在加载插件前注入),react 全程 external,绝不打包第二份。
- **重依赖**:three、marked 等在源码里 `await import("https://esm.sh/...")` 动态加载,esbuild 自动 external,不进 bundle。
- **类型真源**:`src/types.ts` 是宿主 `web/src/types/canvas-plugin.ts` 公开契约的镜像;宿主契约变更时同步此处。

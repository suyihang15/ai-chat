# AI 智能对话助手

一个适用于 Chrome 浏览器的 AI 智能对话助手扩展，支持**多厂商 API**（DeepSeek · OpenAI · Claude · Gemini）的通用对话工具。通过侧边栏面板提供智能对话、网页分析和浏览器自动化操作。

---

## ✨ 功能特性

### 🤖 多厂商 AI 支持
- **DeepSeek** — 支持 deepseek-chat、deepseek-reasoner
- **OpenAI** — 支持 GPT-4o、GPT-4o-mini、GPT-4-turbo、o3-mini、o1-mini
- **Anthropic Claude** — 支持 Claude Opus、Sonnet、Haiku 系列
- **Google Gemini** — 支持 Gemini 2.5 Flash/Pro 等
- **🔧 自定义** — 兼容 OpenAI API 格式的自定义端点（如 Ollama、Groq 等）

### 💬 智能对话
- 流式输出，实时显示 AI 回复
- 支持 Markdown 渲染（代码高亮、表格、列表等）
- 思考过程展示（DeepSeek-R1 / Claude reasoning）
- 对话历史保存，刷新不丢失
- `Ctrl+Enter` 发送，`Esc` 停止生成


### ⚡ 浏览器自动化
直接在聊天框输入指令即可操控网页：

| 指令 | 功能 | 示例 |
|------|------|------|
| `click("selector")` | 点击元素 | `click("button.submit")` |
| `fill("selector", "value")` | 填写表单 | `fill("#email", "hello@example.com")` |
| `scroll("selector")` | 滚动到元素 | `scroll("#footer")` |
| `extract("selector")` | 批量提取内容 | `extract(".product-card")` |
| `highlight("selector")` | 高亮元素 | `highlight("a")` |
| `get("selector")` | 查看元素详情 | `get("#main")` |

### 🎨 其他亮点
- API 连接测试功能
- 无需刷新页面即可注入脚本
- Manifest V3，符合 Chrome 最新规范

---

## 📁 项目结构

```
├── manifest.json                # Chrome 扩展配置 (MV3)
├── background/
│   └── service-worker.js        # 后台服务，消息路由 & 脚本注入
├── content/
│   ├── content.js               # 网页分析 & 自动化脚本
│   └── element-picker.js        # 可视元素选择器
├── sidepanel/
│   ├── sidepanel.html           # 侧边栏 UI
│   ├── sidepanel.js             # 侧边栏控制器（聊天/设置/命令解析）
│   └── sidepanel.css            # 样式（暗色/浅色主题）
├── shared/
│   ├── api-client.js            # 多厂商 API 客户端（流式聊天）
│   └── storage-manager.js       # 设置 & 对话历史存储管理
├── lib/
│   ├── purify.min.js            # DOMPurify — HTML/Markdown 安全清洗
│   └── marked.esm.js            # Marked — Markdown 解析
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🚀 安装使用

### 1. 加载扩展
1. 下载或克隆本项目到本地
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角 **「开发者模式」**
4. 点击 **「加载已解压的扩展程序」**
5. 选择项目根目录文件夹

### 2. 配置 API Key
1. 点击浏览器工具栏的扩展图标（或侧边栏自动打开）
2. 点击右上角 **⚙️ 齿轮图标** 打开设置面板
3. 选择 AI 服务商（DeepSeek / OpenAI / Claude / Gemini / 自定义）
4. 填入你的 API Key
5. 可选：调整 Base URL、模型、Temperature
6. 点击 **「💾 保存设置」**
7. 点击 **「🔌 测试连接」** 验证配置

### 3. 开始使用
- 在聊天框输入问题，按 `Ctrl+Enter` 发送

---

## 🔌 支持的 API 厂商

| 厂商 | API Key 获取地址 | 默认模型 |
|------|-----------------|---------|
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/api_keys) | deepseek-chat |
| OpenAI | [platform.openai.com](https://platform.openai.com/api-keys) | gpt-4o |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/settings/keys) | claude-sonnet-4-6 |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) | gemini-2.5-flash |
| 自定义 | 任意 OpenAI 兼容 API | 自行输入 |

---

## 🛠 技术栈

- **Manifest V3** — Service Worker + Side Panel
- **Chrome Extensions API** — `sidePanel`, `storage`, `scripting`, `runtime`
- **Server-Sent Events (SSE)** — 流式读取各厂商 API 响应
- **Marked** — Markdown → HTML 解析
- **DOMPurify** — 防止 XSS 攻击
- **纯原生 JS** — 无框架依赖，轻量高效

---

## 📝 开发说明

### API 客户端架构

所有厂商 API 通过统一的 `api-client.js` 工厂函数 `createAPIClient()` 创建，均暴露相同的接口：

```js
{
  async chat(messages, { onChunk, onComplete, signal }) { ... },
  async testConnection() { ... }
}
```

不同厂商的消息格式转换在模块内部处理：
- **OpenAI 兼容**（DeepSeek/OpenAI/自定义）→ 标准 `/chat/completions` SSE
- **Anthropic** → `/messages` + `x-api-key` header
- **Gemini** → `/models/{model}:streamGenerateContent` + `key` 参数

### 消息路由

```
sidepanel.js → chrome.runtime.sendMessage()
    → service-worker.js (消息路由)
        → content.js (页面分析/自动化)
        → element-picker.js (元素选择)
```

---

## ⚠️ 安全说明

- API Key 存储在 Chrome 本地存储 (`chrome.storage.local`)，不会上传到除对应 API 厂商之外的任何服务器
- 所有 AI 回复均经过 DOMPurify 清洗，防止 XSS
- 仅在用户配置的 API 端点发送请求

---

## 📄 License

MIT

---

## 👤 作者

suyihang15

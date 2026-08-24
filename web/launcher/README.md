# Comfy Studio

手机/平板在局域网内使用 ComfyUI 的移动工作台。手机端直接调用 ComfyUI 原生 API
（`/api/prompt`、`/api/history`、`/api/view`、WebSocket `/ws`）完成生图，AI 助手
由电脑上的 ComfyUI 代理转发到 DeepSeek（SSE 流式响应）。

## 组成

- `custom_nodes/aki_launcher/` — 后端：注册 `/launcher` 路由，提供 AI 聊天代理与预设读写
- `web/launcher/` — 前端：移动端优化的生图 UI（创作 / AI 助手 / 图库 / 预设）
- `mobile-app/` — Capacitor Android 外壳，内嵌 `web/index.html`，输入电脑局域网地址即可连接
- `启动器.bat` — 以 `--listen 0.0.0.0 --port 8188` 启动服务并打印手机访问地址

## 使用

1. 用 ComfyUI 启动服务（建议 `--listen 0.0.0.0`，见 `启动器.bat`）。
2. 手机浏览器打开 `http://<电脑局域网IP>:8188/launcher`，或使用 `mobile-app` 打包的 App。

## AI 配置（API Key / 模型）

配置保存在 ComfyUI 根目录的 **`comfy_studio.yaml`**（gitignored），缺失时插件会自动创建，
长期生效、手机与网页共用，密钥不会离开电脑。

- **Web 端**：`/launcher` → 设置 → "AI 模型 / API Key" 填入后点"保存设置"
- **移动端**：App 内"设置"页 → "AI 服务配置"
- **电脑端快捷方式**：运行 `配置AI密钥.bat`（也会写入环境变量 `DEEPSEEK_API_KEY`）

配置文件示例：

```yaml
api_key: ""
model: deepseek-v4-pro
api_base: https://api.deepseek.com
```

密钥优先级：`comfy_studio.yaml` > 环境变量 `DEEPSEEK_API_KEY` > 旧版 `ai_key.txt`。

## 上传 GitHub 注意

仓库中不包含任何密钥。以下路径已被 `.gitignore` 覆盖，请勿强制提交：

- `comfy_studio.yaml`（AI 配置，含 API Key）
- `custom_nodes/aki_launcher/ai_key.txt`（旧版密钥文件）
- `web/launcher/presets.json`（本机预设数据）
- `mobile-app/` 下的 `node_modules/`、`android/.gradle/`、`android/app/build/` 等构建产物
- 本机状态目录（`.launcher/`、`.cache/`、`.claude/`、`.agents/`）

## 安全提示

`--listen 0.0.0.0` 会把 ComfyUI API 完全暴露给同一网络，无认证；请只在可信局域网内使用。

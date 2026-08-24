# Comfy Studio —— 局域网 ComfyUI 移动创作工作台

> 本仓库为 [ComfyUI v0.33.1](https://github.com/comfyanonymous/ComfyUI)（官方）的私有无头分叉，
> 额外包含 **Comfy Studio** 插件。以下为插件的项目介绍。

---

手机/平板在同一局域网内，直接调用电脑上的 ComfyUI 完成生图；内置 AI 助手、预设库与作品图库。
**密钥只保存在电脑本地，客户端不持有任何密钥。**

## 一句话

Comfy Studio 是一个运行在 **ComfyUI v0.33.x** 内部的轻量插件：手机或平板连上同一 WiFi 后，通过浏览器或配套 Android App 即可使用你的 ComfyUI 出图，并可用 DeepSeek AI 助手辅助写提示词、调参数。

## 核心特性

| 特性 | 说明 |
|---|---|
| 🖼 局域网生图工作台 | 手机 + 电脑同一网络即可使用（`--listen 0.0.0.0`），无需公网、无需账号 |
| ✦ AI 助手 | DeepSeek 流式对话，自动提炼提示词/负向提示词/参数，一键应用到创作 |
| 🎛 预设与收藏 | 完整参数一键保存/复用，服务端持久化，多设备共用 |
| 🖼 作品图库 | 生成记录本地留存，动态加载预览，支持下载原图 |
| 📱 移动端 App | Capacitor 打包的 Android 外壳，输入电脑局域网地址即用 |
| 🔒 密钥本地化 | API Key 只存于电脑端 `comfy_studio.yaml`，网页/手机不落盘、不传输 |
| ⚡ 零额外依赖 | 只复用 ComfyUI 自身依赖（aiohttp/PyYAML），前端纯静态，无需构建 |

## 架构

```
手机浏览器 / Android App（WebView 外壳）
        │  http://<电脑局域网IP>:8188
        ▼
ComfyUI 主机（v0.33.x，--listen 0.0.0.0）
  ├── custom_nodes/aki_launcher/   ← Python 后端：/launcher 路由、AI 代理、配置读写
  ├── web/launcher/                ← 前端：创作 / AI 助手 / 图库 / 预设
  └── comfy_studio.yaml            ← 本地配置（gitignored，含 API Key）
        │  /api/prompt  /api/history  /api/view  /ws
        ▼
ComfyUI 原生 API + 生图引擎
```

- **前端 → 后端**：同源调用 ComfyUI 原生 API（`/api/prompt`、`/api/history`、`/api/view`、`/ws` 等）
- **AI 助手**：后端代理转发到 DeepSeek（SSE 流式），**密钥从不经过客户端**
- **移动端外壳**：仅负责连接/导航/主题，实际页面为 iframe 内嵌的 `/launcher`

## 功能明细

- **创作**：Checkpoint / UNET 双模式；LoRA 多级串联（强度可调）；种子/步数/CFG/画幅/批量；实时进度 + 预览；可停止任务；断线自动重连
- **AI 助手**：流式对话、可编辑系统提示词、回复中的提示词/参数一键"应用到创作"、可重新生成
- **预设**：完整参数保存为预设（服务端持久化），一张卡片快速应用
- **图库**：保留最近 150 张记录，支持预览/下载/删除
- **移动端**：主题（跟随系统/浅/深）与网页联动；连接状态实时监控；离线提示与重试

## 目录结构（插件部分）

```
custom_nodes/aki_launcher/   Python 后端（路由 + AI 代理 + YAML 配置）
web/launcher/                前端应用（index.html + app.js + core.js + launcher.css）
mobile-app/                  Capacitor Android 外壳（web/index.html + android/ 工程）
scripts/configure-ai-key.ps1 电脑端密钥配置脚本
启动器.bat                    启动 ComfyUI（--listen 0.0.0.0）并打印手机访问地址
comfy_studio.yaml             AI 配置（gitignored，默认自动创建）
```

## 使用

1. 启动 ComfyUI：双击 `启动器.bat`（自动 `--listen 0.0.0.0 --port 8188`）
2. 电脑：打开 `http://127.0.0.1:8188/launcher`
3. 手机：打开 `http://<电脑局域网IP>:8188/launcher`，或使用 `mobile-app` 打包的 App
4. 首次使用 AI 助手：设置页填入 DeepSeek API Key 与模型，保存到 `comfy_studio.yaml`

## 配置（comfy_studio.yaml）

```yaml
api_key: ""                      # DeepSeek API Key（留空则用环境变量）
model: deepseek-v4-pro           # 模型名
api_base: https://api.deepseek.com  # 可选：自定义转发地址
```

配置入口：
- **Web**：`/launcher` → 设置 → DeepSeek API Key / AI 模型 / API 地址 → 保存设置
- **移动端**：App 内"设置"页 → AI 服务配置
- **电脑端**：运行 `配置AI密钥.bat`

优先级：`comfy_studio.yaml` > 环境变量 `DEEPSEEK_API_KEY` > 旧版 `ai_key.txt`。

## 安全与隐私

- 密钥**只存于电脑本地**（gitignored 的 `comfy_studio.yaml`），网页与手机端不持有、不传输
- 无遥测、无统计；唯一对外网络请求是 AI 助手转发到 DeepSeek（可按需关闭）
- 仓库 `.gitignore` 覆盖密钥/预设/用户数据/构建产物，配套 `同步到github.ps1` 内置密钥扫描
- ⚠️ `--listen 0.0.0.0` 会在局域网内无认证暴露 ComfyUI API，仅建议在可信网络使用

## 环境要求

| 项 | 要求 |
|---|---|
| ComfyUI | **v0.33.x**（前端依赖 `/api` 前缀路由，旧版不可用） |
| Python | 3.10+ |
| 额外 pip 依赖 | 无（复用 ComfyUI 的 aiohttp / PyYAML） |
| 移动端打包（可选） | Node.js + Capacitor 6 + Android SDK |
| 网络 | 手机与电脑同一局域网 |

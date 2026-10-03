# Comfy Studio Lite

ComfyUI 自定义节点。安装后打开 `/launcher`，在电脑或同一局域网的手机上使用 Anima 生图、MiniMax H3 视频生成、场景、Pose、反推和 Agent。

需要 **ComfyUI 0.33.x+**（使用 `/api` 前缀路由）。

## 安装

在 ComfyUI 根目录：

```bat
cd custom_nodes
git clone https://github.com/ackeze/comfyui_studio_lite.git
cd comfyui_studio_lite
install.bat
```

或：

```
python custom_nodes/comfyui_studio_lite/install.py
```

`install.bat` / `install.py` 会：

1. 安装 `requirements.txt`（`zeroconf`，用于局域网发现）
2. 扫描 `models/`，只下载缺失的资源
3. Hugging Face 失败时改走 `hf-mirror.com`

本机已有任意 Anima UNET（如 `waiANIMA`）、`qwen_3_06b_base*`、`qwen_image_vae*` 会自动跳过。

```
python install.py --required     只下 UNET / CLIP / VAE
python install.py --dry-run      只检查，不下载
python install.py --skip-pip
```

中国大陆可先：

```
set HF_ENDPOINT=https://hf-mirror.com
```

重启 ComfyUI，打开 `http://127.0.0.1:8188/launcher`。手机访问请用 `--listen 0.0.0.0`。

手机连不上时，Windows 防火墙需要放行 **TCP 8188 入站**（仅专用/域网络）。管理员运行一次：

```bat
netsh advfirewall firewall add rule name="Comfy Studio Lite LAN" dir=in action=allow protocol=TCP localport=8188 profile=private,domain
```

若目录里有 `Allow-LAN.bat`，右键以管理员运行一次即可。当前 Wi-Fi 须为「专用」网络；手机先关 VPN 再自动发现。

已经能打开工作台时，也可以在 AI 对话里说「帮我检查并安装缺失的模型和依赖」，确认下载后由助手补齐。

AI 会按需加载和调用工具，读取每一步的结果后再继续；普通聊天不会自动检查所有模型或依赖。

可说「检查自动安装的问题，给我修复差异」：助手在后端固定的 ComfyUI 根目录内查看文件、搜索代码和读取日志，再提出小范围修改。点击「确认修改」后才写入，文件若已被手动改动则拒绝覆盖。写入前保存备份到根目录 `.comfy_studio_maintenance`，可说「撤销刚才的修改」，审核撤销差异后确认。代码修改需要重启 ComfyUI 并检查实际运行结果。文件工具不访问凭据、会话、目录链接或模型二进制内容；依赖安装和模型下载仍使用现有安装工具。

Android App 1.0.1 支持原生文件保存：图片、视频、对话和场景导出通过系统保存窗口选择位置。视频从当前工作台流式下载，本地导出文件上限 32 MiB；取消保存不会显示成功。需要安装新版 APK，同时更新工作台网页。

AI 支持图文对话：可粘贴、拖入或选择最多 4 张图片，消息保留可放大的缩略图。需要点评生成结果时，助手通过 `view_images` 按需读取本地图片。设置中的「图片理解模型」可指定同一 API 下支持图片和工具调用的模型；留空沿用 AI 模型，DeepSeek 官方接口的含图对话自动使用 `deepseek-flash`。其他服务需配置支持看图的模型。

可对 AI 说「按当前编辑器生成」：助手沿用编辑器中的模型、LoRA、机位、Pose、图生图或修复设置直接提交，并在对话里显示队列和结果。也可以先让助手打开编辑器调整，再提交生成。需要保持 AI 对话页面打开，以读取本机编辑器状态。

消息支持复制、编辑、重试和创建分支。编辑、重试会建立新分支，保留原对话；编辑用户消息保留附图并重新生成回复，编辑 AI 消息保存修订内容。消息上的「重试」从对应用户请求重新执行，允许重新提交图片或视频生成，保留更早轮次的结果。停止或连接失败后的「重试回复」用于恢复回复，保留已提交任务以避免重复生成。对话目录标记分支，可点击「返回原对话」。

## MiniMax H3 视频

「视频」页支持文生视频、首帧 / 尾帧 / 首尾帧，以及最多 4 张参考图，输出可播放、下载的 MP4。使用本地 H3 fl2va / ref2va、MiniMax H3 Qwen3-VL 编码器及独立的视频、音频 VAE，需要 ComfyUI 已包含 H3 节点。不会自动下载视频模型。

支持横屏、竖屏和自定义尺寸，24 fps、2–15 秒；页面显示按 H3 帧数规则对齐后的实际时长。首帧上传后按图片比例调整尺寸。常规默认 30 步 / CFG 3；fl2va 可启用内置 Turbo LoRA，8 步 / CFG 1。可关闭成片声音，视频 VAE 使用分块解码。

AI 支持 `generate_video`、`video_editor` 和 `generate_from_editor(media="video", video={...})`。聊天附图保留本地原图，可直接按图片编号设置首帧、尾帧或参考图；同图首尾帧不用上传两次。AI 可设置模式、尺寸、时长、声音和采样参数，省略的设置保留。`video_editor` 和人工编辑器提交只读写设置，生成由单独的生成工具执行；默认描述为空，不会提交示例视频。

结果在对话中播放和下载，消息「重试」可重新执行视频请求。可让 AI 用 `cancel_generation` 取消已查询到的指定任务，视频页也有「取消任务」，不会停止其他任务。视频任务与作品记录保存在当前浏览器；重载会查询原任务，不重复提交。

前端由本插件提供，不必再拷到 ComfyUI 的 `web/`。

## 会下载的资源

| 用途 | 文件 | 目录 |
|---|---|---|
| 生图 | anima-base-v1.0.safetensors | models/diffusion_models |
| 生图 | qwen_3_06b_base.safetensors | models/text_encoders |
| 生图 | qwen_image_vae.safetensors | models/vae |
| Pose | anima_pose_preview2.safetensors | models/loras |
| 场景 | anima-lllite-any-test-like-v2.safetensors | models/model_patches |
| 场景 | anima-lllite-inpainting-v2.safetensors | models/model_patches |
| 场景 | anima-lllite-pose-1.safetensors | models/model_patches |
| 抠图 | sam_vit_b_01ec64.pth | models/sams |

Anima 权重使用 CircleStone 非商用许可，下载即表示接受对应模型卡条款。

## 目录

```
__init__.py          路由与节点
web/                 /launcher 前端
install.py           一键补依赖和模型
resources.json       资源清单
pyproject.toml       Comfy Registry 元数据
```

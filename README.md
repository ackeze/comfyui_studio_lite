# Comfy Studio Lite

ComfyUI 自定义节点。安装后打开 `/launcher`，在电脑或同一局域网的手机上做 Anima 文生图、场景、Pose、反推和 Agent。

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

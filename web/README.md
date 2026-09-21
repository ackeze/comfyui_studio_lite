# Comfy Studio

手机/平板在局域网内使用 ComfyUI 的移动工作台。手机端直接调用 ComfyUI 原生 API
（`/api/prompt`、`/api/history`、`/api/view`、WebSocket `/ws`）完成生图，AI 助手
由电脑上的 ComfyUI 代理转发到 DeepSeek（SSE 流式响应）。

## 组成

- `custom_nodes/aki_launcher/` — 后端：注册 `/launcher` 路由，提供 AI 聊天代理与预设读写
- `custom_nodes/aki_launcher/web/` — 前端：移动端优化的生图 UI（创作 / 场景 / AI 助手 / 图库 / 预设）
- `mobile-app/` — Capacitor Android 外壳，内嵌 `web/index.html`，输入电脑局域网地址即可连接
- `启动器.bat` — 以 `--listen 0.0.0.0 --port 8188` 启动服务并打印手机访问地址

## 使用

1. 用 ComfyUI 启动服务（建议 `--listen 0.0.0.0`，见 `启动器.bat`）。
2. 手机浏览器打开 `http://<电脑局域网IP>:8188/launcher`，或使用 `mobile-app` 打包的 App。

## 项目 Agent（首版）

AI 页面由 Agent 对话替换，右侧会话目录可折叠，复用设置中的 API、模型和系统提示词。模型需要同时支持 Chat Completions 工具调用与图片输入；对话输入框可以直接拖入图片，也可以从结果区或图库把图片拖进来，单条消息最多 4 张，图片会随消息发送到所配置的模型服务。任务和对话保存在 `user/comfy_studio_agent`，刷新后恢复最近会话；服务重启会终止执行中的任务。原聊天的浏览器记录保留但不自动迁移。

- 可查询本地模型、搜索与检查公开 Hugging Face 模型仓库。
- 项目功能通过确认卡打开现有界面；机位和 Pose 在编辑窗口中提交真实参数及预览图。提交的图片会发送到所配置的模型服务。
- 下载必须确认具体文件及目录，仅支持带版本、大小和 SHA256 的公开 safetensors 文件，不覆盖已有模型，不安装插件或执行脚本。
- `generate_image` 自动构建 Anima 分体模型文生图并从后端提交到本地 ComfyUI，页面关闭不影响已经入队的生成。结果在聊天中显示；入队不代表完成。它不继承创作页未提交的旧状态，但覆盖全部普通生成参数：模型文件、LoRA 栈、步数、CFG、采样器、调度器、批次数、种子、尺寸、CLIP 类型、权重精度和机位权重提示词。Pose 骨架与图生图仍通过悬浮编辑器提交。
- `agnet.md` 自动加入系统上下文，包含 Anima 编码器/VAE 配套、参数与交互规则；模型文件名采用本地清单。反推、预设、图库等仍通过现有界面操作。
- 上游使用流式响应，前端约每 600 ms 获取增量状态。AI 页常驻监测本地生成队列：卡片会显示排队位置或生成中，完成后图片自动出现在对话里；点击图片可在窗口内缩放、拖动、查看文件名并下载。展示面向用户的说明与工具结果，不展示内部推理字段。

测试：`python custom_nodes/aki_launcher/tests/test_agent.py`；前端测试见同目录 `test_agent_ui.cjs`（需本机 Playwright/Edge）。

## 创作页图生图

“绘图控制 → 图生图”支持上传或拖入 PNG/JPEG/WebP，也可使用当前生成图。参考图等比缩小至长边≤1024，并补白对齐16像素（透明区域合成白底），不拉伸、不裁切。输出尺寸由参考图决定，不使用参数面板的自定义宽高。重绘强度默认0.45、范围0.05–1；复用现有模型、LoRA、提示词、采样参数和批次数，不注入 Pose 提示词。清除参考图只取消选择，不删除服务器文件。

工作流为 `LoadImage → VAEEncode → RepeatLatentBatch → KSampler → VAEDecode → SaveImage`。上传和任务仍走本机 ComfyUI API，无新模型、依赖或外部服务。参考图元数据保存在浏览器；若服务器输入文件已删除，需重新上传。这是普通重绘，不是指令编辑或精确相机控制。

## Pose 控制（实验性，暂停改进）

创作页可在“普通生成 / Pose 控制”之间切换。Pose 模式内置站立、躺下、坐姿、鸭子坐和单腿站立五种模板；COCO 17 点骨架可透明叠加在主画布上，支持开关、整体缩放、水平/垂直定位和画布内整体拖动，也可直接拖动关节点。编辑预览使用易辨识的粗线和彩色关节点，上传给模型的控制图则使用 2px 彩色骨骼、3px 白色关节点和黑底。

Pose 使用 Anima Base v1.0 与 Claquasse 的 Pose Preview-2：`关键点 → R0_thin → 移除方形渲染器的留边 → VAEEncode → AnimaControlApply → CFGZeroStar → er_sde/simple`。编辑器、画布叠加和控制图使用同一组归一化坐标，方形渲染前补偿目标画幅比例，裁切只移除留边。采样和最终输出均按长边限制在 Pose 分辨率以内（最高1024），不再放大回原始尺寸。Pose LoRA 固定为 `1`，CFG 固定为 `4`。用户 LoRA 栈、步数、分辨率、骨架约束强度均可调整。姿势模板只修改关键点，不注入姿势提示词。Preview-2 为实验性适配器：坐标正确不代表模型可靠跟随；本机同种子对照中，关闭风格 LoRA、将强度由0.6提高到1.0，仍未稳定复现单腿站立，不能作为精确姿势控制的验收通过依据。

“导入姿势 JSON”接受作者的 `{"canvas":1024,"points":[[x,y,score],...]}` 格式，共133点；保留检测置信度，低于0.3的点不渲染。“导出姿势 JSON”可保存修改结果。手动模板仅有17个身体点，其余点以0置信度留空，不推算脸、手、脚。表情模板通过提示词控制。渲染样式复现[适配器作者的 R0_thin](https://huggingface.co/Claquasse/Anima-Control-Pose/blob/main/comfyui/ComfyUI-anima-pose-control/pose_render.py)，不是照片检测器；Preview-2仍可能偏离骨架，提高强度也可能降低画质。

## Anima 场景编排

“场景”页包含编排模式与艺术家模式。编排模式支持图片上传、SAM 抠图、拖动缩放、图层与融合；艺术家模式支持画背景/人物/道具框、中心关系连线、人物 Pose 关节、Agent 提示词规划，以及背景先行、人物顺序局部生成和 SAM 自动透明分层。全局融合使用通用 Anima LLLite，接缝修复使用 Inpainting LLLite。

完整说明和场景 JSON 契约见 [ANIMA_SCENE.md](ANIMA_SCENE.md)。

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
- `custom_nodes/aki_launcher/web/presets.json`（本机预设数据）
- `mobile-app/` 下的 `node_modules/`、`android/.gradle/`、`android/app/build/` 等构建产物
- 本机状态目录（`.launcher/`、`.cache/`、`.claude/`、`.agents/`）

## 安全提示

`--listen 0.0.0.0` 会把 ComfyUI API 完全暴露给同一网络，无认证；请只在可信局域网内使用。
# 3D 相机提示词

创作 → 普通生成中可选择启用，默认关闭。左键拖动黄色相机，镜头始终朝向原点球体；右键旋转编辑视角，中键平移，滚轮缩放编辑视图。滑块可调整环绕、俯仰、相对距离和权重；放大编辑器后可按 Esc 收起。

这是本地透视投影的 3D 编辑界面，无额外模型或网络依赖。空间方位映射为单一视角描述，俯仰与距离连续调整权重。普通生成时追加单主体正向描述及多人、分屏、实体相机负向排除词；预览显示两者，原文和 LoRA 保留。切换图生图或 Pose 不注入。相机设置随生成参数保存；编辑视角独立，不影响提示词。权重不是物理相机参数，不能保证精确角度或一致物体的多视图。

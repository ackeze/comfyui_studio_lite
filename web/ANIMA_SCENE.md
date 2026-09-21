# Anima Scene Composer V0.3

## 艺术家模式（首版）

1. 在场景页切换到“艺术家”。
2. 选择背景、人物或道具工具，在画布拖动创建框；框的位置和大小就是生成区域。
3. 使用“连接关系”依次点击主体与参照物，或在“对象关系”面板填写，例如“白发少女坐在桌子旁边”。
4. 选中人物后可拖动框内 17 个身体关节，也可切换站立/坐姿模板。
5. 点击“AI 规划”让已配置的 DeepSeek Agent 为背景、人物和关系编写英文提示词；Agent 不可用时自动使用本地确定性模板。
6. 点击“按顺序生成”：先生成包含道具的背景，再按图层顺序对人物框局部重绘。人物使用 Preview-2 Pose 主控或 Pose LLLite 回退，完成后本地 SAM 自动拆为透明人物层。

首版只单独生成背景和人物。道具框会作为背景内容与人物关系锚点，不单独输出透明道具层。

## 使用流程

1. 打开 `/launcher#scene`。
2. 上传 PNG/WebP/JPG，或从 ComfyStudio 图库添加作品。检测到不透明图片时，可选择“作为背景”“保留原图”或在本地 SAM 窗口框选主体抠图。
3. 在画布拖动对象；使用右下控制点缩放、顶部控制点旋转。
4. 设置图层、深度、对象 Prompt、区域模式和条件强度。
5. 点击“导出素材”可获得 Composite、Lineart、Depth、Seam Mask 和每个对象的独立 Mask。
6. 点击“全局融合”使用 Anima 统一光照、色调和边缘。它以 Composite 为底图做低强度图生图，不再从纯噪声重画布局。
7. 对融合结果点击“接缝修复”，只对 Seam Mask 区域进行低强度重绘。

新场景会自动填入推荐的全局正向、全局负向和对象保真提示词。已有场景可在“全局设置”右上角点击“应用推荐”；该操作会替换全局推荐词，只补全为空的对象提示词，不覆盖手写对象描述。

## 推荐融合提示词

全局正向：

```text
masterpiece, high quality anime illustration, one coherent scene, seamless subject integration, consistent perspective and scale, every subject physically grounded or naturally supported by the environment, matching ambient lighting, coherent light direction, soft contact shadows, realistic cast shadows, reflected environmental light on hair and clothing, unified color grading, atmospheric depth, clean natural edges
```

全局负向：

```text
collage, pasted-on subject, sticker effect, floating subject, mismatched scale, mismatched perspective, inconsistent lighting, missing contact shadow, hard cutout edge, white halo, dark halo, duplicate subject, extra limbs, deformed anatomy, bad hands, bad feet, distorted face, blurry, low quality, text, logo, watermark, symbol, icon, signage
```

对象正向默认强调身份、发型、服装、比例和姿势保真，同时要求环境反光、落地阴影和自然边缘；对象负向默认抑制换脸、换装、肢体畸变、悬浮和贴纸边缘。

对象图片会上传到 ComfyUI 的 `input/comfy_studio_scenes/`。Scene JSON 仅保存文件引用，不内嵌图片，因此导入 JSON 时对应图片仍需保留在原 ComfyUI 安装中。

## 模型位置

- Anima UNET：`models/diffusion_models/`
- Anima 文本编码器：`models/text_encoders/`
- Qwen Image VAE：`models/vae/`
- Anima LLLite：`models/model_patches/`
- Anima Pose Preview-2：`models/loras/anima_pose_preview2.safetensors`
- Anima Pose LLLite 回退：`models/controlnet/anima-lllite-pose-1.safetensors`

V0.2 使用 ComfyUI 原生 `ModelPatchLoader` 和 `AnimaLLLiteApply`，不会修改 Anima 权重。

## Pose Control 方案

艺术家模式采用双模型策略：Preview-2 是主控制器，Pose LLLite 是低显存回退。骨架使用与画布相同尺寸的 `R0_thin` DWPose 风格，人物建议先在 `1024 px` 生成；主控制强度从 `1.0` 开始，回退强度从 `0.8` 开始。

Preview-2 工作流顺序为 `UNETLoader → LoraLoaderModelOnly → Anima Pose Control Apply`。骨架图先经 Qwen Image VAE 编码，再接入 `control_latent`。Pose LLLite 直接使用现有 `Apply Anima ControlNet-LLLite`，控制图接骨架 IMAGE。两者都只提供软姿态约束，生成后仍需做人形锚点校验和失败重试。

艺术家模式提供两条输出路径：“全图成片”把全部背景、人物、道具框、Pose 和关系合并成一个提示词，从纯噪声一次生成整幅画面，默认用于最终成片；“分层生成”先生成背景，再局部生成人物并用 SAM 拆成透明层，适合后续移动和缩放，但融合质量通常低于全图成片。

## 融合质量边界

- “全局重绘强度”建议从 `0.25–0.40` 开始。数值越高，光照与画风更统一，但人物身份、姿势和肢体更容易漂移。
- “接缝重绘强度”只作用于 Seam Mask，适合修补抠图边缘和遮挡交界，不负责自动抠图。
- 两张带各自背景的完整矩形图片不能直接当作两个前景对象融合。界面会标记“无透明通道”；应保留一张作为背景，其余人物或道具先抠成透明 PNG/WebP。
- “作为背景”会自动铺满画布、移动到最底层并锁定，使用等比居中裁切，不会拉伸图片。
- “框选主体抠图”使用本机 `models/sams/sam_vit_b_01ec64.pth`，不请求互联网。框要完整包住一个主体，框中心应落在主体躯干上，边缘柔化默认 `2 px`。
- 已加入场景的前景对象也可以点击“重新框选抠图”，修正不理想的旧蒙版，无需删除原对象。

## Scene JSON 契约

```json
{
  "version": "0.2",
  "width": 768,
  "height": 1024,
  "background": "#808080",
  "global_prompt": "cinematic anime scene",
  "global_negative_prompt": "low quality, blurry",
  "objects": [
    {
      "id": "girl_01",
      "name": "White-haired girl",
      "image": {
        "filename": "girl.png",
        "subfolder": "comfy_studio_scenes",
        "type": "input"
      },
      "prompt": "white hair, blue dress",
      "negative_prompt": "black hair",
      "bbox": [0.12, 0.08, 0.39, 0.91],
      "rotation": 0,
      "depth": 0.32,
      "z_index": 4,
      "seed": -1,
      "locked": false,
      "visible": true,
      "region_mode": "hard",
      "control_strength": 1.0,
      "feather": 0.04,
      "aspect_ratio": 0.667,
      "has_transparency": true,
      "role": "object"
    }
  ]
}
```

`bbox` 使用 `[x1, y1, x2, y2]` 归一化坐标。Soft 模式会按 `feather` 扩大条件区域；Hard 模式使用对象边界作为 conditioning 范围。V0.2 不修改 Anima Attention，真正的逐像素 Masked Attention 留待后续 Spatial Patcher 阶段。

`aspect_ratio` 保存原始图片宽高比。画布拖拽缩放、加减缩放和宽高输入默认锁定该比例，避免在竖屏或横屏画布中拉伸对象。

## 原生节点

- `Anima Scene from JSON`：验证并标准化 Scene JSON，输出 `ANIMA_SCENE`。
- `Anima Scene Regional Conditioning`：编码全局及对象提示词，并按对象区域输出正向/负向 Conditioning。
- `Anima Pose Control Apply`：把 Preview-2 Control Embedder 注入 Anima，并与上游 Preview-2 LoRA 配合使用。

前端生成工作流使用这两个节点，同时复用 ComfyUI 原生加载器、采样器和 Anima LLLite 节点。

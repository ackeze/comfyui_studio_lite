import json

import cv2
import numpy as np
import safetensors.torch
import torch
import torch.nn as nn

import folder_paths


POSE_LIMBS = ((5, 7), (7, 9), (6, 8), (8, 10), (11, 13), (13, 15), (12, 14), (14, 16),
              (5, 6), (11, 12), (5, 11), (6, 12), (0, 5), (0, 6))
POSE_COLORS = ((255, 0, 0), (255, 128, 0), (255, 255, 0), (128, 255, 0), (0, 255, 0), (0, 255, 128),
               (0, 255, 255), (0, 128, 255), (0, 0, 255), (128, 0, 255), (255, 0, 255), (255, 0, 128),
               (180, 180, 180), (220, 220, 220))


class AnimaPoseRenderOfficial:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pose_json": ("STRING", {"multiline": True}),
                "resolution": ("INT", {"default": 1024, "min": 256, "max": 2048, "step": 64}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "render"
    CATEGORY = "Comfy Studio/Anima Scene"

    def render(self, pose_json, resolution):
        data = json.loads(pose_json)
        points = np.asarray(data.get("points"), dtype=float)
        if points.shape != (133, 3):
            raise ValueError("Anima R0_thin pose_json must contain exactly 133 [x, y, score] points")
        if not np.isfinite(points).all():
            raise ValueError("Anima R0_thin keypoints must be finite numbers")
        if not any(points[a, 2] >= .3 and points[b, 2] >= .3 for a, b in POSE_LIMBS):
            raise ValueError("No visible body skeleton in pose_json; choose another pose")
        canvas = int(data.get("canvas", resolution))
        if canvas <= 0:
            raise ValueError("Anima R0_thin pose_json canvas must be positive")
        points[:, :2] *= int(resolution) / canvas
        image = np.zeros((int(resolution), int(resolution), 3), dtype=np.uint8)
        for index, (start, end) in enumerate(POSE_LIMBS):
            if points[start, 2] >= .3 and points[end, 2] >= .3:
                cv2.line(image, tuple(points[start, :2].astype(int)), tuple(points[end, :2].astype(int)), POSE_COLORS[index], 2)
        for index in range(17):
            if points[index, 2] >= .3:
                cv2.circle(image, tuple(points[index, :2].astype(int)), 3, (255, 255, 255), -1)
        for index in range(17, 23):
            if points[index, 2] >= .3:
                cv2.circle(image, tuple(points[index, :2].astype(int)), 1, (255, 255, 255), -1)
        # Match Claquasse/Anima-Control-Pose pose_render.py R0_thin, including draw order.
        for index in range(91, 133):
            if points[index, 2] >= .3:
                cv2.circle(image, tuple(points[index, :2].astype(int)), 2, (0, 255, 255), -1)
        for index in range(23, 91):
            if points[index, 2] >= .3:
                cv2.circle(image, tuple(points[index, :2].astype(int)), 2, (255, 255, 255), -1)
        return (torch.from_numpy(image.astype(np.float32) / 255.0).unsqueeze(0),)


class ControlEmbedder(nn.Module):
    def __init__(self, in_channels=16, spatial_patch_size=2, temporal_patch_size=1, model_channels=2048):
        super().__init__()
        self.spatial_patch_size = spatial_patch_size
        self.temporal_patch_size = temporal_patch_size
        in_features = in_channels * spatial_patch_size * spatial_patch_size * temporal_patch_size
        self.proj = nn.Linear(in_features, model_channels)

    def forward(self, control):
        if control.ndim == 4:
            control = control.unsqueeze(2)
        if control.ndim != 5:
            raise ValueError(f"Anima pose control expects a 4D or 5D latent, got {control.ndim}D")
        batch, channels, frames, height, width = control.shape
        temporal = self.temporal_patch_size
        spatial = self.spatial_patch_size
        control = control.reshape(
            batch,
            channels,
            frames // temporal,
            temporal,
            height // spatial,
            spatial,
            width // spatial,
            spatial,
        )
        control = control.permute(0, 2, 4, 6, 1, 3, 5, 7)
        return self.proj(control.reshape(batch, frames // temporal, height // spatial, width // spatial, -1))


class AnimaControlApply:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "control_latent": ("LATENT",),
                "control_embedder_path": ("STRING", {"default": "anima_pose_preview2.safetensors"}),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05}),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "apply"
    CATEGORY = "Comfy Studio/Anima Scene"

    def apply(self, model, control_latent, control_embedder_path, strength):
        path = folder_paths.get_full_path_or_raise("loras", control_embedder_path)
        state = {
            key.split("control_embedder.", 1)[1]: value
            for key, value in safetensors.torch.load_file(path).items()
            if "control_embedder." in key
        }
        if not state:
            raise ValueError(f"No control_embedder weights found in {control_embedder_path}")

        dit = model.model.diffusion_model
        parameter = next(dit.parameters())
        embedder = ControlEmbedder(in_channels=16, model_channels=getattr(dit, "model_channels", 2048))
        embedder.load_state_dict(state, strict=False)
        embedder.eval().requires_grad_(False).to(parameter.device, parameter.dtype)
        control = control_latent["samples"]

        def wrapper(executor, *args, **kwargs):
            current = next(dit.parameters())
            embedder.to(current.device, current.dtype)
            control_tokens = strength * embedder(control.to(current.device, current.dtype))

            def add_control(_module, _inputs, output):
                return output + control_tokens.to(output.device, output.dtype)

            handle = dit.x_embedder.register_forward_hook(add_control)
            try:
                return executor(*args, **kwargs)
            finally:
                handle.remove()

        patched = model.clone()
        patched.add_wrapper_with_key("diffusion_model", "anima_control", wrapper)
        return (patched,)


NODE_CLASS_MAPPINGS = {"AnimaControlApply": AnimaControlApply, "AnimaPoseRenderOfficial": AnimaPoseRenderOfficial}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AnimaControlApply": "Anima Pose Control Apply",
    "AnimaPoseRenderOfficial": "Anima Pose R0_thin Renderer (WholeBody-133)",
}

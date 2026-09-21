import { cameraPrompt, cameraNegative } from './camera.js';
import { addRepair } from './repair.js';

export const api = {
  async get(path) {
    const response = await fetch(`/api${path}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`请求失败 (${response.status})`);
    return response.json();
  },

  async post(path, body = {}) {
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const nodeErrors = Object.values(data.node_errors || {})
        .flatMap(item => item.errors || [])
        .map(item => item.message || item.details)
        .filter(Boolean);
      throw new Error(nodeErrors[0] || data.error?.message || data.error || `请求失败 (${response.status})`);
    }
    return data;
  },
};

export function imageUrl(image) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || '',
    type: image.type || 'output',
  });
  return `/api/view?${params.toString()}`;
}

export function makeSeed() {
  return Math.floor(Math.random() * 2 ** 32);
}

export function poseSampleSize(width, height, maxSide = 1024) {
  maxSide = Math.min(1024, maxSide);
  const longestSide = Math.max(width, height);
  if (longestSide <= maxSide) return { width, height };
  const scale = maxSide / longestSide;
  return {
    width: Math.max(64, Math.round(width * scale / 64) * 64),
    height: Math.max(64, Math.round(height * scale / 64) * 64),
  };
}

export function buildWorkflow(settings) {
  const isCheckpoint = settings.mode === 'checkpoint';
  const seed = Number(settings.seed) < 0 ? makeSeed() : Number(settings.seed);
  const workflow = {};
  const targetWidth = Number(settings.width);
  const targetHeight = Number(settings.height);
  const pose = settings.poseControl;
  const hasPose = Boolean(pose?.poseJson || pose?.image);
  const source = settings.img2img;
  const hasSource = Boolean(source?.enabled);
  if (hasSource && hasPose) throw new Error('图生图不能同时启用 Pose 控制');
  if (hasSource && !source.image) throw new Error('请先上传图生图参考图');
  if (hasSource && (!Number.isFinite(Number(source.denoise)) || Number(source.denoise) < 0.05 || Number(source.denoise) > 1)) throw new Error('重绘强度须在 0.05–1 之间');
  const sampleSize = hasPose ? poseSampleSize(targetWidth, targetHeight, Number(pose.resolution ?? 1024)) : { width: targetWidth, height: targetHeight };

  if (isCheckpoint) {
    workflow['4'] = {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: settings.checkpoint },
    };
  } else {
    workflow['4'] = {
      class_type: 'UNETLoader',
      inputs: { unet_name: settings.unet, weight_dtype: settings.weightDtype || 'default' },
    };
    workflow['10'] = {
      class_type: 'CLIPLoader',
      inputs: { clip_name: settings.clip, type: settings.clipType },
    };
    workflow['11'] = {
      class_type: 'VAELoader',
      inputs: { vae_name: settings.vae },
    };
  }

  const rawModel = ['4', 0];
  const rawClip = isCheckpoint ? ['4', 1] : ['10', 0];
  const vae = isCheckpoint ? ['4', 2] : ['11', 0];
  const loras = (settings.loraStack || []).filter(item => item.enabled !== false && item.name && (!hasPose || item.name !== pose.lora));
  let styledModel = rawModel;
  let styledClip = rawClip;

  loras.forEach((lora, index) => {
    const id = String(20 + index);
    workflow[id] = {
      class_type: 'LoraLoader',
      inputs: {
        model: styledModel,
        clip: styledClip,
        lora_name: lora.name,
        strength_model: Number(lora.modelStr),
        strength_clip: Number(lora.clipStr),
      },
    };
    styledModel = [id, 0];
    styledClip = [id, 1];
  });

  if (hasSource && source.repair) {
    addRepair(workflow, source, styledModel, styledClip, vae, seed);
    return { workflow, seed };
  }
  let controlImage = null;
  if (hasPose) {
    const poseResolution = Number(pose.resolution ?? 1024);
    workflow['101'] = pose.poseJson ? {
      class_type: 'AnimaPoseRenderOfficial',
      inputs: { pose_json: pose.poseJson, resolution: poseResolution },
    } : {
      class_type: 'LoadImage',
      inputs: { image: pose.image },
    };
    controlImage = ['101', 0];
    const needsControlScale = !pose.poseJson || sampleSize.width !== poseResolution || sampleSize.height !== poseResolution;
    if (needsControlScale) {
      workflow['104'] = {
        class_type: 'ImageScale',
        inputs: { image: controlImage, upscale_method: 'nearest-exact', width: sampleSize.width, height: sampleSize.height, crop: 'center' },
      };
      controlImage = ['104', 0];
    }
  }

  let sampleModel = styledModel;
  if (hasPose) {
    const poseStrength = Number(pose.strength ?? 1);
    workflow['100'] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: styledModel, lora_name: pose.lora, strength_model: 1 },
    };
    workflow['102'] = {
      class_type: 'VAEEncode',
      inputs: { pixels: controlImage, vae },
    };
    workflow['103'] = {
      class_type: 'AnimaControlApply',
      inputs: {
        model: ['100', 0],
        control_latent: ['102', 0],
        control_embedder_path: pose.lora,
        strength: poseStrength,
      },
    };
    workflow['106'] = {
      class_type: 'CFGZeroStar',
      inputs: { model: ['103', 0] },
    };
    sampleModel = ['106', 0];
  }

  const positiveText = [settings.prompt, hasPose ? pose.backgroundPrompt : '', pose?.expressionPrompt, !hasSource && !hasPose && !settings.pose?.enabled ? cameraPrompt(settings.cameraControl) : ''].filter(Boolean).join(', ');
  const negativeText = [settings.negPrompt, pose?.expressionNegative, !hasSource && !hasPose && !settings.pose?.enabled ? cameraNegative(settings.cameraControl) : ''].filter(Boolean).join(', ');
  workflow['6'] = {
    class_type: 'CLIPTextEncode',
    inputs: { clip: styledClip, text: positiveText },
  };
  workflow['7'] = {
    class_type: 'CLIPTextEncode',
    inputs: { clip: styledClip, text: negativeText },
  };

  workflow['5'] = {
    class_type: 'EmptyLatentImage',
    inputs: { width: sampleSize.width, height: sampleSize.height, batch_size: Number(settings.batchSize) },
  };
  if (hasSource) {
    workflow['110'] = { class_type: 'LoadImage', inputs: { image: source.image } };
    workflow['111'] = { class_type: 'VAEEncode', inputs: { pixels: ['110', 0], vae } };
    workflow['5'] = { class_type: 'RepeatLatentBatch', inputs: { samples: ['111', 0], amount: Number(settings.batchSize) } };
  }
  workflow['3'] = {
    class_type: 'KSampler',
    inputs: {
      model: sampleModel,
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
      seed,
      steps: hasPose ? Number(pose.steps ?? 30) : Number(settings.steps),
      cfg: hasPose ? 4 : Number(settings.cfg),
      sampler_name: hasPose ? 'er_sde' : settings.sampler,
      scheduler: hasPose ? 'simple' : settings.scheduler,
      denoise: hasSource ? Number(source.denoise) : 1,
    },
  };
  workflow['8'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae },
  };
  workflow['9'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: hasSource ? 'ComfyUI_Img2Img' : hasPose ? 'ComfyUI_Pose_Official' : 'ComfyUI_Mobile', images: ['8', 0] },
  };

  return { workflow, seed };
}

export class ComfySocket {
  constructor(clientId, handlers = {}) {
    this.clientId = clientId;
    this.handlers = handlers;
    this.socket = null;
    this.closedByUser = false;
    this.reconnectTimer = null;
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${location.host}/ws?clientId=${this.clientId}`);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => this.handlers.onStatus?.(true);
    this.socket.onerror = () => this.socket?.close();
    this.socket.onclose = () => {
      this.handlers.onStatus?.(false);
      if (!this.closedByUser) this.reconnectTimer = setTimeout(() => this.connect(), 2500);
    };
    this.socket.onmessage = event => {
      if (event.data instanceof ArrayBuffer) this.handleBinary(event.data);
      else {
        try { this.handlers.onMessage?.(JSON.parse(event.data)); } catch {}
      }
    };
  }

  handleBinary(buffer) {
    if (buffer.byteLength < 8) return;
    const type = new DataView(buffer).getUint32(0, false);
    if (![1, 2, 4].includes(type)) return;
    const mime = type === 2 ? 'image/jpeg' : 'image/png';
    const url = URL.createObjectURL(new Blob([buffer.slice(8)], { type: mime }));
    this.handlers.onPreview?.(url);
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

export async function getPromptImages(promptId) {
  const history = await api.get(`/history/${encodeURIComponent(promptId)}`);
  const outputs = history[promptId]?.outputs || {};
  return Object.values(outputs).flatMap(output => output.images || []);
}

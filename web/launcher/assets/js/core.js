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

export function buildWorkflow(settings) {
  const isCheckpoint = settings.mode === 'checkpoint';
  const seed = Number(settings.seed) < 0 ? makeSeed() : Number(settings.seed);
  const workflow = {};

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
  const loras = (settings.loraStack || []).filter(item => item.enabled !== false && item.name);
  let model = rawModel;
  let clip = rawClip;

  loras.forEach((lora, index) => {
    const id = String(20 + index);
    workflow[id] = {
      class_type: 'LoraLoader',
      inputs: {
        model,
        clip,
        lora_name: lora.name,
        strength_model: Number(lora.modelStr),
        strength_clip: Number(lora.clipStr),
      },
    };
    model = [id, 0];
    clip = [id, 1];
  });

  workflow['6'] = {
    class_type: 'CLIPTextEncode',
    inputs: { clip, text: settings.prompt || '' },
  };
  workflow['7'] = {
    class_type: 'CLIPTextEncode',
    inputs: { clip, text: settings.negPrompt || '' },
  };
  workflow['5'] = {
    class_type: 'EmptyLatentImage',
    inputs: {
      width: Number(settings.width),
      height: Number(settings.height),
      batch_size: Number(settings.batchSize),
    },
  };
  workflow['3'] = {
    class_type: 'KSampler',
    inputs: {
      model,
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0],
      seed,
      steps: Number(settings.steps),
      cfg: Number(settings.cfg),
      sampler_name: settings.sampler,
      scheduler: settings.scheduler,
      denoise: 1,
    },
  };
  workflow['8'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae },
  };
  workflow['9'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'ComfyUI_Mobile', images: ['8', 0] },
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

import { api, imageUrl } from './core.js';

const $ = id => document.getElementById(id);
const SCENE_KEY = 'comfy_studio_anima_scene_v2';
const SETTINGS_KEY = 'comfy_studio_settings_v2';
const GALLERY_KEY = 'comfy_studio_gallery_v2';
const DEFAULT_GLOBAL_PROMPT = 'masterpiece, high quality anime illustration, one coherent scene, seamless subject integration, consistent perspective and scale, every subject physically grounded or naturally supported by the environment, matching ambient lighting, coherent light direction, soft contact shadows, realistic cast shadows, reflected environmental light on hair and clothing, unified color grading, atmospheric depth, clean natural edges';
const DEFAULT_GLOBAL_NEGATIVE = 'collage, pasted-on subject, sticker effect, floating subject, mismatched scale, mismatched perspective, inconsistent lighting, missing contact shadow, hard cutout edge, white halo, dark halo, duplicate subject, extra limbs, deformed anatomy, bad hands, bad feet, distorted face, blurry, low quality, text, logo, watermark, symbol, icon, signage';
const DEFAULT_OBJECT_PROMPT = 'preserve this subject identity, face, hairstyle, clothing, body proportions and pose, correct anatomy, natural ground contact, lighting and color reflections matching the environment, soft contact shadow, clean integrated edges';
const DEFAULT_OBJECT_NEGATIVE = 'identity change, different outfit, different hairstyle, distorted face, deformed body, extra limbs, bad hands, bad feet, floating, pasted-on look, hard edge, halo';
const DEFAULT_ARTIST_NEGATIVE = 'worst quality, low quality, blurry, malformed anatomy, extra limbs, duplicate person, floating subject, incorrect interaction, wrong perspective, text, logo, watermark';
const CHARACTER_NEGATIVE_PATTERNS = [
  /\bno\s+(?:human|humans|person|people|character|characters)\b/i,
  /\bwithout\s+(?:a\s+)?(?:human|person|character)\b/i,
  /\bempty\s+(?:scene|stage)\b/i,
  /^(?:无人|无人物|不要人物|没有人物|空无一人)$/,
];
const CENSORSHIP_NEGATIVE_PATTERNS = [
  /^(?:nsfw|sfw|explicit|nude|naked|censored|uncensored|mosaic|safe)$/i,
  /^rating[\s:_-]*(?:safe|questionable|explicit)$/i,
  /^(?:bar|convenient)\s*censor$/i,
];
const POSE_LIMBS = [[5, 7], [7, 9], [6, 8], [8, 10], [11, 13], [13, 15], [12, 14], [14, 16], [5, 6], [11, 12], [5, 11], [6, 12], [0, 5], [0, 6]];
const POSE_PRESETS = {
  standing: [[.5,.12],[.47,.1],[.53,.1],[.43,.11],[.57,.11],[.41,.27],[.59,.27],[.34,.43],[.66,.43],[.3,.6],[.7,.6],[.44,.53],[.56,.53],[.42,.72],[.58,.72],[.4,.94],[.6,.94]],
  sitting: [[.5,.13],[.47,.11],[.53,.11],[.43,.12],[.57,.12],[.4,.29],[.6,.29],[.34,.44],[.66,.44],[.3,.58],[.7,.58],[.43,.52],[.57,.52],[.32,.68],[.68,.68],[.48,.84],[.78,.84]],
};
const imageCache = new Map();

const refs = {
  canvas: $('sceneCanvas'), wrap: $('sceneCanvasWrap'), empty: $('sceneEmpty'), meta: $('sceneCanvasMeta'), saveState: $('sceneSaveState'),
  imageInput: $('sceneImageInput'), jsonInput: $('sceneJsonInput'), objectList: $('sceneObjectList'), objectCount: $('sceneObjectCount'),
  inspector: $('sceneObjectInspector'), objectTitle: $('sceneObjectTitle'), result: $('sceneResult'), resultImage: $('sceneResultImage'),
  downloadResult: $('downloadSceneResult'), galleryDialog: $('sceneGalleryDialog'), galleryGrid: $('sceneGalleryGrid'), galleryEmpty: $('sceneGalleryEmpty'),
  progress: $('sceneProgress'), progressLabel: $('sceneProgressLabel'), progressFill: $('sceneProgressFill'),
  sizeTools: $('sceneSizeTools'), scaleLabel: $('sceneScaleLabel'),
  cutoutDialog: $('sceneCutoutDialog'), cutoutCanvas: $('sceneCutoutCanvas'), cutoutName: $('sceneCutoutName'),
  cutoutStatus: $('sceneCutoutStatus'), cutoutApply: $('sceneCutoutApply'), cutoutFeather: $('sceneCutoutFeather'),
  artistProgress: $('sceneArtistProgress'), artistProgressLabel: $('sceneArtistProgressLabel'), artistProgressFill: $('sceneArtistProgressFill'),
  relationList: $('sceneRelationList'), relationCount: $('sceneRelationCount'),
};

const state = {
  scene: defaultScene(), selectedId: null, pointer: null, initialized: false, resourcesLoaded: false,
  running: false, cancelled: false, lastResult: null, saveTimer: null, progressTimer: null, cutout: null,
  artistTool: 'select', relationSource: null,
};

function defaultScene() {
  return {
    version: '0.3', mode: 'composer', width: 768, height: 1024, background: '#808080',
    global_prompt: DEFAULT_GLOBAL_PROMPT, global_negative_prompt: DEFAULT_GLOBAL_NEGATIVE, objects: [],
    relations: [], artist: { pose_model: 'preview2', preview_lora: '', pose_patch: '', character_denoise: 0.9 },
    control: { source: 'composite', strength: 0.85, global_denoise: 0.35, denoise: 0.35, general_patch: '', inpaint_patch: '' },
  };
}

function defaultPose(preset = 'standing') { return { preset, keypoints: clone(POSE_PRESETS[preset] || POSE_PRESETS.standing) }; }

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value))); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function safeName(value = '') { return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'scene'; }
function shortName(value = '') { return String(value).split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt)$/i, ''); }

function toast(message, type = '') {
  const stack = $('toastStack');
  if (!stack) return;
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  stack.append(item);
  setTimeout(() => item.remove(), 3200);
}

function normalizeImageRef(value = {}) {
  if (!value || typeof value !== 'object') return {};
  const filename = String(value.filename || value.name || '').trim();
  const subfolder = String(value.subfolder || '').trim();
  const type = ['input', 'output', 'temp'].includes(value.type) ? value.type : 'input';
  const url = value.url || (filename ? imageUrl({ filename, subfolder, type }) : '');
  return { filename, subfolder, type, url };
}

function normalizeScene(raw) {
  const base = defaultScene();
  if (!raw || typeof raw !== 'object') return base;
  base.mode = raw.mode === 'artist' ? 'artist' : 'composer';
  base.width = Math.round(clamp(raw.width || base.width, 64, 2048) / 8) * 8;
  base.height = Math.round(clamp(raw.height || base.height, 64, 2048) / 8) * 8;
  base.background = /^#[0-9a-f]{6}$/i.test(raw.background) ? raw.background : base.background;
  if (typeof raw.global_prompt === 'string') base.global_prompt = raw.global_prompt.slice(0, 4096);
  if (typeof raw.global_negative_prompt === 'string') base.global_negative_prompt = raw.global_negative_prompt.slice(0, 4096);
  if (raw.control && typeof raw.control === 'object') {
    base.control.source = ['composite', 'lineart', 'depth'].includes(raw.control.source) ? raw.control.source : 'composite';
    base.control.strength = clamp(raw.control.strength ?? 0.85, 0, 10);
    base.control.global_denoise = clamp(raw.control.global_denoise ?? 0.35, 0.05, 0.75);
    base.control.denoise = clamp(raw.control.denoise ?? 0.35, 0.05, 1);
    base.control.general_patch = String(raw.control.general_patch || '');
    base.control.inpaint_patch = String(raw.control.inpaint_patch || '');
  }
  if (raw.artist && typeof raw.artist === 'object') {
    base.artist.pose_model = raw.artist.pose_model === 'lllite' ? 'lllite' : 'preview2';
    base.artist.preview_lora = String(raw.artist.preview_lora || '');
    base.artist.pose_patch = String(raw.artist.pose_patch || '');
    base.artist.character_denoise = clamp(raw.artist.character_denoise ?? 0.9, 0.2, 1);
  }
  const ids = new Set();
  base.objects = (Array.isArray(raw.objects) ? raw.objects : []).slice(0, 64).map((item, index) => {
    const idBase = String(item?.id || `object_${index + 1}`).slice(0, 80);
    let id = idBase; let suffix = index + 1;
    while (ids.has(id)) id = `${idBase}_${suffix++}`;
    ids.add(id);
    const bbox = Array.isArray(item?.bbox) && item.bbox.length === 4 ? item.bbox.map(Number) : [0.1, 0.1, 0.6, 0.6];
    const x1 = clamp(bbox[0], 0, 0.99); const y1 = clamp(bbox[1], 0, 0.99);
    const x2 = clamp(Math.max(x1 + 0.01, bbox[2]), 0.01, 1); const y2 = clamp(Math.max(y1 + 0.01, bbox[3]), 0.01, 1);
    const kind = ['background', 'character', 'prop'].includes(item?.kind) ? item.kind : item?.role === 'background' ? 'background' : 'prop';
    const posePreset = item?.pose?.preset === 'sitting' ? 'sitting' : 'standing';
    const keypoints = Array.isArray(item?.pose?.keypoints) && item.pose.keypoints.length >= 17
      ? item.pose.keypoints.slice(0, 17).map(point => [clamp(point?.[0] ?? .5, 0, 1), clamp(point?.[1] ?? .5, 0, 1)]) : clone(POSE_PRESETS[posePreset]);
    const generatedBox = Array.isArray(item?.generated_bbox) && item.generated_bbox.length === 4 ? item.generated_bbox.map(Number) : null;
    return {
      id, name: String(item?.name || `对象 ${index + 1}`).slice(0, 120), image: normalizeImageRef(item?.image),
      prompt: String(item?.prompt || '').slice(0, 4096), negative_prompt: String(item?.negative_prompt || '').slice(0, 4096),
      bbox: [x1, y1, x2, y2], rotation: clamp(item?.rotation || 0, -360, 360), depth: clamp(item?.depth ?? 0.5, 0, 1),
      z_index: Math.trunc(clamp(item?.z_index ?? index, -10000, 10000)), seed: Number.isFinite(Number(item?.seed)) ? Number(item.seed) : -1,
      locked: Boolean(item?.locked), visible: item?.visible !== false, region_mode: item?.region_mode === 'hard' ? 'hard' : 'soft',
      control_strength: clamp(item?.control_strength ?? 1, 0, 10), feather: clamp(item?.feather ?? 0.04, 0, 0.25),
      aspect_ratio: clamp(item?.aspect_ratio || 0, 0, 100),
      has_transparency: typeof item?.has_transparency === 'boolean' ? item.has_transparency : null,
      role: item?.role === 'background' ? 'background' : 'object',
      kind, generation_state: ['empty', 'planned', 'generating', 'generated', 'failed'].includes(item?.generation_state) ? item.generation_state : 'empty',
      pose: { preset: posePreset, keypoints }, image_full_canvas: Boolean(item?.image_full_canvas),
      generated_bbox: generatedBox ? [clamp(generatedBox[0], 0, 1), clamp(generatedBox[1], 0, 1), clamp(generatedBox[2], 0, 1), clamp(generatedBox[3], 0, 1)] : null,
    };
  });
  const validIds = new Set(base.objects.map(item => item.id));
  base.relations = (Array.isArray(raw.relations) ? raw.relations : []).slice(0, 128).map((item, index) => ({
    id: String(item?.id || `relation_${index + 1}`).slice(0, 80), source: String(item?.source || ''), target: String(item?.target || ''),
    description: String(item?.description || '').slice(0, 240), source_anchor: String(item?.source_anchor || 'center'), target_anchor: String(item?.target_anchor || 'center'),
  })).filter(item => validIds.has(item.source) && validIds.has(item.target) && item.source !== item.target);
  return base;
}

function selectedObject() { return state.scene.objects.find(item => item.id === state.selectedId) || null; }
function sortedObjects() { return [...state.scene.objects].sort((a, b) => a.z_index - b.z_index); }
function isArtistMode() { return state.scene.mode === 'artist'; }
function objectById(id) { return state.scene.objects.find(item => item.id === id) || null; }

function scheduleSave() {
  refs.saveState.textContent = '保存中…';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    localStorage.setItem(SCENE_KEY, JSON.stringify(state.scene));
    refs.saveState.textContent = '场景已保存';
  }, 250);
}

function sourceUrl(sceneObject) {
  const ref = sceneObject.image || {};
  return ref.url || (ref.filename ? imageUrl(ref) : '');
}

function ensureImage(sceneObject) {
  const url = sourceUrl(sceneObject);
  if (!url) return Promise.resolve(null);
  if (imageCache.has(url)) return imageCache.get(url);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`无法加载对象图片：${sceneObject.name}`));
    image.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

function canvasPoint(event) {
  const rect = refs.canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * refs.canvas.width / rect.width, y: (event.clientY - rect.top) * refs.canvas.height / rect.height };
}

function objectGeometry(sceneObject) {
  const [x1, y1, x2, y2] = sceneObject.bbox;
  const x = x1 * refs.canvas.width; const y = y1 * refs.canvas.height;
  const width = (x2 - x1) * refs.canvas.width; const height = (y2 - y1) * refs.canvas.height;
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2, angle: sceneObject.rotation * Math.PI / 180 };
}

function rotatePoint(point, cx, cy, angle) {
  const dx = point.x - cx; const dy = point.y - cy;
  return { x: cx + dx * Math.cos(angle) - dy * Math.sin(angle), y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function hitObject(point) {
  const objects = sortedObjects().reverse();
  for (const sceneObject of objects) {
    if (!sceneObject.visible) continue;
    const box = objectGeometry(sceneObject);
    const local = rotatePoint(point, box.cx, box.cy, -box.angle);
    if (local.x >= box.x && local.x <= box.x + box.width && local.y >= box.y && local.y <= box.y + box.height) return sceneObject;
  }
  return null;
}

function selectionHandles(sceneObject) {
  const box = objectGeometry(sceneObject);
  return {
    resize: rotatePoint({ x: box.x + box.width, y: box.y + box.height }, box.cx, box.cy, box.angle),
    rotate: rotatePoint({ x: box.cx, y: box.y - 34 * refs.canvas.height / 1024 }, box.cx, box.cy, box.angle),
  };
}

function setObjectSize(sceneObject, width, height, cx = null, cy = null) {
  const [x1, y1, x2, y2] = sceneObject.bbox;
  cx ??= (x1 + x2) / 2; cy ??= (y1 + y2) / 2;
  const scale = Math.min(1, 1 / width, 1 / height);
  width = clamp(width * scale, 0.01, 1); height = clamp(height * scale, 0.01, 1);
  const x = clamp(cx - width / 2, 0, 1 - width); const y = clamp(cy - height / 2, 0, 1 - height);
  sceneObject.bbox = [x, y, x + width, y + height];
}

function applyNaturalAspect(sceneObject, aspectRatio, anchor = 'height') {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
  sceneObject.aspect_ratio = aspectRatio;
  const [x1, y1, x2, y2] = sceneObject.bbox; let width = x2 - x1; let height = y2 - y1;
  const normalizedAspect = aspectRatio * state.scene.height / state.scene.width;
  if (anchor === 'width') height = width / normalizedAspect;
  else width = height * normalizedAspect;
  setObjectSize(sceneObject, width, height);
}

function near(a, b, radius) { return Math.hypot(a.x - b.x, a.y - b.y) <= radius; }

function drawTransformed(ctx, sceneObject, image, mode = 'image') {
  if (sceneObject.image_full_canvas) {
    const box = objectGeometry(sceneObject); const source = sceneObject.generated_bbox || sceneObject.bbox;
    const sourceWidth = Math.max(.01, source[2] - source[0]) * refs.canvas.width; const sourceHeight = Math.max(.01, source[3] - source[1]) * refs.canvas.height;
    const sourceCx = (source[0] + source[2]) / 2 * refs.canvas.width; const sourceCy = (source[1] + source[3]) / 2 * refs.canvas.height;
    ctx.save(); ctx.translate(box.cx, box.cy); ctx.rotate(box.angle); ctx.scale(box.width / sourceWidth, box.height / sourceHeight); ctx.translate(-sourceCx, -sourceCy);
    ctx.drawImage(image, 0, 0, refs.canvas.width, refs.canvas.height);
    if (mode !== 'image') { ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = mode; ctx.fillRect(0, 0, refs.canvas.width, refs.canvas.height); }
    ctx.restore(); return;
  }
  const box = objectGeometry(sceneObject);
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(box.angle);
  const drawImage = () => {
    if (sceneObject.role !== 'background') {
      ctx.drawImage(image, -box.width / 2, -box.height / 2, box.width, box.height);
      return;
    }
    const imageAspect = image.naturalWidth / image.naturalHeight; const boxAspect = box.width / box.height;
    let sx = 0; let sy = 0; let sw = image.naturalWidth; let sh = image.naturalHeight;
    if (imageAspect > boxAspect) { sw = sh * boxAspect; sx = (image.naturalWidth - sw) / 2; }
    else { sh = sw / boxAspect; sy = (image.naturalHeight - sh) / 2; }
    ctx.drawImage(image, sx, sy, sw, sh, -box.width / 2, -box.height / 2, box.width, box.height);
  };
  drawImage();
  if (mode !== 'image') {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = mode;
    ctx.fillRect(-box.width / 2, -box.height / 2, box.width, box.height);
  }
  ctx.restore();
}

function poseCanvasPoint(sceneObject, point) {
  const box = objectGeometry(sceneObject);
  return { x: box.x + point[0] * box.width, y: box.y + point[1] * box.height };
}

function drawArtistGroundShadow(ctx, item) {
  if (!isArtistMode() || item.kind !== 'character' || item.pose?.preset === 'sitting' || !item.image?.filename) return;
  const points = item.pose?.keypoints?.length >= 17 ? item.pose.keypoints : POSE_PRESETS.standing;
  const left = poseCanvasPoint(item, points[15]); const right = poseCanvasPoint(item, points[16]); const box = objectGeometry(item);
  const x = (left.x + right.x) / 2; const y = Math.max(left.y, right.y) + Math.max(2, box.height * .012);
  const radiusX = Math.max(12, Math.abs(right.x - left.x) * .8, box.width * .1); const radiusY = Math.max(3, box.height * .018);
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radiusX); gradient.addColorStop(0, 'rgba(12,16,24,.32)'); gradient.addColorStop(1, 'rgba(12,16,24,0)');
  ctx.save(); ctx.translate(x, y); ctx.scale(1, radiusY / radiusX); ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(0, 0, radiusX, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawArtistGraph(ctx) {
  for (const relation of state.scene.relations) {
    const source = objectById(relation.source); const target = objectById(relation.target);
    if (!source || !target) continue;
    const a = objectGeometry(source); const b = objectGeometry(target);
    const dx = b.cx - a.cx; const dy = b.cy - a.cy; const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length; const uy = dy / length;
    ctx.save(); ctx.strokeStyle = '#8b7cf6'; ctx.fillStyle = '#8b7cf6'; ctx.lineWidth = Math.max(2, refs.canvas.width / 600);
    ctx.beginPath(); ctx.moveTo(a.cx, a.cy); ctx.lineTo(b.cx, b.cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.cx, b.cy); ctx.lineTo(b.cx - ux * 14 - uy * 7, b.cy - uy * 14 + ux * 7); ctx.lineTo(b.cx - ux * 14 + uy * 7, b.cy - uy * 14 - ux * 7); ctx.closePath(); ctx.fill();
    const label = relation.description || `${source.name} → ${target.name}`; const x = (a.cx + b.cx) / 2; const y = (a.cy + b.cy) / 2;
    ctx.font = `${Math.max(10, refs.canvas.width / 72)}px sans-serif`; const width = Math.min(ctx.measureText(label).width + 14, refs.canvas.width * .62);
    ctx.fillStyle = 'rgba(12,14,20,.82)'; ctx.fillRect(x - width / 2, y - 18, width, 24); ctx.fillStyle = '#e9e6ff'; ctx.textAlign = 'center'; ctx.fillText(label, x, y - 2, width - 10); ctx.restore();
  }
  for (const item of sortedObjects().filter(value => value.visible)) {
    const box = objectGeometry(item); const colors = { background: '#5aa6ff', character: '#b7e43f', prop: '#f2b84b' };
    ctx.save(); ctx.strokeStyle = colors[item.kind] || '#f2b84b'; ctx.lineWidth = Math.max(2, refs.canvas.width / 600); ctx.setLineDash(item.image?.filename ? [8, 7] : []);
    if (!item.image?.filename) { ctx.fillStyle = `${ctx.strokeStyle}18`; ctx.fillRect(box.x, box.y, box.width, box.height); }
    ctx.strokeRect(box.x, box.y, box.width, box.height); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(10,12,16,.82)'; ctx.fillRect(box.x, box.y, Math.min(box.width, Math.max(86, item.name.length * 13)), 26);
    ctx.fillStyle = colors[item.kind] || '#fff'; ctx.font = `${Math.max(10, refs.canvas.width / 72)}px sans-serif`; ctx.textAlign = 'left'; ctx.fillText(item.name, box.x + 7, box.y + 18, box.width - 12);
    if (item.kind === 'character') {
      const points = item.pose?.keypoints?.length >= 17 ? item.pose.keypoints : POSE_PRESETS.standing;
      ctx.strokeStyle = '#56d7ff'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(2, refs.canvas.width / 560);
      for (const [start, end] of POSE_LIMBS) { const a = poseCanvasPoint(item, points[start]); const b = poseCanvasPoint(item, points[end]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      for (const point of points) { const p = poseCanvasPoint(item, point); ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, refs.canvas.width / 220), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
}

function updateCanvasDisplaySize() {
  const availableWidth = Math.max(1, refs.wrap.clientWidth - 2);
  const availableHeight = Math.max(1, refs.wrap.clientHeight - 2);
  const sceneAspect = state.scene.width / state.scene.height;
  let displayWidth = availableWidth; let displayHeight = displayWidth / sceneAspect;
  if (displayHeight > availableHeight) {
    displayHeight = availableHeight; displayWidth = displayHeight * sceneAspect;
  }
  refs.canvas.style.width = `${Math.floor(displayWidth)}px`;
  refs.canvas.style.height = `${Math.floor(displayHeight)}px`;
}

async function drawScene() {
  refs.canvas.width = state.scene.width;
  refs.canvas.height = state.scene.height;
  updateCanvasDisplaySize();
  const ctx = refs.canvas.getContext('2d');
  ctx.fillStyle = state.scene.background;
  ctx.fillRect(0, 0, refs.canvas.width, refs.canvas.height);
  let repairedMetadata = false;
  for (const sceneObject of sortedObjects()) {
    if (!sceneObject.visible) continue;
    try {
      const image = await ensureImage(sceneObject);
      if (image) {
        if (!sceneObject.aspect_ratio) {
          if (sceneObject.role === 'background') sceneObject.aspect_ratio = image.naturalWidth / image.naturalHeight;
          else applyNaturalAspect(sceneObject, image.naturalWidth / image.naturalHeight);
          repairedMetadata = true;
        }
        if (sceneObject.has_transparency === null) {
          sceneObject.has_transparency = detectTransparency(image);
          repairedMetadata = true;
          if (!sceneObject.has_transparency && sceneObject.role !== 'background') toast(`${sceneObject.name} 没有透明通道；作为前景时建议先抠图`, 'error');
        }
        drawArtistGroundShadow(ctx, sceneObject); drawTransformed(ctx, sceneObject, image);
      }
    } catch (error) { toast(error.message, 'error'); }
  }
  if (isArtistMode()) drawArtistGraph(ctx);
  const active = selectedObject();
  if (active?.visible) drawSelection(ctx, active);
  refs.empty.classList.toggle('hidden', state.scene.objects.length > 0);
  refs.meta.textContent = `${state.scene.width} × ${state.scene.height} · ${state.scene.objects.length} 个对象${isArtistMode() ? ` · ${state.scene.relations.length} 条关系` : ''}`;
  if (repairedMetadata) { scheduleSave(); syncObjectFields(); renderObjectList(); }
}

function drawSelection(ctx, sceneObject) {
  const box = objectGeometry(sceneObject);
  ctx.save();
  ctx.translate(box.cx, box.cy); ctx.rotate(box.angle);
  ctx.strokeStyle = sceneObject.locked ? '#f2b84b' : '#b7e43f'; ctx.lineWidth = Math.max(2, refs.canvas.width / 500);
  ctx.setLineDash([10, 7]); ctx.strokeRect(-box.width / 2, -box.height / 2, box.width, box.height); ctx.setLineDash([]);
  ctx.restore();
  const handles = selectionHandles(sceneObject); const radius = Math.max(7, refs.canvas.width / 120);
  for (const [name, point] of Object.entries(handles)) {
    ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = name === 'rotate' ? '#f2b84b' : '#b7e43f'; ctx.fill();
    ctx.strokeStyle = '#171911'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(box.cx, box.cy); ctx.lineTo(handles.rotate.x, handles.rotate.y); ctx.strokeStyle = '#f2b84b'; ctx.stroke();
}

function renderObjectList() {
  const ordered = sortedObjects().reverse();
  refs.objectCount.textContent = String(ordered.length);
  refs.objectList.innerHTML = ordered.length ? ordered.map(item => `
    <button class="scene-object-row ${item.id === state.selectedId ? 'active' : ''}" type="button" data-scene-object="${escapeAttr(item.id)}">
      ${sourceUrl(item) ? `<img src="${escapeAttr(sourceUrl(item))}" alt="">` : `<span class="scene-object-placeholder">${item.kind === 'character' ? '人' : item.kind === 'background' ? '景' : '物'}</span>`}<span><strong>${escapeHtml(item.name)}</strong><small>${item.visible ? `${isArtistMode() ? `${{background:'背景',character:'人物',prop:'道具'}[item.kind]} · ${item.generation_state}` : `${item.role === 'background' ? '背景 · ' : ''}Z ${item.z_index} · Depth ${item.depth.toFixed(2)}${item.has_transparency === false && item.role !== 'background' ? ' · 无透明通道' : ''}`}` : '已隐藏'}</small></span>
      <span class="scene-layer-state">${item.locked ? '🔒' : ''}${item.visible ? '' : '◌'}</span>
    </button>`).join('') : '<div class="lora-empty">上传图片后会显示图层</div>';
}

function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
function escapeAttr(value = '') { return escapeHtml(String(value)).replace(/"/g, '&quot;'); }

function syncSceneFields() {
  $('sceneWidth').value = state.scene.width; $('sceneHeight').value = state.scene.height;
  $('sceneGlobalPrompt').value = state.scene.global_prompt; $('sceneGlobalNegative').value = state.scene.global_negative_prompt;
  $('sceneBackground').value = state.scene.background; $('sceneControlSource').value = state.scene.control.source;
  $('sceneControlStrength').value = state.scene.control.strength; $('sceneGlobalDenoise').value = state.scene.control.global_denoise; $('sceneDenoise').value = state.scene.control.denoise;
  $('sceneGlobalDenoiseValue').textContent = Number(state.scene.control.global_denoise).toFixed(2);
  $('sceneDenoiseValue').textContent = Number(state.scene.control.denoise).toFixed(2);
  if (state.scene.control.general_patch) $('sceneGeneralPatch').value = state.scene.control.general_patch;
  if (state.scene.control.inpaint_patch) $('sceneInpaintPatch').value = state.scene.control.inpaint_patch;
  $('sceneArtistPoseModel').value = state.scene.artist.pose_model;
  $('sceneArtistDenoise').value = state.scene.artist.character_denoise; $('sceneArtistDenoiseValue').textContent = Number(state.scene.artist.character_denoise).toFixed(2);
  if (state.scene.artist.preview_lora) $('sceneArtistPreviewLora').value = state.scene.artist.preview_lora;
  if (state.scene.artist.pose_patch) $('sceneArtistPosePatch').value = state.scene.artist.pose_patch;
  document.querySelectorAll('[data-scene-mode]').forEach(button => button.classList.toggle('active', button.dataset.sceneMode === state.scene.mode));
  $('sceneComposerTools').hidden = isArtistMode(); $('sceneArtistTools').hidden = !isArtistMode();
  $('sceneRelationsPanel').hidden = !isArtistMode(); $('sceneComposerGenerationPanel').hidden = isArtistMode(); $('sceneArtistGenerationPanel').hidden = !isArtistMode();
  $('sceneArtistObjectFields').hidden = !isArtistMode(); refs.wrap.classList.toggle('artist-mode', isArtistMode());
  $('sceneEmptyTitle').textContent = isArtistMode() ? '选择工具后在画布上拖动画框' : '拖入或上传透明 PNG / WebP';
  $('sceneEmptyHint').textContent = isArtistMode() ? '背景、人物和道具框可用中心点连接关系' : '支持拖动、缩放、旋转与图层排序';
  renderRelations();
  syncObjectFields();
}

function syncObjectFields() {
  const item = selectedObject(); refs.inspector.hidden = !item;
  refs.sizeTools.hidden = !item;
  if (!item) return;
  const [x1, y1, x2, y2] = item.bbox;
  refs.scaleLabel.textContent = `${Math.round((x2 - x1) * 100)}% × ${Math.round((y2 - y1) * 100)}%`;
  refs.objectTitle.textContent = item.name;
  $('sceneObjectName').value = item.name; $('sceneObjectPrompt').value = item.prompt; $('sceneObjectNegative').value = item.negative_prompt;
  $('sceneObjectX').value = x1.toFixed(3); $('sceneObjectY').value = y1.toFixed(3);
  $('sceneObjectWidth').value = (x2 - x1).toFixed(3); $('sceneObjectHeight').value = (y2 - y1).toFixed(3);
  $('sceneObjectRotation').value = item.rotation.toFixed(1); $('sceneObjectDepth').value = item.depth.toFixed(2);
  $('sceneObjectRegionMode').value = item.region_mode; $('sceneObjectStrength').value = item.control_strength;
  $('sceneObjectKind').value = item.kind; $('scenePosePreset').value = item.pose?.preset || 'standing';
  $('scenePosePresetField').hidden = !isArtistMode() || item.kind !== 'character';
  $('sceneToggleLock').textContent = item.locked ? '解锁' : '锁定'; $('sceneToggleVisible').textContent = item.visible ? '隐藏' : '显示';
  $('sceneProcessOpaque').hidden = isArtistMode() || item.role === 'background'; $('sceneProcessOpaque').textContent = item.has_transparency ? '重新框选抠图' : '处理不透明图片';
  $('generateArtistObject').hidden = !isArtistMode() || item.kind === 'prop';
}

function renderRelations() {
  if (!refs.relationList) return;
  refs.relationCount.textContent = String(state.scene.relations.length);
  refs.relationList.innerHTML = state.scene.relations.length ? state.scene.relations.map(relation => {
    const source = objectById(relation.source); const target = objectById(relation.target);
    return `<div class="scene-relation-row"><span><strong>${escapeHtml(source?.name || relation.source)} → ${escapeHtml(target?.name || relation.target)}</strong><br>${escapeHtml(relation.description)}</span><button type="button" data-delete-relation="${escapeAttr(relation.id)}">×</button></div>`;
  }).join('') : '<div class="lora-empty">连接两个框后在这里编辑关系</div>';
  const options = state.scene.objects.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  $('sceneRelationSource').innerHTML = options; $('sceneRelationTarget').innerHTML = options;
  if (state.selectedId) $('sceneRelationSource').value = state.selectedId;
  const firstOther = state.scene.objects.find(item => item.id !== $('sceneRelationSource').value); if (firstOther) $('sceneRelationTarget').value = firstOther.id;
}

function setSceneMode(mode) {
  state.scene.mode = mode === 'artist' ? 'artist' : 'composer'; state.artistTool = 'select'; state.relationSource = null;
  scheduleSave(); renderAll(); if (state.scene.mode === 'artist') loadResources(true);
}

function setArtistTool(tool) {
  state.artistTool = state.artistTool === tool ? 'select' : tool; state.relationSource = null;
  document.querySelectorAll('[data-artist-tool]').forEach(button => button.classList.toggle('active', button.dataset.artistTool === state.artistTool));
  toast(state.artistTool === 'select' ? '已切换为选择工具' : state.artistTool === 'connect' ? '依次点击两个框建立关系' : '在画布上拖动创建框');
}

function scaleSelected(factor) {
  const item = selectedObject(); if (!item || item.locked) return;
  const [x1, y1, x2, y2] = item.bbox; const width = x2 - x1; const height = y2 - y1;
  const cx = (x1 + x2) / 2; const cy = (y1 + y2) / 2;
  factor = Math.min(factor, 1 / width, 1 / height);
  const nextWidth = clamp(width * factor, 0.02, 1); const nextHeight = clamp(height * factor, 0.02, 1);
  const nextX = clamp(cx - nextWidth / 2, 0, 1 - nextWidth); const nextY = clamp(cy - nextHeight / 2, 0, 1 - nextHeight);
  item.bbox = [nextX, nextY, nextX + nextWidth, nextY + nextHeight];
  scheduleSave(); syncObjectFields(); renderObjectList(); drawScene();
}

function fitSelected() {
  const item = selectedObject(); if (!item || item.locked) return;
  const width = item.bbox[2] - item.bbox[0]; const height = item.bbox[3] - item.bbox[1];
  scaleSelected(Math.min(0.82 / width, 0.82 / height));
}

function renderAll() { renderObjectList(); syncSceneFields(); drawScene(); }

function applyRecommendedPrompts() {
  state.scene.global_prompt = DEFAULT_GLOBAL_PROMPT; state.scene.global_negative_prompt = DEFAULT_GLOBAL_NEGATIVE;
  for (const item of state.scene.objects) {
    if (item.role === 'background') continue;
    if (!item.prompt.trim()) item.prompt = DEFAULT_OBJECT_PROMPT;
    if (!item.negative_prompt.trim()) item.negative_prompt = DEFAULT_OBJECT_NEGATIVE;
  }
  scheduleSave(); syncSceneFields(); toast('已应用推荐融合提示词');
}

function artistRelationText(id) {
  return state.scene.relations.filter(item => item.source === id || item.target === id).map(item => item.description).filter(Boolean).join(', ');
}

function characterSafeNegative(value) {
  return String(value || '').split(/[,，;；\n]+/).map(part => part.trim()).filter(part => part && !CHARACTER_NEGATIVE_PATTERNS.some(pattern => pattern.test(part))).join(', ');
}

function uncensorNegative(value) {
  return String(value || '').split(/[,，;；\n]+/).map(part => part.trim()).filter(part => part && !CENSORSHIP_NEGATIVE_PATTERNS.some(pattern => pattern.test(part))).join(', ');
}

function explicitCharacterPrompt(item) {
  const prompt = String(item.prompt || '').trim();
  const hasSubject = /\b(?:1girl|girl|woman|1boy|boy|man|female|male)\b/i.test(prompt) || /(?:少女|女孩|女性|男孩|少年|男性)/.test(prompt);
  const fallbackSubject = /^(?:人物|角色|character)\s*\d*$/i.test(item.name.trim())
    ? '1girl, adult white-haired anime woman, long soft hair, expressive eyes, detailed outfit'
    : `1girl, ${item.name}`;
  const grounding = item.pose?.preset === 'sitting'
    ? 'hips naturally supported by the related seat or surface, relaxed weight-bearing seated pose'
    : 'supporting foot firmly planted on the ground plane near the lower edge of the character box, believable weight and contact shadow';
  return [hasSubject ? '' : fallbackSubject, prompt, 'uncropped head and hair with clear breathing room above, complete hands and feet, the character is the clear main subject inside the masked region', grounding].filter(Boolean).join(', ');
}

function fallbackArtistPlan() {
  const props = state.scene.objects.filter(item => item.kind === 'prop').map(item => item.name).join(', ');
  const relations = state.scene.relations.map(item => item.description).filter(Boolean).join(', ');
  const background = state.scene.objects.find(item => item.kind === 'background');
  if (background) background.prompt = [state.scene.global_prompt, 'anime environment background, coherent perspective, empty stage prepared for the described characters', props && `include these scene objects: ${props}`, relations].filter(Boolean).join(', ');
  for (const item of state.scene.objects) {
    if (item.kind === 'character') item.prompt = [/^(?:人物|角色|character)\s*\d*$/i.test(item.name.trim()) ? '1girl, adult white-haired anime woman, long soft hair, expressive eyes, detailed outfit' : `1girl, ${item.name}`, 'solo, full body, correct anatomy, pose follows the control skeleton, consistent scale and perspective, lighting matches the environment, natural contact shadow', artistRelationText(item.id)].filter(Boolean).join(', ');
    if (item.kind === 'prop') item.prompt ||= `${item.name}, integrated scene prop, correct perspective and scale`;
    item.negative_prompt ||= DEFAULT_ARTIST_NEGATIVE; item.generation_state = 'planned';
    if (item.kind === 'character' && /坐|sit|seated/i.test(artistRelationText(item.id))) item.pose = defaultPose('sitting');
  }
  state.scene.global_negative_prompt ||= DEFAULT_ARTIST_NEGATIVE;
}

function applyArtistPlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Agent 返回的规划不是 JSON 对象');
  if (typeof plan.global_prompt === 'string' && plan.global_prompt.trim()) state.scene.global_prompt = plan.global_prompt.slice(0, 4096);
  if (typeof plan.global_negative_prompt === 'string' && plan.global_negative_prompt.trim()) state.scene.global_negative_prompt = uncensorNegative(plan.global_negative_prompt.slice(0, 4096));
  const planned = new Map((Array.isArray(plan.objects) ? plan.objects : []).map(item => [String(item.id || ''), item]));
  for (const item of state.scene.objects) {
    const next = planned.get(item.id); if (!next) continue;
    if (typeof next.prompt === 'string') item.prompt = next.prompt.slice(0, 4096);
    if (typeof next.negative_prompt === 'string') item.negative_prompt = uncensorNegative(next.negative_prompt.slice(0, 4096));
    if (item.kind === 'character' && ['standing', 'sitting'].includes(next.pose_preset)) item.pose = defaultPose(next.pose_preset);
    item.generation_state = 'planned';
  }
  if (state.scene.objects.some(item => item.kind === 'character')) state.scene.global_negative_prompt = uncensorNegative(characterSafeNegative(state.scene.global_negative_prompt));
}

async function streamArtistAgent(systemPrompt, content) {
  const response = await fetch('/launcher/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content }], system_prompt: systemPrompt }) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || `Agent 请求失败 (${response.status})`); }
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let output = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue; const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
      try { output += JSON.parse(data).choices?.[0]?.delta?.content || ''; } catch {}
    }
  }
  if (!output.trim()) throw new Error('Agent 没有返回规划');
  return JSON.parse(output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
}

async function planArtistScene() {
  if (!state.scene.objects.length) { toast('请先画出背景、人物或道具框', 'error'); return; }
  const button = $('planArtistScene'); button.disabled = true; button.textContent = '规划中…';
  const graph = {
    canvas: { width: state.scene.width, height: state.scene.height }, global_style: state.scene.global_prompt,
    objects: state.scene.objects.map(item => ({ id: item.id, name: item.name, kind: item.kind, bbox: item.bbox, pose_preset: item.pose?.preset })),
    relations: state.scene.relations.map(item => ({ source: item.source, target: item.target, description: item.description })),
  };
  const systemPrompt = 'You are the prompt planner for Anima anime image generation, including adult NSFW. Return JSON only, no markdown. Preserve every object id. Use rich English visual prompts. global_prompt contains only shared visual style, medium, color grade and lighting; put all environment content in the background object prompt. Props are generated as part of the background in this version. Every character prompt must begin with an explicit subject tag such as 1girl or 1boy, describe adult appearance and clothing or nudity, then state full-body pose, scale, viewpoint, lighting, contact and every relation. Follow requested clothing, nudity and sexual content explicitly; never rewrite them as modest clothing. Never add nsfw, sfw, safe, censored, nude or rating tags to any negative_prompt; negatives are quality and anatomy only. Characters are adults (18+). If a character has only a generic name such as Character 1, invent an adult anime woman with concrete appearance. If any character object exists, global_negative_prompt must never contain no humans, no people, no characters, empty scene, or equivalent phrases. Schema: {"global_prompt":"","global_negative_prompt":"","objects":[{"id":"","prompt":"","negative_prompt":"","pose_preset":"standing|sitting"}]}.';
  try { applyArtistPlan(await streamArtistAgent(systemPrompt, JSON.stringify(graph))); toast('Agent 已完成提示词和姿势规划'); }
  catch (error) { fallbackArtistPlan(); toast(`Agent 不可用，已采用本地模板：${error.message}`, 'error'); }
  finally { button.disabled = false; button.textContent = 'AI 规划'; scheduleSave(); renderAll(); }
}

async function uploadBlob(blob, filename) {
  const form = new FormData();
  form.append('image', blob, safeName(filename)); form.append('type', 'input'); form.append('subfolder', 'comfy_studio_scenes');
  const response = await fetch('/api/upload/image', { method: 'POST', body: form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `上传失败 (${response.status})`);
  return normalizeImageRef({ filename: result.name, subfolder: result.subfolder, type: result.type });
}

function detectTransparency(image) {
  const sample = document.createElement('canvas');
  const scale = Math.min(1, 192 / Math.max(image.naturalWidth, image.naturalHeight));
  sample.width = Math.max(1, Math.round(image.naturalWidth * scale)); sample.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = sample.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 250) return true;
  return false;
}

function drawCutoutEditor() {
  const session = state.cutout; if (!session) return;
  const image = session.image; const scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = refs.cutoutCanvas; canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const [x1, y1, x2, y2] = session.bbox; const x = x1 * canvas.width; const y = y1 * canvas.height; const width = (x2 - x1) * canvas.width; const height = (y2 - y1) * canvas.height;
  ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); ctx.restore();
  ctx.strokeStyle = '#b7e43f'; ctx.lineWidth = Math.max(2, canvas.width / 360); ctx.setLineDash([10, 6]); ctx.strokeRect(x, y, width, height); ctx.setLineDash([]);
}

function cutoutCanvasPoint(event) {
  const rect = refs.cutoutCanvas.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
}

function finishCutoutChoice(value) {
  const session = state.cutout; if (!session) return;
  state.cutout = null; session.resolve(value);
  if (refs.cutoutDialog.open) refs.cutoutDialog.close();
}

function setCutoutBusy(busy) {
  refs.cutoutApply.disabled = busy; $('sceneCutoutBackground').disabled = busy; $('sceneCutoutKeep').disabled = busy; $('sceneCutoutCancel').disabled = busy;
}

function chooseOpaqueImage(imageRef, image, name) {
  if (state.cutout) throw new Error('已有图片正在处理');
  refs.cutoutName.textContent = name; refs.cutoutStatus.textContent = '在图片上拖动矩形框，尽量完整包住主体';
  setCutoutBusy(false); refs.cutoutApply.textContent = '框选主体抠图'; refs.cutoutFeather.value = '2'; $('sceneCutoutFeatherValue').textContent = '2 px';
  return new Promise(resolve => {
    state.cutout = { imageRef, image, name, bbox: [0.06, 0.04, 0.94, 0.96], pointer: null, resolve };
    drawCutoutEditor(); refs.cutoutDialog.showModal();
  });
}

async function runSamCutout() {
  const session = state.cutout; if (!session) return;
  setCutoutBusy(true); refs.cutoutApply.textContent = 'SAM 处理中…'; refs.cutoutStatus.textContent = '正在本地加载 SAM 并生成透明蒙版，请稍候';
  try {
    const response = await fetch('/launcher/scene/cutout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: session.imageRef, bbox: session.bbox, feather: Number(refs.cutoutFeather.value) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `SAM 抠图失败 (${response.status})`);
    finishCutoutChoice({ mode: 'cutout', imageRef: normalizeImageRef(result) });
  } catch (error) {
    refs.cutoutStatus.textContent = error.message; toast(error.message, 'error'); setCutoutBusy(false); refs.cutoutApply.textContent = '重新抠图';
  }
}

function handleCutoutPointerDown(event) {
  const session = state.cutout; if (!session || refs.cutoutApply.disabled) return;
  const point = cutoutCanvasPoint(event); session.pointer = { start: point, previous: [...session.bbox] }; session.bbox = [point.x, point.y, point.x, point.y];
  refs.cutoutCanvas.setPointerCapture(event.pointerId); drawCutoutEditor();
}

function handleCutoutPointerMove(event) {
  const session = state.cutout; if (!session?.pointer) return;
  const point = cutoutCanvasPoint(event); const start = session.pointer.start;
  session.bbox = [Math.min(start.x, point.x), Math.min(start.y, point.y), Math.max(start.x, point.x), Math.max(start.y, point.y)]; drawCutoutEditor();
}

function handleCutoutPointerUp(event) {
  const session = state.cutout; if (!session?.pointer) return;
  if (session.bbox[2] - session.bbox[0] < 0.01 || session.bbox[3] - session.bbox[1] < 0.01) session.bbox = session.pointer.previous;
  session.pointer = null; try { refs.cutoutCanvas.releasePointerCapture(event.pointerId); } catch {} drawCutoutEditor();
}

async function addFiles(files) {
  const valid = [...files].filter(file => ['image/png', 'image/webp', 'image/jpeg'].includes(file.type));
  if (!valid.length) { toast('请选择 PNG、WebP 或 JPG 图片', 'error'); return; }
  refs.saveState.textContent = '正在上传…';
  let added = 0;
  for (const file of valid) {
    let imageRef = await uploadBlob(file, file.name);
    let objectImage = await ensureImage({ image: imageRef, name: file.name });
    let hasTransparency = detectTransparency(objectImage); let role = 'object';
    if (!hasTransparency) {
      const choice = await chooseOpaqueImage(imageRef, objectImage, file.name);
      if (!choice) continue;
      role = choice.mode === 'background' ? 'background' : 'object';
      if (choice.mode === 'cutout') {
        imageRef = choice.imageRef; objectImage = await ensureImage({ image: imageRef, name: file.name }); hasTransparency = true;
      }
    }
    const maxSide = 0.55; const aspect = objectImage.naturalWidth / objectImage.naturalHeight;
    const normalizedAspect = aspect * state.scene.height / state.scene.width;
    let width = normalizedAspect >= 1 ? maxSide : maxSide * normalizedAspect; let height = normalizedAspect >= 1 ? maxSide / normalizedAspect : maxSide;
    width = Math.max(0.08, width); height = Math.max(0.08, height);
    const index = state.scene.objects.length; const id = `object_${Date.now().toString(36)}_${index}`;
    const zValues = state.scene.objects.map(item => item.z_index); const zIndex = role === 'background' ? Math.min(0, ...zValues) - 1 : Math.max(-1, ...zValues) + 1;
    state.scene.objects.push({
      id, name: file.name.replace(/\.[^.]+$/, ''), image: imageRef, prompt: role === 'background' ? '' : DEFAULT_OBJECT_PROMPT, negative_prompt: role === 'background' ? '' : DEFAULT_OBJECT_NEGATIVE,
      bbox: role === 'background' ? [0, 0, 1, 1] : [0.5 - width / 2, 0.5 - height / 2, 0.5 + width / 2, 0.5 + height / 2], rotation: 0,
      depth: role === 'background' ? 1 : clamp(0.5 - index * 0.05, 0, 1), z_index: zIndex, seed: -1, locked: role === 'background', visible: true,
      region_mode: 'soft', control_strength: 1, feather: 0.04, aspect_ratio: aspect, has_transparency: hasTransparency, role,
      kind: role === 'background' ? 'background' : 'prop', generation_state: 'generated', pose: defaultPose(), image_full_canvas: false,
    });
    state.selectedId = id; added += 1;
  }
  scheduleSave(); renderAll(); if (added) toast(`已添加 ${added} 个对象`);
}

async function processSelectedCutout() {
  const item = selectedObject(); if (!item || item.role === 'background') return;
  const image = await ensureImage(item); const choice = await chooseOpaqueImage(item.image, image, item.name);
  if (!choice || choice.mode === 'keep') return;
  if (choice.mode === 'background') {
    const zValues = state.scene.objects.filter(value => value.id !== item.id).map(value => value.z_index);
    item.role = 'background'; item.kind = 'background'; item.bbox = [0, 0, 1, 1]; item.z_index = Math.min(0, ...zValues) - 1; item.depth = 1; item.rotation = 0; item.locked = true;
  } else {
    item.image = choice.imageRef; item.has_transparency = true; item.role = 'object';
  }
  scheduleSave(); renderAll(); toast(choice.mode === 'background' ? '已设为场景背景' : '已替换为透明抠图');
}

async function addGalleryItem(item) {
  let imageRef = normalizeImageRef(item);
  if (!imageRef.url) return;
  let image = await ensureImage({ image: imageRef, name: item.prompt || item.filename || '图库作品' });
  let hasTransparency = detectTransparency(image); let role = 'object';
  if (!hasTransparency) {
    const choice = await chooseOpaqueImage(imageRef, image, item.filename || '图库作品');
    if (!choice) return;
    role = choice.mode === 'background' ? 'background' : 'object';
    if (choice.mode === 'cutout') { imageRef = choice.imageRef; image = await ensureImage({ image: imageRef, name: item.filename || '图库作品' }); hasTransparency = true; }
  }
  const index = state.scene.objects.length; const id = `gallery_${Date.now().toString(36)}_${index}`;
  const zValues = state.scene.objects.map(value => value.z_index); const zIndex = role === 'background' ? Math.min(0, ...zValues) - 1 : Math.max(-1, ...zValues) + 1;
  const sceneObject = {
    id, name: String(item.prompt || item.filename || `图库对象 ${index + 1}`).slice(0, 120), image: imageRef,
    prompt: role === 'background' ? String(item.prompt || '') : String(item.prompt || DEFAULT_OBJECT_PROMPT), negative_prompt: role === 'background' ? String(item.settings?.negPrompt || '') : String(item.settings?.negPrompt || DEFAULT_OBJECT_NEGATIVE), bbox: role === 'background' ? [0, 0, 1, 1] : [0.2, 0.2, 0.8, 0.8],
    rotation: 0, depth: role === 'background' ? 1 : 0.5, z_index: zIndex, seed: Number(item.settings?.seed ?? -1), locked: role === 'background', visible: true,
    region_mode: 'soft', control_strength: 1, feather: 0.04, aspect_ratio: image.naturalWidth / image.naturalHeight, has_transparency: hasTransparency, role,
    kind: role === 'background' ? 'background' : 'prop', generation_state: 'generated', pose: defaultPose(), image_full_canvas: false,
  };
  state.scene.objects.push(sceneObject);
  state.selectedId = id; scheduleSave(); renderAll(); refs.galleryDialog.close();
  if (role !== 'background') applyNaturalAspect(sceneObject, image.naturalWidth / image.naturalHeight);
  scheduleSave(); renderAll();
}

function openGalleryPicker() {
  const items = loadJson(GALLERY_KEY, []);
  refs.galleryEmpty.classList.toggle('visible', !items.length);
  refs.galleryGrid.innerHTML = items.map((item, index) => `<button type="button" data-scene-gallery="${index}"><img src="${escapeAttr(item.url || imageUrl(item))}" alt=""><span>${escapeHtml(item.prompt || item.filename || '图库作品')}</span></button>`).join('');
  refs.galleryDialog.showModal();
}

function readSceneFields() {
  state.scene.width = Math.round(clamp($('sceneWidth').value, 64, 2048) / 8) * 8;
  state.scene.height = Math.round(clamp($('sceneHeight').value, 64, 2048) / 8) * 8;
  state.scene.global_prompt = $('sceneGlobalPrompt').value.slice(0, 4096); state.scene.global_negative_prompt = $('sceneGlobalNegative').value.slice(0, 4096);
  state.scene.background = $('sceneBackground').value; state.scene.control.source = $('sceneControlSource').value;
  state.scene.control.strength = clamp($('sceneControlStrength').value, 0, 10); state.scene.control.global_denoise = clamp($('sceneGlobalDenoise').value, 0.05, 0.75); state.scene.control.denoise = clamp($('sceneDenoise').value, 0.05, 1);
  state.scene.control.general_patch = $('sceneGeneralPatch').value; state.scene.control.inpaint_patch = $('sceneInpaintPatch').value;
  state.scene.artist.pose_model = $('sceneArtistPoseModel').value === 'lllite' ? 'lllite' : 'preview2';
  state.scene.artist.preview_lora = $('sceneArtistPreviewLora').value; state.scene.artist.pose_patch = $('sceneArtistPosePatch').value;
  state.scene.artist.character_denoise = clamp($('sceneArtistDenoise').value, 0.2, 1); $('sceneArtistDenoiseValue').textContent = state.scene.artist.character_denoise.toFixed(2);
  $('sceneGlobalDenoiseValue').textContent = state.scene.control.global_denoise.toFixed(2); $('sceneDenoiseValue').textContent = state.scene.control.denoise.toFixed(2);
  scheduleSave(); drawScene();
}

function readObjectFields(changedId = '') {
  const item = selectedObject(); if (!item) return;
  const x = clamp($('sceneObjectX').value, 0, 0.99); const y = clamp($('sceneObjectY').value, 0, 0.99);
  let width = clamp($('sceneObjectWidth').value, 0.01, 1 - x); let height = clamp($('sceneObjectHeight').value, 0.01, 1 - y);
  if (item.aspect_ratio > 0 && changedId === 'sceneObjectWidth') height = width * state.scene.width / (item.aspect_ratio * state.scene.height);
  if (item.aspect_ratio > 0 && changedId === 'sceneObjectHeight') width = height * item.aspect_ratio * state.scene.height / state.scene.width;
  const fit = Math.min(1, (1 - x) / width, (1 - y) / height); width *= fit; height *= fit;
  item.name = $('sceneObjectName').value.slice(0, 120); item.prompt = $('sceneObjectPrompt').value.slice(0, 4096);
  item.negative_prompt = $('sceneObjectNegative').value.slice(0, 4096); item.bbox = [x, y, x + width, y + height];
  item.rotation = clamp($('sceneObjectRotation').value, -360, 360); item.depth = clamp($('sceneObjectDepth').value, 0, 1);
  item.region_mode = $('sceneObjectRegionMode').value === 'hard' ? 'hard' : 'soft'; item.control_strength = clamp($('sceneObjectStrength').value, 0, 10);
  if (isArtistMode()) {
    item.kind = $('sceneObjectKind').value; item.role = item.kind === 'background' ? 'background' : 'object';
    const preset = $('scenePosePreset').value === 'sitting' ? 'sitting' : 'standing';
    if (!item.pose || item.pose.preset !== preset) item.pose = defaultPose(preset);
  }
  scheduleSave(); renderObjectList(); renderRelations(); refs.objectTitle.textContent = item.name; syncObjectFields(); drawScene();
}

function moveLayer(direction) {
  const item = selectedObject(); if (!item) return;
  const ordered = sortedObjects(); const index = ordered.findIndex(value => value.id === item.id); const other = ordered[index + direction];
  if (!other) return;
  [item.z_index, other.z_index] = [other.z_index, item.z_index]; scheduleSave(); renderAll();
}

function deleteSelected() {
  const index = state.scene.objects.findIndex(item => item.id === state.selectedId); if (index < 0) return;
  const id = state.scene.objects[index].id; state.scene.objects.splice(index, 1); state.scene.relations = state.scene.relations.filter(item => item.source !== id && item.target !== id);
  state.selectedId = state.scene.objects.at(-1)?.id || null; scheduleSave(); renderAll();
}

function createArtistObject(kind, start, point) {
  const x1 = clamp(Math.min(start.x, point.x) / refs.canvas.width, 0, 1); const y1 = clamp(Math.min(start.y, point.y) / refs.canvas.height, 0, 1);
  const x2 = clamp(Math.max(start.x, point.x) / refs.canvas.width, 0, 1); const y2 = clamp(Math.max(start.y, point.y) / refs.canvas.height, 0, 1);
  if (x2 - x1 < .025 || y2 - y1 < .025) return null;
  const counts = { background: '背景', character: '人物', prop: '道具' }; const index = state.scene.objects.filter(item => item.kind === kind).length + 1;
  const id = `${kind}_${Date.now().toString(36)}_${index}`; const z = kind === 'background' ? -100 + index : state.scene.objects.length;
  const item = {
    id, name: `${counts[kind]} ${index}`, kind, image: {}, prompt: '', negative_prompt: kind === 'character' ? DEFAULT_ARTIST_NEGATIVE : '',
    bbox: [x1, y1, x2, y2], rotation: 0, depth: kind === 'background' ? 1 : .5, z_index: z, seed: -1, locked: false, visible: true,
    region_mode: 'soft', control_strength: 1, feather: .04, aspect_ratio: 0, has_transparency: null, role: kind === 'background' ? 'background' : 'object',
    generation_state: 'empty', pose: defaultPose('standing'), image_full_canvas: false,
  };
  state.scene.objects.push(item); state.selectedId = id; return item;
}

function addRelation(sourceId, targetId, description = '') {
  if (!sourceId || !targetId || sourceId === targetId) { toast('关系需要两个不同对象', 'error'); return false; }
  const source = objectById(sourceId); const target = objectById(targetId); if (!source || !target) return false;
  const id = `relation_${Date.now().toString(36)}`;
  state.scene.relations.push({ id, source: sourceId, target: targetId, description: description.trim() || `${source.name} 位于 ${target.name} 附近`, source_anchor: 'center', target_anchor: 'center' });
  scheduleSave(); renderAll(); return true;
}

function hitPosePoint(item, point, radius) {
  if (item?.kind !== 'character') return -1;
  const points = item.pose?.keypoints || [];
  return points.findIndex(value => near(poseCanvasPoint(item, value), point, radius));
}

function handlePointerDown(event) {
  const point = canvasPoint(event); const active = selectedObject(); const radius = Math.max(16, refs.canvas.width / 60);
  if (isArtistMode() && ['background', 'character', 'prop'].includes(state.artistTool)) {
    state.pointer = { mode: 'create', kind: state.artistTool, start: point, point }; refs.canvas.setPointerCapture(event.pointerId); event.preventDefault(); drawScene(); return;
  }
  if (isArtistMode() && state.artistTool === 'connect') {
    const target = hitObject(point); if (!target) return;
    if (!state.relationSource) { state.relationSource = target.id; state.selectedId = target.id; toast(`已选择 ${target.name}，再点击关系目标`); renderAll(); }
    else { addRelation(state.relationSource, target.id); state.relationSource = null; setArtistTool('connect'); }
    return;
  }
  if (isArtistMode() && active) {
    const poseIndex = hitPosePoint(active, point, Math.max(12, refs.canvas.width / 80));
    if (poseIndex >= 0) { state.pointer = { id: active.id, mode: 'pose', poseIndex }; refs.canvas.setPointerCapture(event.pointerId); event.preventDefault(); return; }
  }
  let mode = 'drag'; let target = active;
  if (active && !active.locked) {
    const handles = selectionHandles(active);
    if (near(point, handles.rotate, radius)) mode = 'rotate';
    else if (near(point, handles.resize, radius)) mode = 'resize';
    else target = hitObject(point);
  } else target = hitObject(point);
  if (!target) { state.selectedId = null; renderAll(); return; }
  state.selectedId = target.id; renderObjectList(); syncObjectFields(); drawScene();
  if (target.locked) return;
  state.pointer = { id: target.id, mode, start: point, bbox: [...target.bbox], rotation: target.rotation };
  refs.canvas.setPointerCapture(event.pointerId); event.preventDefault();
}

function handlePointerMove(event) {
  if (!state.pointer) return;
  if (state.pointer.mode === 'create') { state.pointer.point = canvasPoint(event); drawScene().then(() => {
    const ctx = refs.canvas.getContext('2d'); const a = state.pointer?.start; const b = state.pointer?.point; if (!a || !b) return;
    ctx.save(); ctx.strokeStyle = '#b7e43f'; ctx.lineWidth = 3; ctx.setLineDash([10, 7]); ctx.strokeRect(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.abs(a.x-b.x), Math.abs(a.y-b.y)); ctx.restore();
  }); return; }
  const item = selectedObject(); if (!item || item.id !== state.pointer.id) return;
  const point = canvasPoint(event); const start = state.pointer.start; const initial = state.pointer.bbox;
  if (state.pointer.mode === 'pose') {
    const box = objectGeometry(item); item.pose.keypoints[state.pointer.poseIndex] = [clamp((point.x - box.x) / box.width, 0, 1), clamp((point.y - box.y) / box.height, 0, 1)];
  } else if (state.pointer.mode === 'drag') {
    const dx = (point.x - start.x) / refs.canvas.width; const dy = (point.y - start.y) / refs.canvas.height;
    const width = initial[2] - initial[0]; const height = initial[3] - initial[1];
    const x = clamp(initial[0] + dx, 0, 1 - width); const y = clamp(initial[1] + dy, 0, 1 - height); item.bbox = [x, y, x + width, y + height];
  } else if (state.pointer.mode === 'resize') {
    const width = initial[2] - initial[0]; const height = initial[3] - initial[1]; const angle = item.rotation * Math.PI / 180;
    const dx = point.x - start.x; const dy = point.y - start.y;
    const localDx = dx * Math.cos(angle) + dy * Math.sin(angle); const localDy = -dx * Math.sin(angle) + dy * Math.cos(angle);
    const scaleX = (width * refs.canvas.width + localDx) / (width * refs.canvas.width);
    const scaleY = (height * refs.canvas.height + localDy) / (height * refs.canvas.height);
    let factor = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    factor = clamp(factor, 0.02 / Math.max(width, height), Math.min((1 - initial[0]) / width, (1 - initial[1]) / height));
    item.bbox = [initial[0], initial[1], initial[0] + width * factor, initial[1] + height * factor];
  } else {
    const box = objectGeometry(item); item.rotation = Math.atan2(point.y - box.cy, point.x - box.cx) * 180 / Math.PI + 90;
  }
  syncObjectFields(); drawScene();
}

function handlePointerUp(event) {
  if (!state.pointer) return;
  if (state.pointer.mode === 'create') { const pointer = state.pointer; createArtistObject(pointer.kind, pointer.start, pointer.point); state.pointer = null; try { refs.canvas.releasePointerCapture(event.pointerId); } catch {} setArtistTool(pointer.kind); scheduleSave(); renderAll(); return; }
  state.pointer = null; try { refs.canvas.releasePointerCapture(event.pointerId); } catch {} scheduleSave(); renderObjectList();
}

async function renderArtifact(kind, onlyObject = null) {
  const canvas = document.createElement('canvas'); canvas.width = state.scene.width; canvas.height = state.scene.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: kind === 'lineart' || kind === 'seam' });
  const objects = onlyObject ? [onlyObject] : sortedObjects().filter(item => item.visible);
  if (kind === 'composite' || kind === 'lineart') { ctx.fillStyle = state.scene.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  if (kind === 'depth') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  for (const item of objects) {
    const image = await ensureImage(item); if (!image) continue;
    if (kind === 'depth') {
      const shade = Math.round((1 - item.depth) * 255); drawTransformed(ctx, item, image, `rgb(${shade},${shade},${shade})`);
    } else { if (kind === 'composite') drawArtistGroundShadow(ctx, item); drawTransformed(ctx, item, image); }
  }
  if (kind === 'mask') {
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (kind === 'lineart') return makeLineart(canvas);
  if (kind === 'seam') return makeSeamMask(objects);
  return canvas;
}

function makeLineart(source) {
  const output = document.createElement('canvas'); output.width = source.width; output.height = source.height;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true }); const outCtx = output.getContext('2d');
  const data = sourceCtx.getImageData(0, 0, source.width, source.height); const out = outCtx.createImageData(source.width, source.height);
  const gray = new Uint8Array(source.width * source.height);
  for (let i = 0, p = 0; i < data.data.length; i += 4, p++) gray[p] = (data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114) | 0;
  for (let y = 1; y < source.height - 1; y++) for (let x = 1; x < source.width - 1; x++) {
    const p = y * source.width + x;
    const gx = -gray[p - source.width - 1] - 2 * gray[p - 1] - gray[p + source.width - 1] + gray[p - source.width + 1] + 2 * gray[p + 1] + gray[p + source.width + 1];
    const gy = -gray[p - source.width - 1] - 2 * gray[p - source.width] - gray[p - source.width + 1] + gray[p + source.width - 1] + 2 * gray[p + source.width] + gray[p + source.width + 1];
    const value = Math.hypot(gx, gy) > 55 ? 0 : 255; const i = p * 4; out.data[i] = out.data[i + 1] = out.data[i + 2] = value; out.data[i + 3] = 255;
  }
  outCtx.putImageData(out, 0, 0); return output;
}

async function makeSeamMask(objects) {
  const output = document.createElement('canvas'); output.width = state.scene.width; output.height = state.scene.height;
  const ctx = output.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, output.width, output.height);
  const radius = Math.max(2, Math.round(Math.min(output.width, output.height) * 0.006));
  for (const item of objects) {
    const mask = document.createElement('canvas'); mask.width = output.width; mask.height = output.height;
    const maskCtx = mask.getContext('2d', { willReadFrequently: true }); const image = await ensureImage(item); drawTransformed(maskCtx, item, image);
    const pixels = maskCtx.getImageData(0, 0, mask.width, mask.height); const edge = maskCtx.createImageData(mask.width, mask.height);
    for (let y = radius; y < mask.height - radius; y++) for (let x = radius; x < mask.width - radius; x++) {
      const alpha = pixels.data[(y * mask.width + x) * 4] > 24;
      const changed = [[radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius, radius], [-radius, -radius], [radius, -radius], [-radius, radius]].some(([dx, dy]) => (pixels.data[((y + dy) * mask.width + x + dx) * 4] > 24) !== alpha);
      if (changed) { const i = (y * mask.width + x) * 4; edge.data[i] = edge.data[i + 1] = edge.data[i + 2] = edge.data[i + 3] = 255; }
    }
    maskCtx.putImageData(edge, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(mask, 0, 0);
  }
  return output;
}

function canvasBlob(canvas) { return new Promise(resolve => canvas.toBlob(resolve, 'image/png')); }

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportAssets() {
  if (!state.scene.objects.length) { toast('请先添加对象', 'error'); return; }
  const artifacts = [['composite', 'composite'], ['lineart', 'lineart'], ['depth', 'depth'], ['seam', 'seam-mask']];
  for (const [kind, name] of artifacts) downloadBlob(await canvasBlob(await renderArtifact(kind)), `anima-scene-${name}.png`);
  for (const item of sortedObjects().filter(value => value.visible)) downloadBlob(await canvasBlob(await renderArtifact('mask', item)), `anima-scene-mask-${safeName(item.name)}.png`);
  toast('已导出合成图、控制图和独立遮罩');
}

function exportScene() {
  const blob = new Blob([JSON.stringify(state.scene, null, 2)], { type: 'application/json' }); downloadBlob(blob, 'anima-scene.json');
}

async function importSceneFile(file) {
  try {
    const raw = JSON.parse(await file.text()); state.scene = normalizeScene(raw); state.selectedId = state.scene.objects[0]?.id || null;
    imageCache.clear(); scheduleSave(); renderAll(); await loadResources(); toast('场景已导入');
  } catch (error) { toast(`导入失败：${error.message}`, 'error'); }
}

function imageWidgetValue(ref) { return [ref.subfolder, ref.filename].filter(Boolean).join('/').replace(/\\/g, '/'); }

async function currentGenerationSettings() {
  const saved = loadJson(SETTINGS_KEY, {});
  const [unets, clips, vaes] = await Promise.all([api.get('/models/diffusion_models'), api.get('/models/text_encoders'), api.get('/models/vae')]);
  const choose = (selected, values, pattern) => values.includes(selected) ? selected : values.find(value => pattern.test(value)) || '';
  const unet = choose(saved.unet, unets, /anima/i); const clip = choose(saved.clip, clips, /qwen_3_06b_base/i); const vae = choose(saved.vae, vaes, /qwen[_-]?image[_-]?vae/i);
  if (!unet || !clip || !vae) throw new Error('缺少 Anima UNET、qwen_3_06b_base 文本编码器或 Qwen Image VAE');
  return {
    ...saved, unet, clip, vae, clipType: saved.clipType || 'stable_diffusion', weightDtype: saved.weightDtype || 'default',
    steps: Number(saved.steps || 35), cfg: Number(saved.cfg || 4), sampler: saved.sampler || 'er_sde', scheduler: saved.scheduler || 'simple',
    seed: Number(saved.seed) < 0 || !Number.isFinite(Number(saved.seed)) ? Math.floor(Math.random() * 2 ** 32) : Number(saved.seed),
  };
}

function artistCharacterBounds(item) {
  const [x1, y1, x2, y2] = item.bbox; const width = x2 - x1; const height = y2 - y1;
  return [
    clamp(x1 - Math.max(.025, width * .12), 0, 1),
    clamp(y1 - Math.max(.04, height * .2), 0, 1),
    clamp(x2 + Math.max(.025, width * .12), 0, 1),
    clamp(y2 + Math.max(.025, height * .1), 0, 1),
  ];
}

function renderArtistMask(item, outwardFeather = 0) {
  const hard = document.createElement('canvas'); hard.width = state.scene.width; hard.height = state.scene.height;
  const hardCtx = hard.getContext('2d'); hardCtx.fillStyle = '#000'; hardCtx.fillRect(0, 0, hard.width, hard.height);
  const [x1, y1, x2, y2] = artistCharacterBounds(item);
  hardCtx.fillStyle = '#fff'; hardCtx.fillRect(x1 * hard.width, y1 * hard.height, (x2 - x1) * hard.width, (y2 - y1) * hard.height);
  if (!outwardFeather) return hard;
  const output = document.createElement('canvas'); output.width = hard.width; output.height = hard.height;
  const ctx = output.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, output.width, output.height);
  ctx.filter = `blur(${outwardFeather}px)`; ctx.drawImage(hard, 0, 0); ctx.filter = 'none';
  ctx.globalCompositeOperation = 'lighten'; ctx.drawImage(hard, 0, 0); ctx.globalCompositeOperation = 'source-over';
  return output;
}

function renderPoseControl(item) {
  const canvas = document.createElement('canvas'); canvas.width = state.scene.width; canvas.height = state.scene.height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const colors = ['#ff0000','#ff8000','#ffff00','#80ff00','#00ff00','#00ff80','#00ffff','#0080ff','#0000ff','#8000ff','#ff00ff','#ff0080','#b4b4b4','#dcdcdc'];
  const points = item.pose?.keypoints?.length >= 17 ? item.pose.keypoints : POSE_PRESETS.standing;
  ctx.lineWidth = Math.max(2, canvas.width / 420); ctx.lineCap = 'round';
  POSE_LIMBS.forEach(([start, end], index) => { const a = poseCanvasPoint(item, points[start]); const b = poseCanvasPoint(item, points[end]); ctx.strokeStyle = colors[index % colors.length]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
  points.forEach((value, index) => { const point = poseCanvasPoint(item, value); ctx.fillStyle = index === 0 ? '#fff' : colors[index % colors.length]; ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(3, canvas.width / 210), 0, Math.PI * 2); ctx.fill(); });
  return canvas;
}

function renderArtistPoseControl(items) {
  const canvas = document.createElement('canvas'); canvas.width = state.scene.width; canvas.height = state.scene.height;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const colors = ['#ff0000','#ff8000','#ffff00','#80ff00','#00ff00','#00ff80','#00ffff','#0080ff','#0000ff','#8000ff','#ff00ff','#ff0080','#b4b4b4','#dcdcdc'];
  ctx.lineWidth = Math.max(2, canvas.width / 420); ctx.lineCap = 'round';
  for (const item of items) {
    const points = item.pose?.keypoints?.length >= 17 ? item.pose.keypoints : POSE_PRESETS.standing;
    POSE_LIMBS.forEach(([start, end], index) => { const a = poseCanvasPoint(item, points[start]); const b = poseCanvasPoint(item, points[end]); ctx.strokeStyle = colors[index % colors.length]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    points.forEach((value, index) => { const point = poseCanvasPoint(item, value); ctx.fillStyle = index === 0 ? '#fff' : colors[index % colors.length]; ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(3, canvas.width / 210), 0, Math.PI * 2); ctx.fill(); });
  }
  return canvas;
}

function artistPositionPrompt(item) {
  const [x1, y1, x2, y2] = item.bbox; const cx = (x1 + x2) / 2; const cy = (y1 + y2) / 2;
  const horizontal = cx < .34 ? 'left side' : cx > .66 ? 'right side' : 'center';
  const vertical = cy < .38 ? 'upper area' : cy > .68 ? 'foreground' : 'middle ground';
  return `${horizontal} of the frame in the ${vertical}, occupying about ${Math.round((x2 - x1) * 100)}% frame width and ${Math.round((y2 - y1) * 100)}% frame height`;
}

function artistPosePrompt(item) {
  const points = item.pose?.keypoints?.length >= 17 ? item.pose.keypoints : POSE_PRESETS.standing;
  if (item.pose?.preset === 'sitting') return 'clearly seated pose with bent knees and hips visibly supported by the related surface, pose follows the control skeleton exactly';
  const ankleGap = Math.abs(points[15][0] - points[16][0]); const ankleHeight = Math.abs(points[15][1] - points[16][1]);
  const wristGap = Math.abs(points[9][0] - points[10][0]);
  const stance = ankleGap > .3 ? 'wide stable stance with feet clearly separated' : ankleGap > .16 ? 'natural stance with feet slightly separated' : 'narrow standing stance';
  const feet = ankleHeight > .1 ? 'one supporting foot planted and the other foot visibly raised' : 'both supporting feet visibly planted on the ground plane';
  const arms = wristGap > .36 ? 'arms visibly separated on opposite sides of the torso' : 'arms held close to the torso';
  return `${stance}, ${feet}, ${arms}, head shoulders hips knees and ankles follow the control skeleton exactly`;
}

function balancedFullScenePrompt(parts) {
  const seen = new Set();
  return parts.join(', ').split(/[,，]+/).map(part => part.trim()).filter(part => {
    if (!part || /^score_[1-9]$/i.test(part) || /^safe$/i.test(part)) return false;
    const key = part.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true;
  }).join(', ');
}

async function buildArtistFullWorkflow() {
  const settings = await currentGenerationSettings(); const workflow = {}; let { model, clip, next } = appendArtistModelLoaders(workflow, settings, .45);
  const visible = state.scene.objects.filter(item => item.visible); const characters = visible.filter(item => item.kind === 'character');
  const background = visible.find(item => item.kind === 'background'); const props = visible.filter(item => item.kind === 'prop');
  const backgroundPrompt = String(background?.prompt || '').replace(/empty stage prepared for the described characters/gi, '').trim();
  const characterPrompts = characters.map(item => `${explicitCharacterPrompt(item)}, ${artistPosePrompt(item)}, positioned on the ${artistPositionPrompt(item)}`);
  const propPrompts = props.map(item => `${item.prompt || item.name}, positioned on the ${artistPositionPrompt(item)}`);
  const relations = state.scene.relations.map(item => item.description).filter(Boolean);
  const prompt = balancedFullScenePrompt([
    state.scene.global_prompt, backgroundPrompt, ...propPrompts, ...characterPrompts, ...relations,
    'one unified full-frame anime illustration generated as a single coherent scene, shared perspective, shared painterly rendering, consistent line weight, (muted natural dusk colors:1.5), (accurate exposure and neutral white balance:1.4), (soft low-contrast filmic lighting:1.4), restrained highlights and open shadow detail, subtle environmental color reflections, unified color grading and atmospheric depth, characters naturally occluded by and interacting with the environment, physically grounded feet, realistic contact and cast shadows, no collage or pasted layers',
  ].filter(Boolean));
  const negative = uncensorNegative([
    characters.length ? characterSafeNegative(state.scene.global_negative_prompt) : state.scene.global_negative_prompt,
    ...visible.map(item => item.negative_prompt).filter(Boolean), DEFAULT_ARTIST_NEGATIVE,
    'collage, pasted-on character, sticker effect, isolated studio lighting, mismatched rendering style, hard rectangular transition, missing contact shadow, (oversaturated colors:1.5), neon palette, excessive magenta, excessive orange, fluorescent vegetation, strong color cast, HDR look, crushed blacks, blown highlights, (overexposed white hair and skin:1.5), harsh contrast, glossy plastic skin',
  ].filter(Boolean).join(', '));
  if (characters.length) {
    const poseRef = await uploadBlob(await canvasBlob(renderArtistPoseControl(characters)), `artist-full-pose-${Date.now()}.png`);
    workflow['102'] = { class_type: 'LoadImage', inputs: { image: imageWidgetValue(poseRef) } };
    if (state.scene.artist.pose_model === 'preview2') {
      if (!state.scene.artist.preview_lora) throw new Error('未找到 anima_pose_preview2.safetensors');
      const loraId = String(next++); workflow[loraId] = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: state.scene.artist.preview_lora, strength_model: 1 } }; model = [loraId, 0];
      const poseLatentId = String(next++); workflow[poseLatentId] = { class_type: 'VAEEncode', inputs: { pixels: ['102', 0], vae: ['3', 0] } };
      const poseId = String(next++); workflow[poseId] = { class_type: 'AnimaControlApply', inputs: { model, control_latent: [poseLatentId, 0], control_embedder_path: state.scene.artist.preview_lora, strength: 1.35 } }; model = [poseId, 0];
    } else {
      if (!state.scene.artist.pose_patch) throw new Error('未找到 Anima Pose LLLite');
      const patchId = String(next++); workflow[patchId] = { class_type: 'ModelPatchLoader', inputs: { name: state.scene.artist.pose_patch } };
      const poseId = String(next++); workflow[poseId] = { class_type: 'AnimaLLLiteApply', inputs: { model, model_patch: [patchId, 0], image: ['102', 0], strength: 1, start_percent: 0, end_percent: 1 } }; model = [poseId, 0];
    }
  }
  workflow['100'] = { class_type: 'EmptyLatentImage', inputs: { width: state.scene.width, height: state.scene.height, batch_size: 1 } };
  workflow['200'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: prompt } };
  workflow['201'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: negative } };
  workflow['300'] = { class_type: 'KSampler', inputs: { model, positive: ['200', 0], negative: ['201', 0], latent_image: ['100', 0], seed: settings.seed, steps: settings.steps, cfg: settings.cfg, sampler_name: settings.sampler, scheduler: settings.scheduler, denoise: 1 } };
  workflow['301'] = { class_type: 'VAEDecode', inputs: { samples: ['300', 0], vae: ['3', 0] } };
  workflow['302'] = { class_type: 'SaveImage', inputs: { filename_prefix: 'ComfyStudio_Artist_FullScene', images: ['301', 0] } };
  return { workflow, seed: settings.seed, prompt };
}

function appendArtistModelLoaders(workflow, settings, strengthScale = 1) {
  workflow['1'] = { class_type: 'UNETLoader', inputs: { unet_name: settings.unet, weight_dtype: settings.weightDtype } };
  workflow['2'] = { class_type: 'CLIPLoader', inputs: { clip_name: settings.clip, type: settings.clipType, device: 'default' } };
  workflow['3'] = { class_type: 'VAELoader', inputs: { vae_name: settings.vae } };
  let model = ['1', 0]; let clip = ['2', 0]; let next = 20;
  for (const lora of (settings.loraStack || []).filter(item => item.enabled !== false && item.name)) {
    const id = String(next++); workflow[id] = { class_type: 'LoraLoader', inputs: { model, clip, lora_name: lora.name, strength_model: Number(lora.modelStr) * strengthScale, strength_clip: Number(lora.clipStr) * strengthScale } };
    model = [id, 0]; clip = [id, 1];
  }
  return { model, clip, next };
}

async function artistBaseInputRef() {
  if (state.lastResult?.url) { const response = await fetch(state.lastResult.url); if (response.ok) return uploadBlob(await response.blob(), `artist-base-${Date.now()}.png`); }
  return uploadBlob(await canvasBlob(await renderArtifact('composite')), `artist-base-${Date.now()}.png`);
}

async function buildArtistWorkflow(item) {
  const settings = await currentGenerationSettings(); const workflow = {}; let { model, clip, next } = appendArtistModelLoaders(workflow, settings);
  const relations = artistRelationText(item.id); const relationPrompt = relations && !item.prompt.includes(relations) ? relations : '';
  const prompt = item.kind === 'character'
    ? [explicitCharacterPrompt(item), relationPrompt, 'masterpiece, best quality, score_7, anime illustration, match the existing environment perspective, ambient lighting and color grade, natural contact shadow'].filter(Boolean).join(', ')
    : [state.scene.global_prompt, item.prompt, relationPrompt].filter(Boolean).join(', ');
  const globalNegative = item.kind === 'character' ? uncensorNegative(characterSafeNegative(state.scene.global_negative_prompt)) : uncensorNegative(state.scene.global_negative_prompt);
  const characterNegative = item.kind === 'character' ? 'cropped head, cropped hair, cropped hands, cropped feet, cut off limbs, floating feet, missing ground contact' : '';
  const negative = uncensorNegative([globalNegative, item.negative_prompt || DEFAULT_ARTIST_NEGATIVE, characterNegative].filter(Boolean).join(', '));
  let latent;
  if (item.kind === 'background') {
    workflow['100'] = { class_type: 'EmptyLatentImage', inputs: { width: state.scene.width, height: state.scene.height, batch_size: 1 } }; latent = ['100', 0];
  } else if (item.kind === 'character') {
    const maskFeather = Math.max(12, Math.round(Math.min(state.scene.width, state.scene.height) * .028));
    const [baseRef, maskRef, softMaskRef, poseRef] = await Promise.all([
      artistBaseInputRef(),
      uploadBlob(await canvasBlob(renderArtistMask(item)), `artist-mask-${Date.now()}.png`),
      uploadBlob(await canvasBlob(renderArtistMask(item, maskFeather)), `artist-mask-soft-${Date.now()}.png`),
      uploadBlob(await canvasBlob(renderPoseControl(item)), `artist-pose-${Date.now()}.png`),
    ]);
    workflow['100'] = { class_type: 'LoadImage', inputs: { image: imageWidgetValue(baseRef) } };
    workflow['101'] = { class_type: 'LoadImageMask', inputs: { image: imageWidgetValue(maskRef), channel: 'red' } };
    workflow['102'] = { class_type: 'LoadImage', inputs: { image: imageWidgetValue(poseRef) } };
    workflow['103'] = { class_type: 'LoadImageMask', inputs: { image: imageWidgetValue(softMaskRef), channel: 'red' } };
    if (state.scene.artist.pose_model === 'preview2') {
      if (!state.scene.artist.preview_lora) throw new Error('未找到 anima_pose_preview2.safetensors');
      const loraId = String(next++); workflow[loraId] = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: state.scene.artist.preview_lora, strength_model: 1 } }; model = [loraId, 0];
      const poseLatentId = String(next++); workflow[poseLatentId] = { class_type: 'VAEEncode', inputs: { pixels: ['102', 0], vae: ['3', 0] } };
      const poseId = String(next++); workflow[poseId] = { class_type: 'AnimaControlApply', inputs: { model, control_latent: [poseLatentId, 0], control_embedder_path: state.scene.artist.preview_lora, strength: 1 } }; model = [poseId, 0];
    } else {
      if (!state.scene.artist.pose_patch) throw new Error('未找到 Anima Pose LLLite');
      const patchId = String(next++); workflow[patchId] = { class_type: 'ModelPatchLoader', inputs: { name: state.scene.artist.pose_patch } };
      const poseId = String(next++); workflow[poseId] = { class_type: 'AnimaLLLiteApply', inputs: { model, model_patch: [patchId, 0], image: ['102', 0], strength: .8, start_percent: 0, end_percent: 1 } }; model = [poseId, 0];
    }
    if (state.scene.control.inpaint_patch) {
      const patchId = String(next++); workflow[patchId] = { class_type: 'ModelPatchLoader', inputs: { name: state.scene.control.inpaint_patch } };
      const applyId = String(next++); workflow[applyId] = { class_type: 'AnimaLLLiteApply', inputs: { model, model_patch: [patchId, 0], image: ['100', 0], mask: ['101', 0], strength: .85, start_percent: 0, end_percent: 1 } }; model = [applyId, 0];
    }
    workflow['110'] = { class_type: 'VAEEncode', inputs: { pixels: ['100', 0], vae: ['3', 0] } };
    workflow['111'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['110', 0], mask: ['103', 0] } }; latent = ['111', 0];
  } else throw new Error('首版道具框只作为背景锚点，不单独生成');
  workflow['200'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: prompt } };
  workflow['201'] = { class_type: 'CLIPTextEncode', inputs: { clip, text: negative } };
  workflow['300'] = { class_type: 'KSampler', inputs: { model, positive: ['200', 0], negative: ['201', 0], latent_image: latent, seed: item.seed >= 0 ? item.seed : settings.seed, steps: settings.steps, cfg: settings.cfg, sampler_name: settings.sampler, scheduler: settings.scheduler, denoise: item.kind === 'background' ? 1 : state.scene.artist.character_denoise } };
  workflow['301'] = { class_type: 'VAEDecode', inputs: { samples: ['300', 0], vae: ['3', 0] } };
  workflow['302'] = { class_type: 'SaveImage', inputs: { filename_prefix: item.kind === 'background' ? 'ComfyStudio_Artist_Background' : `ComfyStudio_Artist_${safeName(item.name)}`, images: ['301', 0] } };
  return { workflow, seed: workflow['300'].inputs.seed };
}

async function cutoutArtistCharacter(image, item) {
  const response = await fetch(imageUrl(image)); if (!response.ok) throw new Error('无法读取人物生成结果');
  const inputRef = await uploadBlob(await response.blob(), `artist-character-${Date.now()}.png`);
  const bbox = artistCharacterBounds(item);
  const cutoutResponse = await fetch('/launcher/scene/cutout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: inputRef, bbox, feather: 2 }) });
  const cutout = await cutoutResponse.json().catch(() => ({})); if (!cutoutResponse.ok) throw new Error(cutout.error || '人物自动分层失败');
  const bboxArea = (item.bbox[2] - item.bbox[0]) * (item.bbox[3] - item.bbox[1]);
  const minimumCoverage = Math.max(.015, bboxArea * .16); const maximumCoverage = Math.min(.85, bboxArea * 2.5 + .05);
  if (!Number.isFinite(cutout.alpha_coverage) || cutout.alpha_coverage < minimumCoverage || cutout.alpha_coverage > maximumCoverage) {
    throw new Error('生成结果中未检测到可靠人物，请检查提示词后重新生成');
  }
  const alphaBox = Array.isArray(cutout.alpha_bbox) && cutout.alpha_bbox.length === 4 ? cutout.alpha_bbox.map(Number) : null;
  if (!alphaBox?.every(Number.isFinite)) throw new Error('无法检测人物实际边界，请重新生成');
  const safeBox = artistCharacterBounds(item); const edgeMargin = Math.max(.006, Math.min(item.bbox[2] - item.bbox[0], item.bbox[3] - item.bbox[1]) * .018);
  if (alphaBox[0] - safeBox[0] < edgeMargin || alphaBox[1] - safeBox[1] < edgeMargin || safeBox[2] - alphaBox[2] < edgeMargin || safeBox[3] - alphaBox[3] < edgeMargin) {
    throw new Error('人物触碰生成安全区边缘，已阻止裁切分层；请扩大人物框后重新生成');
  }
  return normalizeImageRef(cutout);
}

function setArtistRunning(running, label = '') {
  state.running = running; ['generateArtistFull','generateArtistBackground','generateArtistAll','generateArtistObject','planArtistScene'].forEach(id => { $(id).disabled = running; });
  $('stopArtistGeneration').hidden = !running; refs.artistProgress.hidden = !running; refs.artistProgressLabel.textContent = label || '准备生成'; refs.artistProgressFill.style.width = running ? '4%' : '0%';
}

async function runArtistFullGeneration() {
  if (state.running) return; state.cancelled = false;
  if (!state.scene.objects.some(item => item.visible)) { toast('请先画出背景、人物或道具框', 'error'); return; }
  if (state.scene.objects.some(item => !item.prompt.trim())) fallbackArtistPlan();
  setArtistRunning(true, '正在准备全图成片');
  try {
    const { workflow, seed, prompt } = await buildArtistFullWorkflow(); refs.artistProgressLabel.textContent = '整张画布一次生成中'; refs.artistProgressFill.style.width = '12%';
    const result = await api.post('/prompt', { prompt: workflow, client_id: `artist-full-${Date.now().toString(36)}` }); const images = await waitForPrompt(result.prompt_id); const image = images.at(-1); const url = imageUrl(image);
    state.lastResult = { ...image, url, prompt, settings: { seed, scene: clone(state.scene), mode: 'artist-full' }, ts: Date.now() };
    refs.resultImage.src = url; refs.result.hidden = false; refs.downloadResult.href = url; refs.downloadResult.download = image.filename || 'anima-artist-full.png';
    const gallery = loadJson(GALLERY_KEY, []); gallery.unshift(state.lastResult); localStorage.setItem(GALLERY_KEY, JSON.stringify(gallery.slice(0, 150)));
    refs.artistProgressFill.style.width = '100%'; toast('全图成片完成');
  } catch (error) { toast(error.message, 'error'); }
  finally { setArtistRunning(false); scheduleSave(); }
}

async function runArtistObject(item, progressIndex = 0, progressTotal = 1) {
  item.generation_state = 'generating'; renderAll(); refs.artistProgressLabel.textContent = `正在生成：${item.name}`; refs.artistProgressFill.style.width = `${Math.max(6, progressIndex / progressTotal * 90)}%`;
  const { workflow, seed } = await buildArtistWorkflow(item); item.seed = seed;
  const result = await api.post('/prompt', { prompt: workflow, client_id: `artist-${Date.now().toString(36)}` }); const images = await waitForPrompt(result.prompt_id); const image = images.at(-1);
  state.lastResult = { ...image, url: imageUrl(image), prompt: item.prompt, settings: { seed, scene: clone(state.scene) }, ts: Date.now() };
  if (item.kind === 'background') { item.image = normalizeImageRef(image); item.bbox = [0, 0, 1, 1]; item.role = 'background'; item.has_transparency = false; item.image_full_canvas = false; }
  else { item.image = await cutoutArtistCharacter(image, item); item.has_transparency = true; item.image_full_canvas = true; item.generated_bbox = [...item.bbox]; }
  item.generation_state = 'generated'; refs.resultImage.src = state.lastResult.url; refs.result.hidden = false; refs.downloadResult.href = state.lastResult.url; scheduleSave(); renderAll();
}

async function runArtistGeneration(scope = 'all') {
  if (state.running) return; state.cancelled = false;
  if (!state.scene.objects.length) { toast('请先画出对象框', 'error'); return; }
  if (state.scene.objects.some(item => !item.prompt.trim())) fallbackArtistPlan();
  const background = state.scene.objects.find(item => item.kind === 'background'); const characters = sortedObjects().filter(item => item.kind === 'character' && item.visible);
  let queue = scope === 'background' ? (background ? [background] : []) : scope === 'selected' ? [selectedObject()].filter(Boolean) : [background, ...characters].filter(Boolean);
  if (!queue.length) { toast('没有可生成的背景或人物', 'error'); return; }
  setArtistRunning(true, '准备顺序生成');
  try {
    for (let index = 0; index < queue.length; index++) { if (state.cancelled) throw new Error('已停止生成'); await runArtistObject(queue[index], index, queue.length); }
    refs.artistProgressFill.style.width = '100%'; const gallery = loadJson(GALLERY_KEY, []); if (state.lastResult) { gallery.unshift(state.lastResult); localStorage.setItem(GALLERY_KEY, JSON.stringify(gallery.slice(0, 150))); }
    toast('艺术家模式顺序生成完成');
  } catch (error) { const active = queue.find(item => item.generation_state === 'generating'); if (active) active.generation_state = 'failed'; toast(error.message, 'error'); }
  finally { setArtistRunning(false); scheduleSave(); renderAll(); }
}

async function buildSceneWorkflow(mode) {
  if (!state.scene.objects.some(item => item.visible)) throw new Error('场景中没有可见对象');
  const settings = await currentGenerationSettings();
  const composite = await renderArtifact('composite'); const lineart = await renderArtifact('lineart'); const depth = await renderArtifact('depth'); const seam = await renderArtifact('seam');
  const controlCanvas = state.scene.control.source === 'lineart' ? lineart : state.scene.control.source === 'depth' ? depth : composite;
  const [compositeRef, controlRef, seamRef] = await Promise.all([
    uploadBlob(await canvasBlob(composite), `scene-composite-${Date.now()}.png`),
    uploadBlob(await canvasBlob(controlCanvas), `scene-control-${Date.now()}.png`),
    uploadBlob(await canvasBlob(seam), `scene-seam-${Date.now()}.png`),
  ]);
  let baseRef = compositeRef;
  if (mode === 'refine' && state.lastResult?.url) {
    const response = await fetch(state.lastResult.url); if (response.ok) baseRef = await uploadBlob(await response.blob(), `scene-result-${Date.now()}.png`);
  }
  const patch = mode === 'refine' ? state.scene.control.inpaint_patch : state.scene.control.general_patch;
  if (!patch) throw new Error(mode === 'refine' ? '未找到 Anima 修复 LLLite，请检查 models/model_patches' : '未找到 Anima 通用 LLLite，请检查 models/model_patches');

  const workflow = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: settings.unet, weight_dtype: settings.weightDtype } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: settings.clip, type: settings.clipType, device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: settings.vae } },
    '4': { class_type: 'ModelPatchLoader', inputs: { name: patch } },
    '5': { class_type: 'LoadImage', inputs: { image: imageWidgetValue(controlRef) } },
    '6': { class_type: 'LoadImage', inputs: { image: imageWidgetValue(baseRef) } },
    '7': { class_type: 'LoadImageMask', inputs: { image: imageWidgetValue(seamRef), channel: 'red' } },
    '8': { class_type: 'AkiAnimaSceneFromJSON', inputs: { scene_json: JSON.stringify(state.scene) } },
  };
  let model = ['1', 0]; let clip = ['2', 0]; let next = 20;
  for (const lora of (settings.loraStack || []).filter(item => item.enabled !== false && item.name)) {
    const id = String(next++); workflow[id] = { class_type: 'LoraLoader', inputs: { model, clip, lora_name: lora.name, strength_model: Number(lora.modelStr), strength_clip: Number(lora.clipStr) } };
    model = [id, 0]; clip = [id, 1];
  }
  const applyId = String(next++); workflow[applyId] = {
    class_type: 'AnimaLLLiteApply', inputs: { model, model_patch: ['4', 0], image: mode === 'refine' ? ['6', 0] : ['5', 0], strength: state.scene.control.strength, start_percent: 0, end_percent: 1 },
  };
  if (mode === 'refine') workflow[applyId].inputs.mask = ['7', 0];
  model = [applyId, 0];
  workflow['9'] = { class_type: 'AkiAnimaSceneConditioning', inputs: { scene: ['8', 0], clip } };
  let latent;
  if (mode === 'refine') {
    workflow['300'] = { class_type: 'VAEEncode', inputs: { pixels: ['6', 0], vae: ['3', 0] } };
    workflow['301'] = { class_type: 'SetLatentNoiseMask', inputs: { samples: ['300', 0], mask: ['7', 0] } }; latent = ['301', 0];
  } else {
    workflow['300'] = { class_type: 'VAEEncode', inputs: { pixels: ['6', 0], vae: ['3', 0] } }; latent = ['300', 0];
  }
  workflow['400'] = { class_type: 'KSampler', inputs: { model, positive: ['9', 0], negative: ['9', 1], latent_image: latent, seed: settings.seed, steps: settings.steps, cfg: settings.cfg, sampler_name: settings.sampler, scheduler: settings.scheduler, denoise: mode === 'refine' ? state.scene.control.denoise : state.scene.control.global_denoise } };
  workflow['401'] = { class_type: 'VAEDecode', inputs: { samples: ['400', 0], vae: ['3', 0] } };
  workflow['402'] = { class_type: 'SaveImage', inputs: { filename_prefix: mode === 'refine' ? 'ComfyStudio_AnimaScene_Refined' : 'ComfyStudio_AnimaScene', images: ['401', 0] } };
  return { workflow, seed: settings.seed };
}

function setRunning(running, label = '') {
  state.running = running; $('runSceneHarmonize').disabled = running; $('runSceneRefine').disabled = running; $('stopSceneGeneration').hidden = !running;
  refs.progress.hidden = !running; refs.progressLabel.textContent = label || '准备提交'; refs.progressFill.style.width = running ? '4%' : '0%';
  clearInterval(state.progressTimer);
  if (running) { let value = 4; state.progressTimer = setInterval(() => { value = Math.min(88, value + 2); refs.progressFill.style.width = `${value}%`; }, 1800); }
}

async function waitForPrompt(promptId) {
  const started = Date.now();
  while (!state.cancelled && Date.now() - started < 12 * 60 * 1000) {
    const history = await api.get(`/history/${encodeURIComponent(promptId)}`); const entry = history[promptId];
    if (entry?.status?.status_str === 'error') throw new Error(entry.status.messages?.at(-1)?.at(-1)?.exception_message || 'ComfyUI 执行失败');
    const images = Object.values(entry?.outputs || {}).flatMap(output => output.images || []);
    if (images.length) return images;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (state.cancelled) throw new Error('已停止生成');
  throw new Error('等待生成结果超时');
}

async function runScene(mode) {
  if (state.running) return;
  state.cancelled = false; readSceneFields(); setRunning(true, mode === 'refine' ? '正在准备接缝修复' : '正在准备全局融合');
  try {
    const { workflow, seed } = await buildSceneWorkflow(mode); refs.progressLabel.textContent = '已提交到 ComfyUI';
    const result = await api.post('/prompt', { prompt: workflow, client_id: `scene-${Date.now().toString(36)}` });
    const images = await waitForPrompt(result.prompt_id); const image = images.at(-1); const url = imageUrl(image);
    state.lastResult = { ...image, url, prompt: state.scene.global_prompt, settings: { seed, scene: clone(state.scene) }, ts: Date.now() };
    refs.resultImage.src = url; refs.result.hidden = false; refs.downloadResult.href = url; refs.downloadResult.download = image.filename || 'anima-scene.png';
    const gallery = loadJson(GALLERY_KEY, []); gallery.unshift(state.lastResult); localStorage.setItem(GALLERY_KEY, JSON.stringify(gallery.slice(0, 150)));
    refs.progressFill.style.width = '100%'; toast(mode === 'refine' ? '接缝修复完成' : '全局融合完成');
  } catch (error) { toast(error.message, 'error'); }
  finally { setRunning(false); }
}

async function loadResources(force = false) {
  if (force) state.resourcesLoaded = false;
  if (state.resourcesLoaded) return;
  try {
    const [patches, loras] = await Promise.all([api.get('/models/model_patches'), api.get('/models/loras')]);
    const options = values => values.length ? values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(shortName(value))}</option>`).join('') : '<option value="">未安装</option>';
    $('sceneGeneralPatch').innerHTML = options(patches); $('sceneInpaintPatch').innerHTML = options(patches);
    $('sceneArtistPreviewLora').innerHTML = options(loras.filter(value => /anima.*pose/i.test(value)));
    $('sceneArtistPosePatch').innerHTML = options(patches.filter(value => /anima.*pose/i.test(value)));
    const preferredGeneral = patches.find(value => /anima.*any.*v2/i.test(value)) || patches.find(value => /anima/i.test(value)) || '';
    const preferredInpaint = patches.find(value => /anima.*inpaint.*v2/i.test(value)) || patches.find(value => /anima.*inpaint/i.test(value)) || '';
    const preferredPreview = loras.find(value => /anima_pose_preview2/i.test(value)) || loras.find(value => /anima.*pose/i.test(value)) || '';
    const preferredPosePatch = patches.find(value => /anima.*lllite.*pose/i.test(value)) || patches.find(value => /anima.*pose/i.test(value)) || '';
    state.scene.control.general_patch = patches.includes(state.scene.control.general_patch) ? state.scene.control.general_patch : preferredGeneral;
    state.scene.control.inpaint_patch = patches.includes(state.scene.control.inpaint_patch) ? state.scene.control.inpaint_patch : preferredInpaint;
    state.scene.artist.preview_lora = loras.includes(state.scene.artist.preview_lora) ? state.scene.artist.preview_lora : preferredPreview;
    state.scene.artist.pose_patch = patches.includes(state.scene.artist.pose_patch) ? state.scene.artist.pose_patch : preferredPosePatch;
    state.resourcesLoaded = true; syncSceneFields(); scheduleSave();
  } catch { $('sceneGeneralPatch').innerHTML = $('sceneInpaintPatch').innerHTML = $('sceneArtistPreviewLora').innerHTML = $('sceneArtistPosePatch').innerHTML = '<option value="">连接 ComfyUI 后检测</option>'; }
}

function bindEvents() {
  document.querySelectorAll('[data-scene-mode]').forEach(button => button.addEventListener('click', () => setSceneMode(button.dataset.sceneMode)));
  document.querySelectorAll('[data-artist-tool]').forEach(button => button.addEventListener('click', () => setArtistTool(button.dataset.artistTool)));
  $('addSceneImages').addEventListener('click', () => refs.imageInput.click()); refs.imageInput.addEventListener('change', () => { addFiles(refs.imageInput.files).catch(error => toast(error.message, 'error')); refs.imageInput.value = ''; });
  let fileDragDepth = 0;
  const isSceneFileDrag = event => document.querySelector('.view.active')?.dataset.view === 'scene' && [...(event.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', event => {
    if (!isSceneFileDrag(event)) return;
    event.preventDefault(); fileDragDepth += 1; refs.wrap.classList.add('drag-over');
  });
  window.addEventListener('dragover', event => {
    if (!isSceneFileDrag(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', event => {
    if (!isSceneFileDrag(event)) return;
    event.preventDefault(); fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth) refs.wrap.classList.remove('drag-over');
  });
  window.addEventListener('drop', event => {
    if (!isSceneFileDrag(event)) return;
    event.preventDefault(); fileDragDepth = 0; refs.wrap.classList.remove('drag-over');
    addFiles(event.dataTransfer.files).catch(error => toast(error.message, 'error'));
  });
  $('addSceneGallery').addEventListener('click', openGalleryPicker); refs.galleryGrid.addEventListener('click', event => { const button = event.target.closest('[data-scene-gallery]'); if (button) addGalleryItem(loadJson(GALLERY_KEY, [])[Number(button.dataset.sceneGallery)]); });
  refs.cutoutCanvas.addEventListener('pointerdown', handleCutoutPointerDown); refs.cutoutCanvas.addEventListener('pointermove', handleCutoutPointerMove); refs.cutoutCanvas.addEventListener('pointerup', handleCutoutPointerUp); refs.cutoutCanvas.addEventListener('pointercancel', handleCutoutPointerUp);
  $('sceneCutoutBackground').addEventListener('click', () => finishCutoutChoice({ mode: 'background', imageRef: state.cutout?.imageRef }));
  $('sceneCutoutKeep').addEventListener('click', () => finishCutoutChoice({ mode: 'keep', imageRef: state.cutout?.imageRef }));
  $('sceneCutoutCancel').addEventListener('click', () => finishCutoutChoice(null)); refs.cutoutDialog.addEventListener('cancel', event => { event.preventDefault(); if (!refs.cutoutApply.disabled) finishCutoutChoice(null); });
  refs.cutoutApply.addEventListener('click', runSamCutout); refs.cutoutFeather.addEventListener('input', () => { $('sceneCutoutFeatherValue').textContent = `${refs.cutoutFeather.value} px`; });
  $('importScene').addEventListener('click', () => refs.jsonInput.click()); refs.jsonInput.addEventListener('change', () => { if (refs.jsonInput.files[0]) importSceneFile(refs.jsonInput.files[0]); refs.jsonInput.value = ''; });
  $('exportScene').addEventListener('click', exportScene); $('exportSceneAssets').addEventListener('click', () => exportAssets().catch(error => toast(error.message, 'error')));
  $('clearScene').addEventListener('click', () => { if (!state.scene.objects.length || confirm('清空当前场景中的全部对象？')) { state.scene = defaultScene(); state.selectedId = null; state.lastResult = null; refs.result.hidden = true; scheduleSave(); renderAll(); loadResources(); } });
  $('applyScenePromptDefaults').addEventListener('click', applyRecommendedPrompts);
  $('planArtistScene').addEventListener('click', () => planArtistScene());
  $('refreshArtistModels').addEventListener('click', async () => { const button = $('refreshArtistModels'); button.disabled = true; button.textContent = '检测中…'; await loadResources(true); button.disabled = false; button.textContent = '重新检测'; toast(state.scene.artist.preview_lora ? '已找到 Anima Pose 模型' : '仍未找到 Anima Pose 模型', state.scene.artist.preview_lora ? '' : 'error'); });
  refs.objectList.addEventListener('click', event => { const row = event.target.closest('[data-scene-object]'); if (row) { state.selectedId = row.dataset.sceneObject; renderAll(); } });
  refs.relationList.addEventListener('click', event => { const button = event.target.closest('[data-delete-relation]'); if (!button) return; state.scene.relations = state.scene.relations.filter(item => item.id !== button.dataset.deleteRelation); scheduleSave(); renderAll(); });
  $('addSceneRelation').addEventListener('click', () => { if (addRelation($('sceneRelationSource').value, $('sceneRelationTarget').value, $('sceneRelationDescription').value)) $('sceneRelationDescription').value = ''; });
  $('deleteSceneObject').addEventListener('click', deleteSelected); $('sceneLayerDown').addEventListener('click', () => moveLayer(-1)); $('sceneLayerUp').addEventListener('click', () => moveLayer(1));
  $('sceneScaleDown').addEventListener('click', () => scaleSelected(0.9)); $('sceneScaleUp').addEventListener('click', () => scaleSelected(1.1)); $('sceneFitObject').addEventListener('click', fitSelected);
  $('sceneToggleLock').addEventListener('click', () => { const item = selectedObject(); if (item) { item.locked = !item.locked; scheduleSave(); renderAll(); } });
  $('sceneToggleVisible').addEventListener('click', () => { const item = selectedObject(); if (item) { item.visible = !item.visible; scheduleSave(); renderAll(); } });
  $('sceneProcessOpaque').addEventListener('click', () => processSelectedCutout().catch(error => toast(error.message, 'error')));
  ['sceneWidth', 'sceneHeight', 'sceneGlobalPrompt', 'sceneGlobalNegative', 'sceneBackground', 'sceneControlSource', 'sceneControlStrength', 'sceneGlobalDenoise', 'sceneDenoise', 'sceneGeneralPatch', 'sceneInpaintPatch', 'sceneArtistPoseModel', 'sceneArtistPreviewLora', 'sceneArtistPosePatch', 'sceneArtistDenoise'].forEach(id => { $(id).addEventListener('input', readSceneFields); $(id).addEventListener('change', readSceneFields); });
  ['sceneObjectName', 'sceneObjectPrompt', 'sceneObjectNegative', 'sceneObjectX', 'sceneObjectY', 'sceneObjectWidth', 'sceneObjectHeight', 'sceneObjectRotation', 'sceneObjectDepth', 'sceneObjectRegionMode', 'sceneObjectStrength', 'sceneObjectKind', 'scenePosePreset'].forEach(id => { $(id).addEventListener('input', () => readObjectFields(id)); $(id).addEventListener('change', () => readObjectFields(id)); });
  refs.canvas.addEventListener('pointerdown', handlePointerDown); refs.canvas.addEventListener('pointermove', handlePointerMove); refs.canvas.addEventListener('pointerup', handlePointerUp); refs.canvas.addEventListener('pointercancel', handlePointerUp);
  new ResizeObserver(updateCanvasDisplaySize).observe(refs.wrap);
  $('runSceneHarmonize').addEventListener('click', () => runScene('harmonize')); $('runSceneRefine').addEventListener('click', () => runScene('refine'));
  $('stopSceneGeneration').addEventListener('click', async () => { state.cancelled = true; try { await api.post('/interrupt'); } catch {} });
  $('generateArtistFull').addEventListener('click', () => runArtistFullGeneration()); $('generateArtistBackground').addEventListener('click', () => runArtistGeneration('background')); $('generateArtistAll').addEventListener('click', () => runArtistGeneration('all')); $('generateArtistObject').addEventListener('click', () => runArtistGeneration('selected'));
  $('stopArtistGeneration').addEventListener('click', async () => { state.cancelled = true; try { await api.post('/interrupt'); } catch {} });
}

function init() {
  if (state.initialized) return;
  state.initialized = true; state.scene = normalizeScene(loadJson(SCENE_KEY, defaultScene())); state.selectedId = state.scene.objects[0]?.id || null;
  bindEvents(); renderAll(); loadResources();
}

window.sceneComposer = { activate() { init(); drawScene(); loadResources(); } };
if (document.querySelector('.view.active')?.dataset.view === 'scene' || location.hash === '#scene') window.sceneComposer.activate();

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const radians = n => n * Math.PI / 180;
export function wrapAzimuth(n) {
  n = ((Number(n) + 180) % 360 + 360) % 360 - 180;
  return n === -180 ? 180 : n;
}
export function normalizeCamera(value = {}) {
  value = value || {};
  const number = (key, fallback, low, high) => clamp(Number.isFinite(Number(value[key])) ? Number(value[key]) : fallback, low, high);
  return { enabled: value.enabled === true, azimuth: Number.isFinite(Number(value.azimuth)) ? wrapAzimuth(value.azimuth) : 0, elevation: number('elevation', 0, -80, 80), distance: number('distance', 4, 1.5, 9), weight: number('weight', 1.35, .5, 2), distanceWeight: number('distanceWeight', 1, 0, 2.5) };
}

// Prompt follows camera (x,z) around the subject origin.
// Facing +Z: x<0 is 主体右 / 右后方, x>0 is 主体左 / 左后方.
export function shotCoords(value) {
  const [x, y, z] = cameraPosition(value);
  return { x, y, z, onRight: x < 0, absAz: Math.abs(Math.atan2(x, z) * 180 / Math.PI) };
}
export function shotRegion(value) {
  const { onRight, absAz } = shotCoords(value);
  if (absAz <= 22) return '正面';
  if (absAz <= 78) return onRight ? '右前方' : '左前方';
  if (absAz <= 108) return onRight ? '右侧' : '左侧';
  if (absAz < 176) return onRight ? '右后方' : '左后方';
  return '正后方';
}
export function shotView(value) {
  const az = normalizeCamera(value).azimuth, absAz = Math.abs(az);
  if (absAz > 90) return 'from behind';
  const a = radians(az);
  const front = Math.max(0, Math.cos(a)), faceLeft = Math.max(0, Math.sin(a)), faceRight = Math.max(0, -Math.sin(a));
  if (front >= Math.max(faceLeft, faceRight)) return 'from front';
  return faceRight >= faceLeft ? 'facing right' : 'facing left';
}

function distanceTag(d) {
  if (d < 2.4) return 'close-up';
  if (d < 5.2) return 'medium shot';
  if (d < 7) return 'cowboy shot';
  if (d < 8.2) return 'full body';
  return 'wide shot';
}

// Anima_camera_angle / TK-BSK: 4-way sin/cos mix, then elevation + distance.
// Anima right slot (sin>0, our +X / 主体左) is facing left; left slot is facing right.
// CLIP budget stays near 1.2; their default 10 overcooks.
export function cameraPrompt(value) {
  const camera = normalizeCamera(value);
  if (!camera.enabled) return '';
  const a = radians(camera.azimuth);
  let front = Math.max(0, Math.cos(a)), back = Math.max(0, -Math.cos(a));
  let faceLeft = Math.max(0, Math.sin(a)), faceRight = Math.max(0, -Math.sin(a));
  const sum = front + back + faceRight + faceLeft;
  if (sum > 0) { front /= sum; back /= sum; faceRight /= sum; faceLeft /= sum; }
  const scale = camera.weight / 1.35;
  const eAbs = Math.abs(camera.elevation) / 80;
  const azGate = Math.max(0, Math.min(1, (1 - eAbs) / 0.1));
  const budget = 1.2 * scale * azGate;
  const parts = [];
  const emit = (tag, w) => {
    if (w < 0.05) return;
    parts.push('(' + tag + ':' + Math.min(2.5, Math.max(0.1, w)).toFixed(2) + ')');
  };
  emit('from front', front * budget);
  emit('from behind', back * budget);
  emit('facing left', faceLeft * budget);
  emit('facing right', faceRight * budget);
  const y = camera.elevation / 80;
  if (Math.abs(y) > 0.2) {
    const ew = Math.abs(y) * 1.2 * scale;
    if (y > 0) { emit('high angle', ew); emit('from above', ew); }
    else { emit('low angle', ew); emit('from below', ew); }
  }
  emit(distanceTag(camera.distance), camera.distanceWeight);
  return parts.join(', ');
}
export function cameraNegative(value) {
  return normalizeCamera(value).enabled ? 'multiple views, character sheet, reference sheet, panorama' : '';
}
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map(v => v * s);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = a => {
  const h = Math.hypot(...a);
  return h < 1e-8 ? [1, 0, 0] : mul(a, 1 / h);
};
export function cameraPosition(value) {
  const { azimuth, elevation, distance } = normalizeCamera(value);
  const a = radians(azimuth), e = radians(elevation);
  return [distance * Math.cos(e) * Math.sin(a), distance * Math.sin(e), distance * Math.cos(e) * Math.cos(a)];
}

// Keep the shot on the subject sphere: discard radial motion, then read azimuth from XZ.
export function sphereOrbit(position, worldMove) {
  const radius = Math.hypot(...position);
  if (radius < .1) return null;
  const radial = unit(position);
  const moved = add(position, sub(worldMove, mul(radial, dot(worldMove, radial))));
  const len = Math.hypot(...moved);
  if (len < .1) return null;
  const n = mul(moved, radius / len);
  return {
    azimuth: wrapAzimuth(Math.atan2(n[0], n[2]) * 180 / Math.PI),
    elevation: clamp(Math.asin(clamp(n[1] / radius, -1, 1)) * 180 / Math.PI, -80, 80),
    distance: radius,
  };
}

// Perspective projection of world-space geometry; editor navigation never edits the shot.
export class CameraEditor {
  constructor(root, onChange) {
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.onChange = onChange;
    this.shot = normalizeCamera();
    this.resetView();
    root.querySelectorAll('[data-camera-field]').forEach(input => input.addEventListener('input', () => {
      this.setValue({ ...this.shot, [input.dataset.cameraField]: input.type === 'checkbox' ? input.checked : Number(input.value) });
      this.onChange(this.shot);
    }));
    root.querySelector('[data-camera-reset-view]').onclick = () => { this.resetView(); this.draw(); };
    root.querySelector('[data-camera-reset]').onclick = () => { this.setValue({ enabled: this.shot.enabled }); this.onChange(this.shot); };
    root.querySelector('[data-camera-expand]').onclick = () => {
      root.classList.toggle('camera-expanded');
      root.querySelector('[data-camera-expand]').textContent = root.classList.contains('camera-expanded') ? '收起' : '放大';
      this.draw();
    };
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { root.classList.remove('camera-expanded'); root.querySelector('[data-camera-expand]').textContent = '放大'; }
    });
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
      this.view.distance = clamp(this.view.distance * Math.exp(clamp(delta, -500, 500) * .001), 3, 35);
      this.draw();
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
    const stop = () => { this.drag = null; this.canvas.style.cursor = 'grab'; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('lostpointercapture', stop);
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.canvas);
    this.setValue(this.shot);
  }

  resetView() { this.view = { azimuth: 38, elevation: 28, distance: 13, target: [0, 0, 0] }; }

  setValue(value) {
    this.shot = normalizeCamera(value);
    this.root.querySelector('[data-camera-body]').hidden = !this.shot.enabled;
    if (!this.shot.enabled) {
      this.root.classList.remove('camera-expanded');
      this.root.querySelector('[data-camera-expand]').textContent = '放大';
    }
    this.root.querySelectorAll('[data-camera-field]').forEach(input => {
      const value = this.shot[input.dataset.cameraField];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      const output = this.root.querySelector(`[data-camera-output="${input.dataset.cameraField}"]`);
      if (output) output.textContent = Number(value).toFixed(/distance|weight/i.test(input.dataset.cameraField) ? 1 : 0);
    });
    this.root.querySelector('[data-camera-preview]').textContent = this.shot.enabled ? shotRegion(this.shot) + '\n正向：' + cameraPrompt(this.shot) + '\n负向：' + cameraNegative(this.shot) : '未启用：不注入任何相机提示词';
    this.draw();
  }

  basis() {
    const a = radians(this.view.azimuth), e = radians(this.view.elevation);
    const back = [Math.cos(e)*Math.sin(a), Math.sin(e), Math.cos(e)*Math.cos(a)];
    const right = unit(cross([0, 1, 0], back));
    return { right, up: cross(back, right), back, eye: add(this.view.target, mul(back, this.view.distance)) };
  }

  project(point) {
    const offset = sub(point, this.b.eye), depth = -dot(offset, this.b.back);
    return { x: this.width/2 + dot(offset, this.b.right)*this.focal/depth, y: this.height/2 - dot(offset, this.b.up)*this.focal/depth, depth };
  }

  orbitShot(dx, dy) {
    const position = cameraPosition(this.shot);
    const p0 = this.project(position);
    if (p0.depth <= .1) return null;
    const next = sphereOrbit(position, mul(add(mul(this.b.right, dx), mul(this.b.up, -dy)), p0.depth / this.focal));
    return next ? { ...this.shot, ...next } : null;
  }

  pointerDown(event) {
    if (this.drag || ![0, 1, 2].includes(event.button)) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX-rect.left, y = event.clientY-rect.top;
    const point = this.project(cameraPosition(this.shot));
    if (event.button === 0 && (point.depth <= .1 || Math.hypot(x-point.x, y-point.y) > Math.max(25, this.focal*.5/point.depth))) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.drag = { id: event.pointerId, button: event.button, x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = 'grabbing';
  }

  pointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const dx = event.clientX-this.drag.x, dy = event.clientY-this.drag.y;
    this.drag.x = event.clientX; this.drag.y = event.clientY;
    if (this.drag.button === 2) {
      this.view.azimuth -= dx*.4;
      this.view.elevation = clamp(this.view.elevation+dy*.4, -85, 85);
    } else if (this.drag.button === 1) {
      this.view.target = add(this.view.target, mul(add(mul(this.b.right, -dx), mul(this.b.up, dy)), this.view.distance/this.focal));
    } else {
      const next = this.orbitShot(dx, dy);
      if (!next) return;
      this.setValue(next);
      this.onChange(this.shot);
    }
    this.draw();
  }

  draw() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.width = rect.width; this.height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width*dpr); this.canvas.height = Math.round(this.height*dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111b28'; ctx.fillRect(0, 0, this.width, this.height);
    this.b = this.basis(); this.focal = Math.min(this.width, this.height)*1.35;
    if (!this.b || !this.focal) return;
    const lines = [];
    const line = (a, b, color, width = 1) => lines.push({ a: this.project(a), b: this.project(b), color, width });
    for (let i=-6; i<=6; i++) {
      line([i,-.65,-6], [i,-.65,6], '#293848');
      line([-6,-.65,i], [6,-.65,i], '#293848');
    }
    line([0,0,0], [2,0,0], '#ec7780', 2);
    line([0,0,0], [0,2,0], '#6ddeae', 2);
    line([0,0,0], [0,0,2], '#7aaeff', 2);
    // Subject sphere, with a forward-facing marker on +Z.
    for (let ring=-2; ring<=2; ring++) {
      const y = ring*.2, radius = Math.sqrt(.36-y*y);
      for (let i=0; i<48; i++) {
        const a=i*Math.PI/24, b=(i+1)*Math.PI/24;
        line([radius*Math.cos(a),y,radius*Math.sin(a)], [radius*Math.cos(b),y,radius*Math.sin(b)], '#90bfd0');
      }
    }
    for (let ring=0; ring<6; ring++) {
      const angle=ring*Math.PI/6;
      for (let i=0; i<48; i++) {
        const a=i*Math.PI/24, b=(i+1)*Math.PI/24;
        line([.6*Math.cos(a)*Math.cos(angle),.6*Math.sin(a),.6*Math.cos(a)*Math.sin(angle)], [.6*Math.cos(b)*Math.cos(angle),.6*Math.sin(b),.6*Math.cos(b)*Math.sin(angle)], '#6d93a9');
      }
    }
    const position = cameraPosition(this.shot), forward = unit(mul(position,-1));
    let right = cross(forward, [0, 1, 0]);
    right = Math.hypot(...right) < 1e-6 ? [1, 0, 0] : unit(right);
    const up = cross(right, forward);
    const local = (x,y,z) => add(position, add(mul(right,x),add(mul(up,y),mul(forward,z))));
    const corners = [[-.38,-.25],[.38,-.25],[.38,.25],[-.38,.25]];
    for (let i=0; i<4; i++) {
      const a=corners[i], b=corners[(i+1)%4];
      line(local(...a,0),local(...b,0),'#ffcf75',3);
      line(local(...a,0),local(a[0]*.6,a[1]*.6,.45),'#ffcf75',2);
      line(local(a[0]*.6,a[1]*.6,.45),local(b[0]*.6,b[1]*.6,.45),'#ffcf75',2);
      line(local(a[0]*.6,a[1]*.6,.45),[0,0,0],'#6f634c');
    }
    line(local(-.38,0,0),local(.38,0,0),'#ec7780',2);
    line(position,[0,0,0],'#d4a656',2);
    line([0,.12,.55],[0,-.04,.78],'#7aaeff',2);
    line([-.14,-.04,.55],[0,-.04,.78],'#7aaeff',2);
    line([.14,-.04,.55],[0,-.04,.78],'#7aaeff',2);
    lines.sort((a,b) => (b.a.depth+b.b.depth)-(a.a.depth+a.b.depth));
    for (const segment of lines) {
      if (segment.a.depth < .1 || segment.b.depth < .1) continue;
      ctx.strokeStyle=segment.color; ctx.lineWidth=segment.width;
      ctx.beginPath(); ctx.moveTo(segment.a.x,segment.a.y); ctx.lineTo(segment.b.x,segment.b.y); ctx.stroke();
    }
    const label = (text, world, color) => {
      const p=this.project(world); if(p.depth<.1) return;
      ctx.font='12px sans-serif'; ctx.fillStyle='#111b28'; ctx.fillRect(p.x-4,p.y-14,ctx.measureText(text).width+8,19);
      ctx.fillStyle=color; ctx.fillText(text,p.x,p.y);
    };
    label('中心主体', [0,.9,0], '#b3dce7'); label('正面 +Z',[0,0,2.2],'#7aaeff');
    label('主体右',[ -2.1,0,0],'#ec7780'); label('主体左',[2.1,0,0],'#6db3d4'); label('Y',[0,2.1,0],'#6ddeae');
    const filmRight = local(.42, .08, 0), filmLeft = local(-.42, .08, 0);
    if (filmRight[0] <= filmLeft[0]) { label('右', filmRight, '#ec7780'); label('左', filmLeft, '#6db3d4'); }
    else { label('右', filmLeft, '#ec7780'); label('左', filmRight, '#6db3d4'); }
    label('相机 · 左键拖动',add(position,[0,.55,0]),'#ffcf75');
  }
}

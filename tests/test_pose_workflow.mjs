import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { buildWorkflow, poseSampleSize } from '../../../web/launcher/assets/js/core.js';

const app = readFileSync(new URL('../../../web/launcher/assets/js/app.js', import.meta.url), 'utf8');
const functions = ['officialPoseJson', 'parsePoseJson'].map(name => app.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');
const points = Array.from({ length: 17 }, (_, i) => [i / 16, 1 - i / 16, 1]);

for (const [width, height] of [[1152, 1536], [1536, 1152], [1024, 1024], [512, 768]]) {
  test(`editor coordinates survive square rendering and cropping at ${width}x${height}`, () => {
    const context = vm.createContext({
      refs: { width: { value: width }, height: { value: height } },
      state: { pose: { resolution: 1024 } },
      poseControlSize: poseSampleSize,
      clamp: (x, low, high) => Math.max(low, Math.min(high, x)),
      POSE_LIMBS: [[5, 7]], points,
    });
    vm.runInContext(functions + '\nvar encoded = officialPoseJson(points, 1024); var restored = parsePoseJson(encoded);', context);
    const pose = JSON.parse(context.encoded);
    const size = poseSampleSize(width, height);
    const side = Math.max(size.width, size.height);
    for (let i = 0; i < points.length; i++) {
      // These are the final control-map pixel coordinates after ImageScale's center crop.
      const x = pose.points[i][0] * side / 1024 - (side - size.width) / 2;
      const y = pose.points[i][1] * side / 1024 - (side - size.height) / 2;
      assert.ok(Math.abs(x - points[i][0] * size.width) < 1e-6);
      assert.ok(Math.abs(y - points[i][1] * size.height) < 1e-6);
      assert.ok(Math.abs(context.restored[i][0] - points[i][0]) < 1e-6);
      assert.ok(Math.abs(context.restored[i][1] - points[i][1]) < 1e-6);
    }
  });
}

const settings = { mode: 'unet', width: 1152, height: 1536, seed: 42, batchSize: 1,
  prompt: 'unchanged prompt', negPrompt: 'unchanged negative', loraStack: [],
  poseControl: { poseJson: '{}', resolution: 1024, lora: 'anima_pose_preview2.safetensors', template: 'w_sitting' } };

test('Pose saves the capped native output without enlarging it or injecting the pose name', () => {
  const { workflow } = buildWorkflow(settings);
  assert.equal(workflow['5'].inputs.width, 768);
  assert.equal(workflow['5'].inputs.height, 1024);
  assert.deepEqual(workflow['9'].inputs.images, ['8', 0]);
  assert.equal(workflow['105'], undefined);
  assert.equal(workflow['6'].inputs.text, settings.prompt);
  assert.equal(workflow['7'].inputs.text, settings.negPrompt);
  assert.ok(Math.max(...Object.values(poseSampleSize(1152, 1536, 2048))) <= 1024);
});

test('normal generation retains its requested resolution and LoRA settings', () => {
  const { workflow } = buildWorkflow({ ...settings, poseControl: null,
    loraStack: [{ name: 'style.safetensors', modelStr: .7, clipStr: .8 }] });
  assert.equal(workflow['5'].inputs.width, 1152);
  assert.equal(workflow['5'].inputs.height, 1536);
  assert.equal(workflow['20'].inputs.strength_model, .7);
});

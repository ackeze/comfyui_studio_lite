const SEEN_KEY = 'comfy_studio_tutorial_seen_v1';
const STEPS = [
  { view: 'ai', title: 'AI 助手', text: '描述需求，让 AI 协助创作、调整参数和提交生成。' },
  { view: 'studio', title: '创作', text: '手动编辑提示词、选择模型并生成图片。' },
  { view: 'video', title: '视频', text: '设置视频描述与生成参数，制作视频。' },
  { view: 'gallery', title: '图库', text: '查看、下载生成作品，复用生成参数。' },
  { view: 'presets', title: '预设', text: '保存常用配置，下次快速调用。' },
  { view: 'reverse', title: '反推', text: '从图片中提取画面描述和提示词。' },
  { view: 'settings', title: '设置', text: '配置 AI 服务、连接和界面偏好。' },
];

export function initTutorial(switchView, setSettings) {
  const dialog = document.getElementById('tutorialDialog');
  const card = dialog.querySelector('.tutorial-card');
  const marker = dialog.querySelector('.tutorial-marker');
  const title = document.getElementById('tutorialTitle');
  const text = document.getElementById('tutorialText');
  const progress = document.getElementById('tutorialProgress');
  const back = document.getElementById('tutorialBack');
  const next = document.getElementById('tutorialNext');
  const launch = document.getElementById('openTutorial');
  let index = 0;
  let returnView = 'ai';
  let target;

  function notifyParent(active, view) {
    if (window.parent !== window) window.parent.postMessage({ type: 'comfy-mobile-tutorial', active, view }, '*');
  }

  function position() {
    if (!dialog.open) return;
    const rect = target?.getBoundingClientRect();
    const visible = rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    marker.hidden = !visible;
    if (visible) {
      Object.assign(marker.style, { left: `${rect.left - 4}px`, top: `${rect.top - 4}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` });
    }
    card.style.removeProperty('left');
    card.style.removeProperty('top');
    if (innerWidth >= 1024 && visible && !document.documentElement.classList.contains('embedded')) {
      const settings = STEPS[index].view === 'settings';
      const panel = settings ? document.querySelector('#settingsSheet .settings-panel').getBoundingClientRect() : null;
      const left = settings ? panel.right - card.offsetWidth - 24 : rect.right + 20;
      const top = settings ? document.getElementById('saveSettings').getBoundingClientRect().top - card.offsetHeight - 24 : rect.top;
      card.style.left = `${Math.max(16, Math.min(left, innerWidth - card.offsetWidth - 16))}px`;
      card.style.top = `${Math.max(16, Math.min(top, innerHeight - card.offsetHeight - 16))}px`;
    }
  }

  function showStep() {
    const step = STEPS[index];
    setSettings(step.view === 'settings');
    if (step.view !== 'settings') switchView(step.view);
    title.textContent = step.title;
    text.textContent = step.text;
    progress.textContent = `页面指南 · ${index + 1} / ${STEPS.length}`;
    back.disabled = index === 0;
    next.textContent = index === STEPS.length - 1 ? '开始使用' : '下一步';
    target = step.view === 'settings' ? document.querySelector('#settingsSheet .sheet-head') : document.querySelector(`[data-nav="${step.view}"]`);
    if (!target?.getClientRects().length) target = document.querySelector(`#${step.view}View .agent-top, #${step.view}View .page-head, #${step.view}View .stage-head`);
    notifyParent(true, step.view);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      card.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.16,1,.3,1)' });
      if (step.view !== 'settings') document.querySelector('.view.active').animate([{ opacity: .6 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }
    requestAnimationFrame(() => { if (dialog.open) { position(); next.focus({ preventScroll: true }); } });
  }

  function start(firstVisit = false) {
    if (dialog.open) return;
    returnView = firstVisit ? 'ai' : document.querySelector('.view.active')?.dataset.view || 'ai';
    index = 0;
    dialog.showModal();
    showStep();
  }

  next.addEventListener('click', () => {
    if (index === STEPS.length - 1) dialog.close();
    else { index++; showStep(); }
  });
  back.addEventListener('click', () => { if (index > 0) { index--; showStep(); } });
  document.getElementById('tutorialSkip').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    try { localStorage.setItem(SEEN_KEY, 'true'); } catch {}
    setSettings(false);
    switchView(returnView);
    notifyParent(false, returnView);
    launch.focus({ preventScroll: true });
  });
  launch.addEventListener('click', () => start());
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  // Settings sheets animate into place underneath the guide.
  document.getElementById('settingsSheet').addEventListener('transitionend', position);
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    if (event.data?.type === 'comfy-mobile-tutorial-check') notifyParent(dialog.open, dialog.open ? STEPS[index].view : document.querySelector('.view.active')?.dataset.view || 'ai');
  });
  let seen = false;
  try { seen = localStorage.getItem(SEEN_KEY) === 'true'; } catch {}
  if (!seen) start(true);
}

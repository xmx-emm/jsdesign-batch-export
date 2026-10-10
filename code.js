// 主线程：读取选区、按预设调用 exportAsync，把字节流逐个发给 UI 打包下载
const STORAGE_KEY = 'batch-export:presets:v1';

const DEFAULT_PRESETS = [
  {
    id: 'png-123x',
    name: 'PNG @1x @2x @3x',
    nameCase: 'keep',
    specs: [
      { format: 'PNG', constraintType: 'SCALE', value: 1, suffix: '', folder: '' },
      { format: 'PNG', constraintType: 'SCALE', value: 2, suffix: '@2x', folder: '' },
      { format: 'PNG', constraintType: 'SCALE', value: 3, suffix: '@3x', folder: '' }
    ]
  },
  {
    id: 'svg',
    name: 'SVG',
    nameCase: 'keep',
    specs: [{ format: 'SVG', constraintType: 'SCALE', value: 1, suffix: '', folder: '' }]
  },
  {
    id: 'android',
    name: 'Android 五档 drawable',
    nameCase: 'snake',
    specs: [
      { format: 'PNG', constraintType: 'SCALE', value: 1, suffix: '', folder: 'drawable-mdpi' },
      { format: 'PNG', constraintType: 'SCALE', value: 1.5, suffix: '', folder: 'drawable-hdpi' },
      { format: 'PNG', constraintType: 'SCALE', value: 2, suffix: '', folder: 'drawable-xhdpi' },
      { format: 'PNG', constraintType: 'SCALE', value: 3, suffix: '', folder: 'drawable-xxhdpi' },
      { format: 'PNG', constraintType: 'SCALE', value: 4, suffix: '', folder: 'drawable-xxxhdpi' }
    ]
  },
  {
    id: 'png-w64',
    name: 'PNG 宽 64px',
    nameCase: 'keep',
    specs: [{ format: 'PNG', constraintType: 'WIDTH', value: 64, suffix: '', folder: '' }]
  }
];

let busy = false;

jsDesign.showUI(__html__, { width: 380, height: 620, title: '批量导出预设' });

function isVisible(node) {
  return node.visible !== false;
}

function hasChildren(node) {
  return 'children' in node && node.children && node.children.length > 0;
}

// useChildren：选中的是容器（画板/编组）时，导出它里面的每个可见子图层
function collectTargets(useChildren) {
  const selection = jsDesign.currentPage.selection;
  if (!useChildren) return selection.slice();
  const result = [];
  selection.forEach(function (node) {
    if (hasChildren(node)) {
      node.children.forEach(function (child) {
        if (isVisible(child)) result.push(child);
      });
    } else {
      result.push(node);
    }
  });
  return result;
}

function postSelection() {
  const selection = jsDesign.currentPage.selection;
  jsDesign.ui.postMessage({
    type: 'selection',
    count: selection.length,
    childCount: collectTargets(true).length,
    firstName: selection.length ? selection[0].name : ''
  });
}

function toSettings(spec) {
  const settings = { format: spec.format };
  if ((spec.format === 'PNG' || spec.format === 'JPG') && spec.constraintType) {
    settings.constraint = { type: spec.constraintType, value: Number(spec.value) || 1 };
  }
  return settings;
}

async function runJobs(jobs) {
  busy = true;
  jsDesign.ui.postMessage({ type: 'export-start', total: jobs.length });
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      const bytes = await job.node.exportAsync(job.settings);
      jsDesign.ui.postMessage({ type: 'file', name: job.node.name, spec: job.spec, bytes: bytes });
    } catch (err) {
      jsDesign.ui.postMessage({
        type: 'file-error',
        name: job.node.name,
        error: String((err && err.message) || err)
      });
    }
  }
  busy = false;
  jsDesign.ui.postMessage({ type: 'export-done' });
}

function exportWithPreset(preset, useChildren) {
  const nodes = collectTargets(useChildren);
  if (!nodes.length) {
    jsDesign.notify('请先选中要导出的图层', { error: true });
    return;
  }
  const jobs = [];
  nodes.forEach(function (node) {
    preset.specs.forEach(function (spec) {
      jobs.push({ node: node, settings: toSettings(spec), spec: spec });
    });
  });
  runJobs(jobs);
}

// 使用图层右侧面板里已经配置好的导出设置
function exportWithOwnSettings(useChildren) {
  const nodes = collectTargets(useChildren);
  const jobs = [];
  let skipped = 0;
  nodes.forEach(function (node) {
    const list = node.exportSettings || [];
    if (!list.length) skipped++;
    list.forEach(function (settings) {
      jobs.push({
        node: node,
        settings: settings,
        spec: { format: settings.format, suffix: settings.suffix || '', folder: '' }
      });
    });
  });
  if (!jobs.length) {
    jsDesign.notify('选中的图层都没有配置导出设置', { error: true });
    return;
  }
  if (skipped) jsDesign.notify(skipped + ' 个图层没有导出设置，已跳过');
  runJobs(jobs);
}

jsDesign.on('selectionchange', postSelection);

jsDesign.ui.onmessage = async function (msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'init') {
    const saved = await jsDesign.clientStorage.getAsync(STORAGE_KEY);
    jsDesign.ui.postMessage({ type: 'presets', presets: saved || DEFAULT_PRESETS });
    postSelection();
  } else if (msg.type === 'save-presets') {
    await jsDesign.clientStorage.setAsync(STORAGE_KEY, msg.presets);
  } else if (msg.type === 'reset-presets') {
    await jsDesign.clientStorage.setAsync(STORAGE_KEY, DEFAULT_PRESETS);
    jsDesign.ui.postMessage({ type: 'presets', presets: DEFAULT_PRESETS });
  } else if (msg.type === 'export' || msg.type === 'export-own') {
    if (busy) {
      jsDesign.notify('正在导出，请稍候');
      return;
    }
    if (msg.type === 'export') exportWithPreset(msg.preset, msg.useChildren);
    else exportWithOwnSettings(msg.useChildren);
  } else if (msg.type === 'notify') {
    jsDesign.notify(msg.text, { error: !!msg.error });
  }
};

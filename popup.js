// ============================================================
// AWSL Popup Logic
// ============================================================

const $ = (sel) => document.querySelector(sel);

const els = {
  enabled: $('#enabled'),
  startTime: $('#startTime'),
  endTime: $('#endTime'),
  weiboUrl: $('#weiboUrl'),
  uploadUrl: $('#uploadUrl'),
  apiToken: $('#apiToken'),
  saveBtn: $('#saveBtn'),
  runNowBtn: $('#runNowBtn'),
  phase: $('#phase'),
  scheduledTime: $('#scheduledTime'),
  lastRunDate: $('#lastRunDate'),
  lastRunResult: $('#lastRunResult'),
  toast: $('#toast'),
};

function showToast(msg, type = 'success') {
  els.toast.textContent = msg;
  els.toast.className = `toast ${type}`;
  setTimeout(() => {
    els.toast.className = 'toast hidden';
  }, 2000);
}

function formatDateTime(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return isoStr;
  }
}

function formatTime(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

const PHASE_LABELS = {
  idle: '空闲',
  tab_opened: '已打开微博页面',
  captured: '已捕获 headers',
  done: '已完成',
};

function updateUI(config, state) {
  els.enabled.checked = config.enabled;
  els.startTime.value = config.startTime;
  els.endTime.value = config.endTime;
  els.weiboUrl.value = config.weiboUrl;
  els.uploadUrl.value = config.uploadUrl;
  els.apiToken.value = config.apiToken;

  els.phase.textContent = PHASE_LABELS[state.phase] || state.phase;
  els.scheduledTime.textContent = state.scheduledTime ? formatTime(state.scheduledTime) : '-';
  els.lastRunDate.textContent = state.lastRunDate || '-';
  els.lastRunResult.textContent = state.lastRunResult || '-';

  // Color code results
  if (state.lastRunResult === 'success') {
    els.lastRunResult.style.color = '#52c41a';
  } else if (state.lastRunResult && state.lastRunResult.startsWith('error')) {
    els.lastRunResult.style.color = '#e6162d';
  } else {
    els.lastRunResult.style.color = '#333';
  }
}

async function loadStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getStatus' });
    if (resp) updateUI(resp.config, resp.state);
  } catch (e) {
    console.warn('[AWSL Popup] loadStatus failed', e);
  }
}

els.saveBtn.addEventListener('click', async () => {
  const config = {
    enabled: els.enabled.checked,
    startTime: els.startTime.value,
    endTime: els.endTime.value,
    weiboUrl: els.weiboUrl.value.trim(),
    uploadUrl: els.uploadUrl.value.trim(),
    apiToken: els.apiToken.value.trim(),
  };

  if (config.enabled && !config.apiToken) {
    showToast('请填写 API Token', 'error');
    return;
  }

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'saveConfig', config });
    if (resp) updateUI(resp.config, resp.state);
    showToast('已保存');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
});

els.runNowBtn.addEventListener('click', async () => {
  if (!els.apiToken.value.trim()) {
    showToast('请先配置 API Token', 'error');
    return;
  }

  try {
    await chrome.runtime.sendMessage({ type: 'runNow' });
    showToast('已触发执行');
    // Refresh status + logs after a short delay
    setTimeout(() => { loadStatus(); loadLogs(); }, 1000);
    setTimeout(() => { loadStatus(); loadLogs(); }, 5000);
  } catch (e) {
    showToast('执行失败: ' + e.message, 'error');
  }
});

// ============================================================
// Logs
// ============================================================

const logList = $('#logList');
const clearLogsBtn = $('#clearLogsBtn');

function renderLogs(logs) {
  if (!logs || logs.length === 0) {
    logList.innerHTML = '<div class="log-empty">暂无日志</div>';
    return;
  }
  logList.innerHTML = logs.map((l) =>
    `<div class="log-item"><span class="log-time">${l.time}</span><span class="log-msg">${l.message}</span></div>`
  ).join('');
}

async function loadLogs() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getLogs' });
    if (resp) renderLogs(resp.logs);
  } catch (e) {
    console.warn('[AWSL Popup] loadLogs failed', e);
  }
}

clearLogsBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'clearLogs' });
    renderLogs([]);
  } catch (_) {}
});

// Load status + logs on popup open, auto-refresh every 3s
loadStatus();
loadLogs();
setInterval(() => { loadStatus(); loadLogs(); }, 3000);

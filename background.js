// ============================================================
// AWSL Weibo Header Capture - Service Worker (background.js)
// ============================================================

const ALARM_CAPTURE = 'awsl-capture';
const ALARM_CLOSE_TAB = 'awsl-close-tab';

const DEFAULT_CONFIG = {
  enabled: true,
  startTime: '08:00',
  endTime: '22:00',
  weiboUrl: 'https://weibo.com/u/1260797924',
  uploadUrl: 'https://awsl.api.awsl.icu/admin/wb_headers',
  apiToken: '',
};

const DEFAULT_STATE = {
  phase: 'idle',        // idle | tab_opened | captured | done
  tabId: null,
  scheduledTime: null,   // ISO string of next planned run
  scheduledTimeMs: 0,
  lastRunDate: '',       // YYYY-MM-DD
  lastRunResult: '',
  lastRunTime: '',       // ISO string
};

// ============================================================
// Storage helpers (from ldoSurfer pattern)
// ============================================================

function safeStorageGet(keys) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) { resolve({}); return; }
    try {
      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime?.lastError) {
          console.warn('[AWSL] storage.get failed', chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve(result || {});
      });
    } catch (e) {
      console.warn('[AWSL] storage.get threw', e);
      resolve({});
    }
  });
}

function safeStorageSet(payload) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) { resolve(); return; }
    try {
      chrome.storage.local.set(payload, () => {
        if (chrome.runtime?.lastError) {
          console.warn('[AWSL] storage.set failed', chrome.runtime.lastError.message);
        }
        resolve();
      });
    } catch (e) {
      console.warn('[AWSL] storage.set threw', e);
      resolve();
    }
  });
}

// ============================================================
// Log helpers
// ============================================================

const MAX_LOGS = 50;

async function addLog(message) {
  const { awslLogs } = await safeStorageGet('awslLogs');
  const logs = Array.isArray(awslLogs) ? awslLogs : [];
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  logs.unshift({ time, message });
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  await safeStorageSet({ awslLogs: logs });
  console.log(`[AWSL] ${message}`);
}

// ============================================================
// Config & state helpers
// ============================================================

async function getConfig() {
  const { awslConfig } = await safeStorageGet('awslConfig');
  return normalizeConfig(awslConfig);
}

async function saveConfig(config) {
  await safeStorageSet({ awslConfig: normalizeConfig(config) });
}

async function getState() {
  const { awslState } = await safeStorageGet('awslState');
  return normalizeState(awslState);
}

async function saveState(partial) {
  const current = await getState();
  const merged = { ...current, ...partial };
  await safeStorageSet({ awslState: merged });
  return merged;
}

function normalizeConfig(raw) {
  const c = { ...DEFAULT_CONFIG, ...(raw || {}) };
  c.startTime = normalizeTime(c.startTime) || DEFAULT_CONFIG.startTime;
  c.endTime = normalizeTime(c.endTime) || DEFAULT_CONFIG.endTime;
  c.enabled = c.enabled === true;
  if (typeof c.weiboUrl !== 'string' || !c.weiboUrl) c.weiboUrl = DEFAULT_CONFIG.weiboUrl;
  if (typeof c.uploadUrl !== 'string') c.uploadUrl = DEFAULT_CONFIG.uploadUrl;
  if (typeof c.apiToken !== 'string') c.apiToken = '';
  return c;
}

function normalizeState(raw) {
  const s = { ...DEFAULT_STATE, ...(raw || {}) };
  if (!['idle', 'tab_opened', 'captured', 'done'].includes(s.phase)) s.phase = 'idle';
  if (!Number.isFinite(s.tabId)) s.tabId = null;
  if (!Number.isFinite(s.scheduledTimeMs)) s.scheduledTimeMs = 0;
  return s;
}

// ============================================================
// Time utilities
// ============================================================

function parseTime(time) {
  if (!time || typeof time !== 'string') return null;
  const parts = time.split(':');
  if (parts.length !== 2) return null;
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function normalizeTime(time) {
  const parsed = parseTime(time);
  if (!parsed) return null;
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
}

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeToMs(dateStr, timeStr) {
  const parsed = parseTime(timeStr);
  if (!parsed) return null;
  const d = new Date();
  d.setHours(parsed.hour, parsed.minute, 0, 0);
  return d.getTime();
}

function randomTimeBetween(startTime, endTime) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  const s = parseTime(startTime);
  const e = parseTime(endTime);
  if (!s || !e) return null;

  start.setHours(s.hour, s.minute, 0, 0);
  end.setHours(e.hour, e.minute, 0, 0);

  if (end <= start) return null;

  const range = end.getTime() - start.getTime();
  const randomOffset = Math.floor(Math.random() * range);
  return new Date(start.getTime() + randomOffset);
}

// ============================================================
// Alarm scheduling
// ============================================================

async function scheduleNextCapture() {
  const config = await getConfig();
  if (!config.enabled) {
    addLog('自动捕获已禁用，跳过调度');
    if (chrome?.alarms?.clear) chrome.alarms.clear(ALARM_CAPTURE);
    return;
  }

  const today = getTodayString();
  const state = await getState();

  // Already ran today
  if (state.lastRunDate === today && state.phase === 'done') {
    addLog('今日已执行，调度至明天');
    await scheduleTomorrow(config);
    return;
  }

  const randomDate = randomTimeBetween(config.startTime, config.endTime);
  if (!randomDate) {
    addLog('时间范围无效');
    return;
  }

  const now = Date.now();
  let whenMs = randomDate.getTime();

  // If the random time already passed today, schedule for tomorrow
  if (whenMs < now) {
    addLog('随机时间已过，调度至明天');
    await scheduleTomorrow(config);
    return;
  }

  await saveState({
    scheduledTime: randomDate.toISOString(),
    scheduledTimeMs: whenMs,
    phase: 'idle',
  });

  if (chrome?.alarms?.create) {
    chrome.alarms.create(ALARM_CAPTURE, { when: Math.max(whenMs, now + 1000) });
    addLog('已调度捕获: ' + randomDate.toLocaleTimeString());
  }
}

async function scheduleTomorrow(config) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const s = parseTime(config.startTime);
  const e = parseTime(config.endTime);
  if (!s || !e) return;

  tomorrow.setHours(s.hour, s.minute, 0, 0);
  const endTomorrow = new Date(tomorrow);
  endTomorrow.setHours(e.hour, e.minute, 0, 0);

  const range = endTomorrow.getTime() - tomorrow.getTime();
  if (range <= 0) return;

  const randomOffset = Math.floor(Math.random() * range);
  const whenMs = tomorrow.getTime() + randomOffset;

  await saveState({
    scheduledTime: new Date(whenMs).toISOString(),
    scheduledTimeMs: whenMs,
    phase: 'idle',
  });

  if (chrome?.alarms?.create) {
    chrome.alarms.create(ALARM_CAPTURE, { when: whenMs });
    addLog('已调度明天: ' + new Date(whenMs).toLocaleString());
  }
}

function scheduleCloseTab(delayMs) {
  if (chrome?.alarms?.create) {
    chrome.alarms.create(ALARM_CLOSE_TAB, { when: Date.now() + delayMs });
  }
}

// ============================================================
// Capture flow
// ============================================================

let captureState = {
  active: false,
  tabId: null,
};

async function startCapture() {
  const config = await getConfig();
  if (!config.apiToken) {
    addLog('未配置 API Token');
    await saveState({ phase: 'done', lastRunDate: getTodayString(), lastRunResult: 'error: no API token', lastRunTime: new Date().toISOString() });
    await scheduleNextCapture();
    return;
  }

  addLog('开始捕获流程');
  captureState.active = true;

  try {
    const tab = await chrome.tabs.create({
      url: config.weiboUrl,
      active: false,
    });

    captureState.tabId = tab.id;
    await saveState({ phase: 'tab_opened', tabId: tab.id });
    addLog('已打开微博标签页 #' + tab.id);

    // Set a safety timeout - close tab after 3 minutes if no capture
    scheduleCloseTab(3 * 60 * 1000);
  } catch (e) {
    addLog('打开标签页失败: ' + e.message);
    captureState.active = false;
    await saveState({ phase: 'done', lastRunDate: getTodayString(), lastRunResult: 'error: ' + e.message, lastRunTime: new Date().toISOString() });
    await scheduleNextCapture();
  }
}

async function onHeadersCaptured(headers, url) {
  addLog('已捕获 headers: ' + url.substring(0, 80));
  const config = await getConfig();

  await saveState({ phase: 'captured' });

  // Upload headers via PUT /admin/wb_headers
  try {
    const uploadUrl = config.uploadUrl || DEFAULT_CONFIG.uploadUrl;

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiToken}`,
      },
      body: JSON.stringify(headers),
    });

    if (response.ok) {
      addLog('上传成功');
      await saveState({
        phase: 'done',
        lastRunDate: getTodayString(),
        lastRunResult: 'success',
        lastRunTime: new Date().toISOString(),
      });
    } else {
      const text = await response.text().catch(() => '');
      addLog('上传失败: HTTP ' + response.status);
      await saveState({
        phase: 'done',
        lastRunDate: getTodayString(),
        lastRunResult: `error: HTTP ${response.status}`,
        lastRunTime: new Date().toISOString(),
      });
    }
  } catch (e) {
    addLog('上传异常: ' + e.message);
    await saveState({
      phase: 'done',
      lastRunDate: getTodayString(),
      lastRunResult: 'error: ' + e.message,
      lastRunTime: new Date().toISOString(),
    });
  }

  // Wait random 30-120s then close tab
  const delay = 30000 + Math.floor(Math.random() * 90000);
  addLog('将在 ' + Math.round(delay / 1000) + '秒后关闭标签页');

  // Cancel the safety timeout
  if (chrome?.alarms?.clear) chrome.alarms.clear(ALARM_CLOSE_TAB);
  scheduleCloseTab(delay);
}

async function closeTabAndReschedule() {
  const state = await getState();
  if (state.tabId) {
    try {
      await chrome.tabs.remove(state.tabId);
      addLog('标签页已关闭 #' + state.tabId);
    } catch (e) {
      addLog('关闭标签页失败: ' + e.message);
    }
  }

  captureState.active = false;
  captureState.tabId = null;

  // If we never captured, mark as failed
  if (state.phase !== 'done') {
    await saveState({
      phase: 'done',
      tabId: null,
      lastRunDate: getTodayString(),
      lastRunResult: state.phase === 'tab_opened' ? 'error: timeout, no ajax request' : state.lastRunResult || 'error: unknown',
      lastRunTime: new Date().toISOString(),
    });
  } else {
    await saveState({ tabId: null });
  }

  await scheduleNextCapture();
}

// ============================================================
// webRequest listener - MUST be registered at top level (MV3)
// ============================================================

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Only process when we're actively capturing
    if (!captureState.active) return;

    // Only process requests from our tab
    if (details.tabId !== captureState.tabId) return;

    // Debug: log first few XHR from our tab
    if (details.type === 'xmlhttprequest') {
      addLog('XHR: ' + details.url.substring(0, 120));
    }

    // Check if URL matches mymblog API
    if (!details.url.includes('/ajax/statuses/mymblog')) return;

    addLog('拦截到 mymblog 请求');

    // Convert headers array to object
    const headersObj = {};
    if (details.requestHeaders) {
      for (const h of details.requestHeaders) {
        headersObj[h.name] = h.value;
      }
    }

    // Prevent processing duplicates
    captureState.active = false;

    // Process asynchronously
    onHeadersCaptured(headersObj, details.url);
  },
  { urls: ['*://weibo.com/*', '*://*.weibo.com/*', '*://*.weibo.cn/*'] },
  ['requestHeaders', 'extraHeaders']
);

// ============================================================
// Alarm listener
// ============================================================

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_CAPTURE) {
    addLog('定时触发捕获');
    startCapture();
  } else if (alarm.name === ALARM_CLOSE_TAB) {
    addLog('定时关闭标签页');
    closeTabAndReschedule();
  }
});

// ============================================================
// Tab removal listener - handle tab closed externally
// ============================================================

chrome.tabs.onRemoved.addListener((tabId) => {
  if (captureState.tabId === tabId) {
    addLog('标签页被外部关闭');
    captureState.active = false;
    captureState.tabId = null;
    if (chrome?.alarms?.clear) chrome.alarms.clear(ALARM_CLOSE_TAB);
  }
});

// ============================================================
// Message handler for popup communication
// ============================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    (async () => {
      const config = await getConfig();
      const state = await getState();
      sendResponse({ config, state });
    })();
    return true; // async response
  }

  if (msg.type === 'saveConfig') {
    (async () => {
      await saveConfig(msg.config);
      await scheduleNextCapture();
      const config = await getConfig();
      const state = await getState();
      sendResponse({ config, state });
    })();
    return true;
  }

  if (msg.type === 'runNow') {
    (async () => {
      addLog('手动触发执行');
      await saveState({ phase: 'idle', lastRunDate: '' });
      await startCapture();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg.type === 'getLogs') {
    (async () => {
      const { awslLogs } = await safeStorageGet('awslLogs');
      sendResponse({ logs: Array.isArray(awslLogs) ? awslLogs : [] });
    })();
    return true;
  }

  if (msg.type === 'clearLogs') {
    (async () => {
      await safeStorageSet({ awslLogs: [] });
      sendResponse({ ok: true });
    })();
    return true;
  }
});

// ============================================================
// Install / startup
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  addLog('插件已安装');
  scheduleNextCapture();
});

chrome.runtime.onStartup.addListener(() => {
  addLog('浏览器启动');
  recoverState();
});

async function recoverState() {
  const state = await getState();

  // If we were mid-capture when SW died, reset
  if (state.phase === 'tab_opened' || state.phase === 'captured') {
    addLog('恢复中断的捕获流程');
    captureState.active = false;
    if (state.tabId) {
      try { await chrome.tabs.remove(state.tabId); } catch (_) {}
    }
    await saveState({
      phase: 'done',
      tabId: null,
      lastRunResult: 'error: interrupted by restart',
      lastRunTime: new Date().toISOString(),
      lastRunDate: getTodayString(),
    });
  }

  await scheduleNextCapture();
}

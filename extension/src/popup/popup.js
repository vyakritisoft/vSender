import { parseFile, validateAndMap } from '../core/parser/csvParser.js';
import { extractVariables, renderTemplate } from '../core/templating/templateEngine.js';
import { saveDataset, getDatasets, getDatasetById, deleteDataset } from '../core/db/database.js';

let parsedData = null;
let fieldMapping = { phone: '' };
let pollingInterval = null;
let validationResult = null;
let isActiveSession = false; // true while the SW is processing or paused
let currentDatasetId = null; // currently loaded dataset ID

const InputMode = { FILE: 'file', MANUAL_ROWS: 'manual_rows' };
let inputMode = InputMode.FILE;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.dataset.viewMode = await detectViewMode();
  initStickyLayout();
  initTabs();
  initUpload();
  initMapping();
  initMessage();
  initDelay();
  initControls();
  initSettings();
  initToast();
  await checkWhatsAppConnection();
  await loadExistingStatus();
  updateStepVisibility();
  startPolling();
  initMessageListener();
});

function initMessageListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATUS_UPDATE') {
      updateProgressUI(message.stats, message.queue);
      updateLogsUI(message.logs);
      syncControlState(message.stats);
    }
  });
}

function syncControlState(stats) {
  if (stats.scheduledAt && stats.scheduledAt > Date.now()) {
    updateControlStates('scheduled');
    isActiveSession = true;
  } else if (stats.isProcessing && !stats.isPaused) {
    updateControlStates('running');
    isActiveSession = true;
  } else if (stats.isPaused) {
    updateControlStates('paused');
    isActiveSession = true;
  } else if (stats.isStopped) {
    updateControlStates('stopped');
    isActiveSession = false;
  } else if (!stats.isProcessing && stats.total > 0 && stats.pending === 0 && stats.retry === 0) {
    updateControlStates('stopped');
    isActiveSession = false;
  }
}

async function detectViewMode() {
  if (!chrome.tabs?.getCurrent) return 'popup';

  try {
    return await new Promise((resolve) => {
      chrome.tabs.getCurrent((tab) => resolve(tab ? 'tab' : 'popup'));
    });
  } catch (err) {
    return 'popup';
  }
}

function initStickyLayout() {
  syncStickyOffsets();
  window.addEventListener('resize', syncStickyOffsets);

  const header = $('.header');
  if (header && 'ResizeObserver' in window) {
    const observer = new ResizeObserver(() => syncStickyOffsets());
    observer.observe(header);
  }
}

function syncStickyOffsets() {
  const header = $('.header');
  const offset = header ? `${header.offsetHeight}px` : '63px';
  document.documentElement.style.setProperty('--header-offset', offset);
}

function initTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function switchTab(tabName) {
  $$('.tab').forEach(tab => tab.classList.remove('tab--active'));
  $$('.panel').forEach(panel => panel.classList.remove('panel--active'));

  $(`[data-tab="${tabName}"]`)?.classList.add('tab--active');
  $(`#panel${capitalize(tabName)}`)?.classList.add('panel--active');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}



async function checkWhatsAppConnection() {
  const statusEl = $('#connectionStatus');
  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('.status-text');

  dot.className = 'status-dot status-dot--checking';
  text.textContent = 'Checking...';

  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) {
      dot.className = 'status-dot status-dot--offline';
      text.textContent = 'WA not open';
      return;
    }

    const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'CHECK_READY' });
    if (response && response.ready) {
      dot.className = 'status-dot status-dot--online';
      text.textContent = 'Connected';
    } else {
      dot.className = 'status-dot status-dot--offline';
      text.textContent = 'Not logged in';
    }
  } catch (err) {
    dot.className = 'status-dot status-dot--offline';
    text.textContent = 'Disconnected';
  }
}

function initUpload() {
  const zone = $('#uploadZone');
  const input = $('#fileInput');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('upload-zone--dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('upload-zone--dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('upload-zone--dragover');
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  });
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) void handleFile(file);
  });

  $('#removeFile').addEventListener('click', resetFileState);

  // Saved contact logic
  refreshDatasetList();
  $('#savedDatasetsSelect').addEventListener('change', handleDatasetSelect);
  $('#btnDeleteDataset').addEventListener('click', handleDeleteDataset);
}

async function refreshDatasetList() {
  try {
    const list = await getDatasets();
    const select = $('#savedDatasetsSelect');
    const group = $('#savedDatasetsGroup');
    const btnDel = $('#btnDeleteDataset');

    if (list.length === 0) {
      group.style.display = 'none';
      return;
    }

    group.style.display = 'block';
    select.innerHTML = '<option value="">-- Upload New Contacts... --</option>';

    list.forEach(ds => {
      const opt = document.createElement('option');
      opt.value = ds.id;
      const count = ds.parsedData?.rows?.length || 0;
      const dateStr = new Date(ds.timestamp).toLocaleString();
      opt.textContent = `${ds.name} (${count} rows) - ${dateStr}`;
      select.appendChild(opt);
    });

    if (currentDatasetId) {
      select.value = currentDatasetId;
      btnDel.style.display = 'block';
    } else {
      btnDel.style.display = 'none';
      select.value = '';
    }
  } catch (err) {
    console.error('Error loading datasets:', err);
  }
}

async function handleDatasetSelect(e) {
  const datasetId = e.target.value;
  if (!datasetId) {
    resetFileState();
    return;
  }

  try {
    const dataset = await getDatasetById(datasetId);
    if (!dataset) throw new Error("Dataset not found");

    currentDatasetId = dataset.id;
    parsedData = dataset.parsedData;
    fieldMapping = dataset.fieldMapping || { phone: '' };

    $('#btnDeleteDataset').style.display = 'block';
    $('#uploadZone').style.display = 'none';
    $('#fileInfo').style.display = 'block';
    $('#fileName').textContent = dataset.name;
    $('#fileStats').textContent = `${parsedData.rows.length} rows, ${parsedData.headers.length} columns`;

    populateFieldMapping();
  } catch (err) {
    showToast(`Error loading dataset: ${err.message}`, 'error');
    resetFileState();
  }
}

async function handleDeleteDataset() {
  if (!currentDatasetId) return;
  showConfirmToast('Are you sure you want to delete this saved contact list?', 'Confirm Delete', async () => {
    try {
      await deleteDataset(currentDatasetId);
      showToast('Dataset deleted', 'success');
      resetFileState();
      await refreshDatasetList();
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  });
}

function resetFileState() {
  parsedData = null;
  fieldMapping = { phone: '' };
  currentDatasetId = null;
  $('#savedDatasetsSelect').value = '';
  $('#btnDeleteDataset').style.display = 'none';
  $('#fileInfo').style.display = 'none';
  $('#uploadZone').style.display = 'flex';
  $('#fileInput').value = '';
  $('#variableMappings').innerHTML = '';
  $('#phoneColumn').innerHTML = '';
  updateValidationState();
  updatePreview();
  updateStepVisibility();
}

async function handleFile(file) {
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls', 'txt'].includes(ext)) {
      showToast('Unsupported file format. Please use CSV or XLSX.', 'error');
      return;
    }

    parsedData = await parseFile(file);

    $('#uploadZone').style.display = 'none';
    $('#fileInfo').style.display = 'block';
    $('#fileName').textContent = file.name;
    $('#fileStats').textContent = `${parsedData.rows.length} rows found, ${parsedData.headers.length} columns`;

    if (parsedData.errors.length > 0) {
      $('#fileStats').textContent += ` (${parsedData.errors.length} parse issues)`;
    }

    currentDatasetId = Date.now().toString();
    fieldMapping = { phone: '' }; // Start fresh

    // Auto-save
    try {
      await saveDataset({
        id: currentDatasetId,
        name: file.name,
        timestamp: Date.now(),
        parsedData: parsedData,
        fieldMapping: fieldMapping
      });
      $('#btnDeleteDataset').style.display = 'block';
      await refreshDatasetList();
      $('#savedDatasetsSelect').value = currentDatasetId;
    } catch (e) {
      console.warn("Failed to save dataset natively", e);
    }

    populateFieldMapping();
  } catch (err) {
    showToast(`Error parsing file: ${err.message}`, 'error');
  }
}

function initMapping() {
  $('#addMapping').addEventListener('click', () => addVariableMapping());
}

function populateFieldMapping() {
  if (!parsedData) return;

  const phoneSelect = $('#phoneColumn');
  phoneSelect.innerHTML = '<option value="">-- Select column --</option>';
  fieldMapping = fieldMapping || { phone: '' };

  parsedData.headers.forEach(header => {
    const option = document.createElement('option');
    option.value = header;
    option.textContent = header;

    if (!fieldMapping.phone && /phone|mobile|number|tel/i.test(header)) {
      fieldMapping.phone = header;
    }

    phoneSelect.appendChild(option);
  });

  phoneSelect.onchange = (e) => {
    fieldMapping.phone = e.target.value;
    updateFieldMapping();
  };

  $('#variableMappings').innerHTML = '';

  // If we loaded saved mappings, restore them
  const existingVars = Object.keys(fieldMapping).filter(k => k !== 'phone');

  if (existingVars.length > 0) {
    existingVars.forEach(varName => {
      addVariableMapping(varName, fieldMapping[varName]);
    });
  } else {
    // Generate default mappings from headers
    parsedData.headers.forEach(header => {
      if (header !== fieldMapping.phone) {
        addVariableMapping(header, header);
      }
    });
  }

  if (fieldMapping.phone) {
    phoneSelect.value = fieldMapping.phone;
  }

  updateFieldMapping();
}

function addVariableMapping(varName = '', columnName = '') {
  if (!parsedData) return;

  const container = $('#variableMappings');
  const row = document.createElement('div');
  row.className = 'mapping-row';

  const varInput = document.createElement('input');
  varInput.type = 'text';
  varInput.className = 'form-input';
  varInput.placeholder = 'Variable name';
  varInput.value = varName;

  const colSelect = document.createElement('select');
  colSelect.className = 'form-select';
  colSelect.innerHTML = '<option value="">-- Column --</option>';

  parsedData.headers.forEach(header => {
    const option = document.createElement('option');
    option.value = header;
    option.textContent = header;
    if (header === columnName) option.selected = true;
    colSelect.appendChild(option);
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'mapping-remove';
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.onclick = () => {
    row.remove();
    updateFieldMapping();
  };

  const onChange = () => updateFieldMapping();
  varInput.addEventListener('input', onChange);
  colSelect.addEventListener('change', onChange);

  row.append(varInput, colSelect, removeBtn);
  container.appendChild(row);
}

function updateFieldMapping() {
  fieldMapping = { phone: $('#phoneColumn').value };

  $$('.mapping-row').forEach(row => {
    const varName = row.querySelector('input').value.trim();
    const columnName = row.querySelector('select').value;
    if (varName && columnName) {
      fieldMapping[varName] = columnName;
    }
  });

  if (currentDatasetId) {
    getDatasetById(currentDatasetId).then(ds => {
      if (ds) {
        ds.fieldMapping = fieldMapping;
        saveDataset(ds).catch(e => console.warn(e));
      }
    });
  }

  updateValidationState();
  updatePreview();
  updateStepVisibility();
  updateTemplateVarTags();
}

function initMessage() {
  $('#messageTemplate').addEventListener('input', () => {
    updatePreview();
    updateStepVisibility();
  });
}

function updateTemplateVarTags() {
  if (inputMode === InputMode.MANUAL_ROWS) {
    $('#templateVars').innerHTML = '';
    return;
  }

  const container = $('#templateVars');
  container.innerHTML = '';

  if (!fieldMapping) return;

  const vars = Object.keys(fieldMapping).filter(k => k !== 'phone');

  vars.forEach(variableName => {
    const tag = document.createElement('span');
    tag.className = 'template-var-tag';
    tag.textContent = `{{${variableName}}}`;
    tag.addEventListener('click', () => {
      const textarea = $('#messageTemplate');
      const position = textarea.selectionStart;
      const text = textarea.value;
      const insertedText = `{{${variableName}}}`;
      textarea.value = text.slice(0, position) + insertedText + text.slice(position);

      // Move cursor after the newly inserted tag
      textarea.selectionStart = textarea.selectionEnd = position + insertedText.length;
      textarea.focus();

      // Trigger input event to update previews instantly
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    container.appendChild(tag);
  });
}



function initDelay() {
  $('#delayRange').addEventListener('input', () => {
    $('#delayValue').textContent = `${$('#delayRange').value}s`;
    updateLaunchSummary();
  });
}

function updateValidationState() {
  const summary = $('#validationSummary');

  try {
    validationResult = getValidationResultForCurrentMode();
  } catch (err) {
    validationResult = {
      mode: inputMode,
      contacts: [],
      errors: [{ row: null, error: err.message }],
      stats: { totalRows: 0, valid: 0, invalid: 0, duplicates: 0, parseErrors: 1 }
    };
  }

  if (!validationResult || !validationResult.stats || validationResult.stats.totalRows === 0) {
    summary.style.display = 'none';
    updateLaunchSummary();
    return;
  }

  const { stats } = validationResult;
  const lines = [
    `${stats.valid} valid contacts ready`,
    `${stats.invalid} invalid numbers skipped`,
    `${stats.duplicates} duplicate numbers skipped`
  ];

  if (stats.parseErrors > 0) {
    lines.push(`${stats.parseErrors} row issues detected`);
  }

  summary.textContent = lines.join('\n');
  summary.className = 'validation-summary';

  if (stats.valid === 0) {
    summary.classList.add('validation-summary--danger');
  } else if (stats.invalid > 0 || stats.duplicates > 0 || stats.parseErrors > 0) {
    summary.classList.add('validation-summary--warning');
  } else {
    summary.classList.add('validation-summary--success');
  }

  summary.style.display = 'block';
  updateLaunchSummary();
}

function getValidationResultForCurrentMode() {
  return validateFileMode();
}

function validateFileMode() {
  if (!parsedData) return emptyValidationResult();
  if (!fieldMapping.phone) {
    return {
      mode: InputMode.FILE,
      contacts: [],
      errors: [],
      stats: {
        totalRows: parsedData.rows.length,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        parseErrors: parsedData.errors.length
      }
    };
  }

  return {
    mode: 'file',
    ...validateAndMap(parsedData, fieldMapping, getDefaultCountryCode())
  };
}



function emptyValidationResult() {
  return {
    mode: 'file',
    contacts: [],
    errors: [],
    stats: {
      totalRows: 0,
      valid: 0,
      invalid: 0,
      duplicates: 0,
      parseErrors: 0
    }
  };
}

function updatePreview() {
  const previewBox = $('#previewBox');
  const previewContent = $('#previewContent');

  const template = $('#messageTemplate').value;
  if (!template) {
    previewBox.style.display = 'none';
    return;
  }

  const sampleVariables = validationResult?.contacts?.[0]?.variables || buildSampleVariablesFromFile();
  previewContent.textContent = renderTemplate(template, sampleVariables);
  previewBox.style.display = 'block';
}

function buildSampleVariablesFromFile() {
  const firstRow = parsedData?.rows?.[0]?.data || {};
  const variables = {};
  Object.entries(fieldMapping).forEach(([varName, columnName]) => {
    if (varName !== 'phone' && columnName) {
      variables[varName] = firstRow[columnName] || '';
    }
  });
  return variables;
}

function updateStepVisibility() {
  const hasContacts = (validationResult?.contacts?.length || 0) > 0;
  const hasTemplate = $('#messageTemplate').value.trim().length > 0;

  const showMapping = !!parsedData;
  const showMessage = parsedData && (fieldMapping.phone || parsedData.rows.length === 0);
  const showPostMessageSteps = showMessage && hasTemplate;

  $('#stepMapping').style.display = showMapping ? 'block' : 'none';
  $('#stepMessage').style.display = showMessage ? 'block' : 'none';
  $('#stepDelay').style.display = showPostMessageSteps ? 'block' : 'none';
  $('#launchSection').style.display = showPostMessageSteps ? 'block' : 'none';
  $('#btnStart').disabled = !(hasContacts && hasTemplate);

  updateLaunchSummary();
}

function updateLaunchSummary() {
  const summaryEl = $('#launchSummary');
  if (!validationResult || validationResult.stats.totalRows === 0) {
    summaryEl.textContent = '';
    return;
  }

  const delay = $('#delayRange').value;
  const sessionCap = $('#sessionCap').value;
  const stats = validationResult.stats;
  const validContacts = validationResult.contacts.length;
  const estimatedTime = validContacts > 0 ? Math.ceil((validContacts * delay) / 60) : 0;

  const lines = [
    `📤 ${validContacts} uploaded contacts will receive messages`,
    `⏱ ~${delay}s delay between messages`,
    `🛡 Session cap: ${sessionCap} messages`,
    `🌍 Default country code: ${getDefaultCountryCode() || 'none'}`,
    `⏰ Estimated time: ~${estimatedTime} min`,
    `⚠ Skipped: ${stats.invalid} invalid, ${stats.duplicates} duplicates, ${stats.parseErrors} row issues`
  ];

  summaryEl.textContent = lines.join('\n');
}

function initControls() {
  $('#btnStart').addEventListener('click', () => void startSending());

  const scheduleRadios = $$('input[name="scheduleMode"]');
  const scheduleGroup = $('#scheduleDatetimeGroup');
  scheduleRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'later') {
        scheduleGroup.style.display = 'block';
        const dtInput = $('#scheduleDatetime');
        if (!dtInput.value) {
          const d = new Date(Date.now() + 5 * 60000);
          d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
          dtInput.value = d.toISOString().slice(0, 16);
        }
      } else {
        scheduleGroup.style.display = 'none';
      }
    });
  });

  $('#btnResume').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'RESUME' }).catch(() => null);
    if (!res?.success) showToast(res?.error || 'Failed to resume', 'error');
  });

  $('#btnPause').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'PAUSE' }).catch(() => null);
  });

  $('#btnStop').addEventListener('click', () => {
    showConfirmToast(
      'Stop sending? Remaining messages will NOT be sent.',
      'Confirm Stop',
      async () => {
        await chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => null);
      }
    );
  });

  $('#btnExportResults').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_RESULTS' }).catch(() => null);
    if (response?.csv) downloadCSV(response.csv, 'wa_bulk_results.csv');
    else showToast('Nothing to export yet', 'warn');
  });

  $('#btnExportLogs').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'EXPORT_LOGS' }).catch(() => null);
    if (response?.csv) downloadCSV(response.csv, 'wa_bulk_logs.csv');
  });

  $('#btnClearLogs').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' }).catch(() => null);
    updateLogsUI([]);
  });
}

async function startSending() {
  updateValidationState();

  if (!validationResult || validationResult.contacts.length === 0) {
    showToast('No valid contacts found. Please review the validation summary.', 'error');
    return;
  }

  const messageTemplate = $('#messageTemplate').value.trim();
  if (!messageTemplate) {
    showToast('Please enter a message template.', 'error');
    return;
  }

  const delay = parseInt($('#delayRange').value, 10) * 1000;
  const sessionCap = parseInt($('#sessionCap').value, 10);
  const humanTyping = $('#humanTyping').checked;
  const defaultCountryCode = getDefaultCountryCode();

  const scheduleMode = $('input[name="scheduleMode"]:checked')?.value;
  let scheduledAt = null;
  if (scheduleMode === 'later') {
    const dtValue = $('#scheduleDatetime').value;
    if (!dtValue) {
      showToast('Please select a valid date and time for scheduling.', 'error');
      return;
    }
    scheduledAt = new Date(dtValue).getTime();
    if (scheduledAt <= Date.now()) {
      showToast('Scheduled time must be in the future.', 'error');
      return;
    }
  }

  // Update settings first
  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    payload: { baseDelay: delay, sessionCap, humanTyping, defaultCountryCode }
  }).catch(() => null);

  // START_FRESH: atomic single-message init + start (no race window)
  const result = await chrome.runtime.sendMessage({
    type: 'START_FRESH',
    payload: {
      contacts: validationResult.contacts,
      messageTemplate,
      scheduledAt
    }
  }).catch(err => ({ success: false, error: err.message }));

  if (!result?.success) {
    showToast(`Failed to start: ${result?.error || 'Unknown error'}`, 'error');
    return;
  }

  isActiveSession = true;
  switchTab('progress');
}

function updateControlStates(state) {
  const resume = $('#btnResume');
  const pause = $('#btnPause');
  const stop = $('#btnStop');

  if (state === 'scheduled') {
    resume.disabled = true;
    pause.disabled = true;
    stop.disabled = false;
  } else {
    resume.disabled = state !== 'paused';
    pause.disabled = state !== 'running';
    stop.disabled = state === 'stopped' || state === 'idle';
  }
}

function startPolling() {
  // Poll frequently while active, back off when idle to conserve resources
  const ACTIVE_INTERVAL = 2000;
  const IDLE_INTERVAL = 10000;

  pollingInterval = setInterval(() => {
    const interval = isActiveSession ? ACTIVE_INTERVAL : IDLE_INTERVAL;
    // Simple adaptive: reset the timer based on session state
    void fetchStatus();
  }, ACTIVE_INTERVAL); // always start fast; fetchStatus updates isActiveSession
}

async function fetchStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!response) return;

    const { stats, queue: q, logs } = response;
    updateProgressUI(stats, q);
    updateLogsUI(logs);

    // Derive control state purely from SW truth — never set optimistically
    if (stats.scheduledAt && stats.scheduledAt > Date.now()) {
      updateControlStates('scheduled');
      isActiveSession = true;
    } else if (stats.isProcessing && !stats.isPaused) {
      updateControlStates('running');
      isActiveSession = true;
    } else if (stats.isPaused) {
      updateControlStates('paused');
      isActiveSession = true; // still has pending work
    } else if (stats.isStopped) {
      updateControlStates('stopped');
      isActiveSession = false;
    } else if (!stats.isProcessing && stats.total > 0 && stats.pending === 0 && stats.retry === 0) {
      // All done
      updateControlStates('stopped');
      isActiveSession = false;
    }
  } catch {
    // Background may be asleep — ignore
  }
}

async function loadExistingStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (response?.stats?.total > 0) {
      updateProgressUI(response.stats, response.queue);
      updateLogsUI(response.logs);
    }
  } catch (err) {
    // Ignore initial load errors.
  }
}

function updateProgressUI(stats, queueItems = []) {
  if (!stats) return;

  $('#statSent').textContent = stats.sent;
  $('#statFailed').textContent = stats.failed;
  $('#statPending').textContent = stats.pending + stats.retry;
  $('#statTotal').textContent = stats.total;

  const percent = stats.total > 0 ? Math.round(((stats.sent + stats.failed) / stats.total) * 100) : 0;

  const progressBar = $('#progressBar');
  const progressPercent = $('#progressPercent');

  if (stats.scheduledAt && stats.scheduledAt > Date.now()) {
    const dt = new Date(stats.scheduledAt);
    progressBar.style.width = '100%';
    progressBar.style.backgroundColor = '#94a3b8';
    progressPercent.textContent = `Scheduled for ${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`;
  } else {
    progressBar.style.width = `${percent}%`;
    progressBar.style.backgroundColor = '';
    progressPercent.textContent = `${percent}%`;
  }

  const list = $('#queueList');
  if (queueItems.length === 0) {
    list.innerHTML = '<div class="empty-state">No messages in queue</div>';
    return;
  }

  list.innerHTML = '';
  [...queueItems].reverse().slice(0, 50).forEach(item => {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
      <span class="queue-phone">${maskPhone(item.phone)}</span>
      <span class="queue-status queue-status--${item.status.toLowerCase()}">${item.status}</span>
    `;
    list.appendChild(div);
  });
}

function maskPhone(phone) {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}****${phone.slice(-2)}`;
}

function updateLogsUI(logEntries = []) {
  const list = $('#logList');
  if (logEntries.length === 0) {
    list.innerHTML = '<div class="empty-state">No logs yet</div>';
    return;
  }

  list.innerHTML = '';
  logEntries.slice(-100).reverse().forEach(entry => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
    div.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-level log-level--${entry.level}">${entry.level.toUpperCase()}</span>
      <span class="log-message">${escapeHtml(entry.message)}</span>
    `;
    list.appendChild(div);
  });
}

function initSettings() {
  void loadSettingsUI();

  $('#btnSaveSettings').addEventListener('click', async () => {
    const delay = parseInt($('#settingDelay').value, 10) * 1000;
    const jitter = parseInt($('#settingJitter').value, 10);
    const sessionCap = parseInt($('#settingSessionCap').value, 10);
    const cooldown = parseInt($('#settingCooldown').value, 10) * 60000;
    const defaultCountryCode = getDefaultCountryCode();

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: {
        baseDelay: delay,
        jitterPercent: jitter,
        sessionCap,
        cooldownDelay: cooldown,
        defaultCountryCode
      }
    });

    updateValidationState();
    updateStepVisibility();
    showToast('Settings saved!', 'success', 2500);
  });

  $('#btnClearAll').addEventListener('click', async () => {
    showConfirmToast(
      'Clear all data including queue, logs, and settings?',
      'Confirm Clear',
      async () => {
        await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_DATA' }).catch(() => null);
        location.reload();
      }
    );
  });
}

async function loadSettingsUI() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (!response?.settings) return;

    const settings = response.settings;
    $('#settingDelay').value = (settings.baseDelay || 5000) / 1000;
    $('#settingJitter').value = settings.jitterPercent || 30;
    $('#settingSessionCap').value = settings.sessionCap || 50;
    $('#settingCooldown').value = (settings.cooldownDelay || 300000) / 60000;
    $('#settingDefaultCountryCode').value = settings.defaultCountryCode || '';
    updateValidationState();
    updatePreview();
    updateStepVisibility();
  } catch (err) {
    // Use defaults.
  }
}

function getDefaultCountryCode() {
  return String($('#settingDefaultCountryCode')?.value || '').replace(/\D/g, '');
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_UPDATE') {
    updateProgressUI(message.stats, message.queue || []);
    updateLogsUI(message.logs || []);
  }
});

// ── Toast notification system ─────────────────────────────────────────────────
let toastTimer = null;

function initToast() {
  // Toast container is injected if not already in the HTML
  if (!$('#toastContainer')) {
    const el = document.createElement('div');
    el.id = 'toastContainer';
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9999', 'display:flex', 'flex-direction:column', 'align-items:center', 'gap:8px',
      'pointer-events:none', 'width:max-content', 'max-width:340px'
    ].join(';');
    document.body.appendChild(el);
  }
}

function showToast(msg, type = 'info', duration = 4000) {
  const container = $('#toastContainer');
  if (!container) return;

  const colours = { info: '#128C7E', error: '#e53e3e', warn: '#d97706', success: '#25D366' };
  const toast = document.createElement('div');
  toast.style.cssText = [
    `background:${colours[type] || colours.info}`,
    'color:white', 'padding:10px 16px', 'border-radius:8px',
    'font-size:13px', 'font-weight:500', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
    'pointer-events:auto', 'opacity:0', 'transition:opacity 0.2s ease',
    'max-width:340px', 'text-align:center', 'line-height:1.4'
  ].join(';');
  toast.textContent = msg;
  container.appendChild(toast);

  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

function showConfirmToast(msg, actionLabel, onConfirm) {
  const container = $('#toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.style.cssText = [
    'background:#1a202c', 'color:white', 'padding:12px 16px', 'border-radius:10px',
    'font-size:13px', 'box-shadow:0 4px 16px rgba(0,0,0,0.4)',
    'pointer-events:auto', 'display:flex', 'flex-direction:column', 'gap:10px',
    'max-width:300px', 'text-align:center', 'line-height:1.4'
  ].join(';');

  const text = document.createElement('span');
  text.textContent = msg;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:center';

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = actionLabel;
  confirmBtn.style.cssText = 'background:#e53e3e;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px';
  confirmBtn.onclick = async () => { toast.remove(); await onConfirm(); };

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:#4a5568;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px';
  cancelBtn.onclick = () => toast.remove();

  btnRow.append(confirmBtn, cancelBtn);
  toast.append(text, btnRow);
  container.appendChild(toast);
}

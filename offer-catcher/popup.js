/* ============================================================
   Offer 捕手 v2 — Popup Main Script
   ============================================================ */

// ────────────────────────────────────────
//  Provider Presets
// ────────────────────────────────────────
const PROVIDERS = [
  { id:'deepseek',    name:'DeepSeek',    baseUrl:'https://api.deepseek.com/v1',                      model:'deepseek-chat',                   color:'#4D6BFE' },
  { id:'openai',      name:'OpenAI',      baseUrl:'https://api.openai.com/v1',                        model:'gpt-4o',                          color:'#10a37f' },
  { id:'qwen',        name:'通义千问',     baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', model:'qwen-plus',                       color:'#615CED' },
  { id:'moonshot',    name:'Moonshot',    baseUrl:'https://api.moonshot.cn/v1',                       model:'moonshot-v1-8k',                  color:'#3370FF' },
  { id:'zhipu',       name:'智谱 AI',     baseUrl:'https://open.bigmodel.cn/api/paas/v4',             model:'glm-4-flash',                     color:'#306CFE' },
  { id:'siliconflow', name:'SiliconFlow', baseUrl:'https://api.siliconflow.cn/v1',                    model:'deepseek-ai/DeepSeek-V3',         color:'#7C3AED' },
];

// ────────────────────────────────────────
//  Global State
// ────────────────────────────────────────
let llm = new LLMClient({});
let resumeData   = null;
let matchResults = [];
let sendHistory  = [];

// ────────────────────────────────────────
//  Storage Helpers
// ────────────────────────────────────────
const saveStore = d => new Promise(r => chrome.storage.local.set(d, r));
const loadStore = k => new Promise(r => chrome.storage.local.get(k, r));

// ────────────────────────────────────────
//  Init
// ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadStoredData();
  initTabs();
  initPresets();
  initSettings();
  initUpload();
  initScan();
  initModal();
  initResultsSort();
  updateFooter();
});

// ────────────────────────────────────────
//  Load stored data on startup
// ────────────────────────────────────────
async function loadStoredData() {
  const data = await loadStore(['resumeData', 'matchResults', 'sendHistory']);
  if (data.resumeData) {
    resumeData = data.resumeData;
    showResumePreview();
    document.getElementById('btn-scan').disabled = false;
  }
  if (data.matchResults?.length) {
    matchResults = data.matchResults;
    renderResults(matchResults);
    updateStats();
  }
  if (data.sendHistory?.length) {
    sendHistory = data.sendHistory;
    renderHistory();
  }
}

// ────────────────────────────────────────
//  Tab Navigation
// ────────────────────────────────────────
function initTabs() {
  document.getElementById('tab-bar').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn || btn.classList.contains('active')) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === btn.dataset.tab));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
  });
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
}

// ────────────────────────────────────────
//  Preset Providers
// ────────────────────────────────────────
function initPresets() {
  const grid = document.getElementById('preset-grid');
  grid.innerHTML = PROVIDERS.map(p =>
    `<button class="preset-btn" data-id="${p.id}" style="--pc:${p.color}">${p.name}</button>`
  ).join('');
  grid.addEventListener('click', e => {
    const btn = e.target.closest('.preset-btn');
    if (!btn) return;
    const p = PROVIDERS.find(x => x.id === btn.dataset.id);
    if (!p) return;
    document.getElementById('input-base-url').value = p.baseUrl;
    document.getElementById('input-model').value    = p.model;
    document.getElementById('input-api-key').focus();
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.id === p.id));
  });
}

// ────────────────────────────────────────
//  Settings
// ────────────────────────────────────────
async function loadConfig() {
  const { apiConfig } = await loadStore(['apiConfig']);
  if (!apiConfig) return;
  document.getElementById('input-base-url').value = apiConfig.baseUrl || '';
  document.getElementById('input-api-key').value  = apiConfig.apiKey  || '';
  document.getElementById('input-model').value    = apiConfig.model   || '';
  llm = new LLMClient(apiConfig);
  const m = PROVIDERS.find(p => p.baseUrl === apiConfig.baseUrl);
  if (m) document.querySelector(`.preset-btn[data-id="${m.id}"]`)?.classList.add('active');
  setApiStatus(llm.isConfigured ? 'saved' : 'idle');
}

function initSettings() {
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const i = document.getElementById('input-api-key');
    i.type = i.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const c = readConfig();
    if (!c.baseUrl || !c.apiKey || !c.model) { toast('请填写所有配置项','error'); return; }
    await saveStore({ apiConfig: c });
    llm = new LLMClient(c);
    setApiStatus('saved'); updateFooter();
    toast('配置已保存','success');
  });

  document.getElementById('btn-test').addEventListener('click', async () => {
    const c = readConfig();
    if (!c.baseUrl || !c.apiKey || !c.model) { toast('请先填写完整配置','error'); return; }
    const btn = document.getElementById('btn-test');
    btn.classList.add('loading'); btn.disabled = true;
    setApiStatus('testing');
    const t = new LLMClient(c);
    const r = await t.testConnection();
    btn.classList.remove('loading'); btn.disabled = false;
    setApiStatus(r.success ? 'ok' : 'error');
    toast(r.success ? `连接成功` : `失败: ${r.error}`, r.success ? 'success' : 'error');
  });
}

function readConfig() {
  return {
    baseUrl: document.getElementById('input-base-url').value.trim(),
    apiKey:  document.getElementById('input-api-key').value.trim(),
    model:   document.getElementById('input-model').value.trim(),
  };
}

function setApiStatus(s) {
  const dot = document.getElementById('api-dot');
  const txt = document.getElementById('api-status-text');
  dot.className = 'dot';
  const map = {
    idle:    ['dot-idle','未配置'],
    saved:   ['dot-ok','已保存'],
    testing: ['dot-loading','正在测试…'],
    ok:      ['dot-ok','连接正常'],
    error:   ['dot-error','连接失败'],
  };
  const [cls, label] = map[s] || map.idle;
  dot.classList.add(cls);
  txt.textContent = label;
}

function updateFooter() {
  const el = document.getElementById('footer-api');
  if (llm.isConfigured) { el.textContent = '● 已配置'; el.style.color = 'var(--accent)'; }
  else { el.textContent = '● 未连接'; el.style.color = ''; }
}

// ────────────────────────────────────────
//  Resume Upload & Parse
// ────────────────────────────────────────
function initUpload() {
  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('resume-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
}

async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf','doc','docx'].includes(ext)) { toast('仅支持 PDF / DOCX','error'); return; }

  if (!llm.isConfigured) {
    toast('请先在设置中配置 API 后再上传简历','error');
    switchTab('settings');
    return;
  }

  // Show preview
  const zone = document.getElementById('upload-zone');
  zone.style.display = 'none';
  const preview = document.getElementById('resume-preview');
  preview.innerHTML = `
    <div class="preview-card">
      <span style="font-size:20px">📄</span>
      <div style="flex:1">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${(file.size/1024).toFixed(1)} KB · 解析中…</div>
      </div>
      <button class="btn-remove" id="btn-remove-resume">✕</button>
    </div>`;
  preview.style.display = 'block';

  document.getElementById('btn-remove-resume').addEventListener('click', () => {
    preview.innerHTML = ''; preview.style.display = 'none';
    zone.style.display = ''; document.getElementById('resume-input').value = '';
    resumeData = null;
    saveStore({ resumeData: null });
    document.getElementById('btn-scan').disabled = true;
  });

  try {
    resumeData = await ResumeParser.parse(file, llm, msg => {
      preview.querySelector('.file-size').textContent = msg;
    });

    await saveStore({ resumeData });
    preview.querySelector('.file-size').textContent =
      `${resumeData.name || '未知'} · ${resumeData.targetPosition || '未设目标'} · 解析完成`;
    document.getElementById('btn-scan').disabled = false;
    toast('简历解析完成','success');
  } catch (err) {
    preview.querySelector('.file-size').textContent = `解析失败: ${err.message}`;
    toast(`解析失败: ${err.message}`,'error');
  }
}

function showResumePreview() {
  if (!resumeData) return;
  const zone = document.getElementById('upload-zone');
  zone.style.display = 'none';
  const preview = document.getElementById('resume-preview');
  preview.innerHTML = `
    <div class="preview-card">
      <span style="font-size:20px">📄</span>
      <div style="flex:1">
        <div class="file-name">${resumeData.name || '我的简历'}</div>
        <div class="file-size">${resumeData.targetPosition || ''} · 已缓存</div>
      </div>
      <button class="btn-remove" id="btn-remove-resume">✕</button>
    </div>`;
  preview.style.display = 'block';
  document.getElementById('btn-remove-resume').addEventListener('click', () => {
    preview.innerHTML = ''; preview.style.display = 'none';
    zone.style.display = ''; resumeData = null;
    saveStore({ resumeData: null });
    document.getElementById('btn-scan').disabled = true;
  });
}

// ────────────────────────────────────────
//  Scan + Match Orchestration
// ────────────────────────────────────────
function initScan() {
  document.getElementById('btn-scan').addEventListener('click', startScanAndMatch);
}

async function startScanAndMatch() {
  if (!resumeData) { toast('请先上传简历','error'); return; }

  const statusEl  = document.getElementById('scan-status');
  const progressEl = document.getElementById('match-progress');
  const fillEl     = document.getElementById('match-progress-fill');
  const btn = document.getElementById('btn-scan');
  btn.disabled = true;

  // Step 1: Scan Boss 直聘
  statusEl.innerHTML = '<span class="dot dot-loading"></span><span>正在扫描岗位…</span>';

  let jobs;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('zhipin.com')) {
      toast('请先打开 Boss 直聘搜索页','error');
      statusEl.innerHTML = '<span class="dot dot-error"></span><span>当前页面不是 Boss 直聘</span>';
      btn.disabled = false;
      return;
    }
    jobs = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: 'START_SCAN' }, res => {
        if (chrome.runtime.lastError) return reject(new Error('无法连接页面，请刷新后重试'));
        if (!res?.success) return reject(new Error(res?.error || '扫描失败'));
        resolve(res.jobs);
      });
    });
  } catch (err) {
    statusEl.innerHTML = `<span class="dot dot-error"></span><span>${err.message}</span>`;
    btn.disabled = false;
    return;
  }

  if (!jobs?.length) {
    statusEl.innerHTML = '<span class="dot dot-warn"></span><span>未发现任何岗位</span>';
    btn.disabled = false;
    return;
  }

  statusEl.innerHTML = `<span class="dot dot-loading"></span><span>扫描到 ${jobs.length} 个岗位，开始匹配…</span>`;
  document.getElementById('stat-scanned').textContent = jobs.length;

  // Step 2: AI Matching
  if (!llm.isConfigured) {
    statusEl.innerHTML = `<span class="dot dot-ok"></span><span>扫描完成 ${jobs.length} 个，请配置 API 启用匹配</span>`;
    btn.disabled = false;
    return;
  }

  progressEl.style.display = 'block';
  fillEl.style.width = '0%';

  try {
    matchResults = await Matcher.batchMatch(resumeData, jobs, llm, (msg, count) => {
      statusEl.innerHTML = `<span class="dot dot-loading"></span><span>${msg}</span>`;
      const pct = jobs.length > 0 ? Math.round((count / jobs.length) * 100) : 0;
      fillEl.style.width = `${pct}%`;
    });

    await saveStore({ matchResults });
    renderResults(matchResults);
    updateStats();

    const high = matchResults.filter(r => r.matchScore >= 75).length;
    statusEl.innerHTML = `<span class="dot dot-ok"></span><span>匹配完成 — ${high} 个高匹配岗位</span>`;
    progressEl.style.display = 'none';
    toast(`匹配完成，发现 ${high} 个高匹配岗位`,'success');
  } catch (err) {
    statusEl.innerHTML = `<span class="dot dot-error"></span><span>匹配失败: ${err.message}</span>`;
    progressEl.style.display = 'none';
    toast(`匹配失败: ${err.message}`,'error');
  }

  btn.disabled = false;
}

// ────────────────────────────────────────
//  Results Rendering
// ────────────────────────────────────────
function initResultsSort() {
  document.getElementById('results-sort').addEventListener('change', e => {
    const sorted = [...matchResults];
    if (e.target.value === 'score-asc') sorted.sort((a,b) => a.matchScore - b.matchScore);
    else sorted.sort((a,b) => b.matchScore - a.matchScore);
    renderResults(sorted);
  });
}

function renderResults(results) {
  const list = document.getElementById('results-list');
  const empty = document.getElementById('results-empty');
  const header = document.getElementById('results-header');

  if (!results?.length) {
    list.innerHTML = ''; empty.style.display = ''; header.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  header.style.display = 'flex';
  document.getElementById('results-count').textContent = `${results.length} 个结果`;

  list.innerHTML = results.map((r, i) => {
    const level = r.matchScore >= 75 ? 'high' : r.matchScore >= 60 ? 'mid' : 'low';
    const levelLabel = { high:'高匹配', mid:'中匹配', low:'低匹配' }[level] || '未匹配';
    // SVG circle: circumference ≈ 100
    const dash = `${r.matchScore}, 100`;

    return `
    <div class="result-card" style="animation-delay:${i * 0.04}s">
      <div class="result-top">
        <div class="score-ring">
          <svg viewBox="0 0 36 36">
            <path class="track" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
            <path class="fill ${level}" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" stroke-dasharray="${dash}"/>
          </svg>
          <span class="value">${r.matchScore}</span>
        </div>
        <div class="result-info">
          <div class="result-title">${esc(r.title)}</div>
          <div class="result-company">${esc(r.company)}</div>
          <div class="result-meta">
            <span class="match-badge ${level}">${levelLabel}</span>
            <span>${esc(r.salary)}</span>
            <span>${esc(r.location)}</span>
          </div>
        </div>
        <button class="result-expand" data-idx="${i}">详情 ▾</button>
      </div>
      <div class="result-details" id="detail-${i}">
        <div class="detail-section">
          <div class="detail-label">匹配优势</div>
          <ul class="detail-list strengths">
            ${(r.strengths||[]).map(s => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </div>
        <div class="detail-section">
          <div class="detail-label">待提升</div>
          <ul class="detail-list gaps">
            ${(r.gaps||[]).map(g => `<li>${esc(g)}</li>`).join('')}
          </ul>
        </div>
        ${r.suggestionBrief ? `<div class="detail-section"><div class="detail-label">建议</div><p style="font-size:11px;color:var(--text-2)">${esc(r.suggestionBrief)}</p></div>` : ''}
        <div class="result-actions">
          ${r.matchScore >= 60 ? `<button class="btn btn-primary btn-sm btn-greet" data-idx="${i}">打招呼</button>` : ''}
          ${r.link ? `<a href="${esc(r.link)}" target="_blank" class="btn btn-secondary btn-sm">查看详情</a>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  // Toggle details
  list.querySelectorAll('.result-expand').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.dataset.idx;
      const detail = document.getElementById(`detail-${idx}`);
      const open = detail.classList.toggle('open');
      btn.textContent = open ? '收起 ▴' : '详情 ▾';
    });
  });

  // Greeting button
  list.querySelectorAll('.btn-greet').forEach(btn => {
    btn.addEventListener('click', () => openGreetingModal(Number(btn.dataset.idx)));
  });
}

function updateStats() {
  document.getElementById('stat-scanned').textContent = matchResults.length;
  document.getElementById('stat-high').textContent = matchResults.filter(r => r.matchScore >= 75).length;
  document.getElementById('stat-sent').textContent = sendHistory.filter(h => h.status === 'sent').length;
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ────────────────────────────────────────
//  History
// ────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  if (!sendHistory?.length) { list.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';

  list.innerHTML = sendHistory.map(h => `
    <div class="history-item">
      <div class="h-top">
        <div>
          <div class="h-title">${esc(h.title)}</div>
          <div class="h-company">${esc(h.company)}</div>
        </div>
        <div class="h-time">${h.time || ''}</div>
      </div>
      <span class="h-status ${h.status}">${h.status === 'sent' ? '已发送' : '失败'}</span>
      ${h.greeting ? `<div class="h-greeting">${esc(h.greeting)}</div>` : ''}
    </div>
  `).join('');
}

// ────────────────────────────────────────
//  Greeting Modal
// ────────────────────────────────────────
let currentGreetingJob = null;

function initModal() {
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  const textarea = document.getElementById('modal-greeting');
  textarea.addEventListener('input', () => {
    document.getElementById('char-count').textContent = textarea.value.length;
    document.getElementById('modal-confirm').disabled = textarea.value.trim().length === 0;
  });

  document.getElementById('modal-confirm').addEventListener('click', confirmSendGreeting);
}

async function openGreetingModal(idx) {
  const job = matchResults[idx];
  if (!job) return;
  currentGreetingJob = job;

  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-job-info').innerHTML =
    `<strong>${esc(job.title)}</strong> · ${esc(job.company)}<br><span style="color:var(--text-3)">${esc(job.salary)} · ${esc(job.location)}</span>`;
  document.getElementById('modal-greeting').value = '';
  document.getElementById('char-count').textContent = '0';
  document.getElementById('modal-confirm').disabled = true;
  overlay.classList.add('show');

  // Generate greeting
  try {
    const greeting = await GreetingGenerator.generate(resumeData, job, llm);
    document.getElementById('modal-greeting').value = greeting;
    document.getElementById('char-count').textContent = greeting.length;
    document.getElementById('modal-confirm').disabled = false;
  } catch (err) {
    document.getElementById('modal-greeting').placeholder = `生成失败: ${err.message}`;
    toast(`招呼语生成失败: ${err.message}`, 'error');
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
  currentGreetingJob = null;
}

async function confirmSendGreeting() {
  if (!currentGreetingJob) return;
  const greeting = document.getElementById('modal-greeting').value.trim();
  if (!greeting) return;

  const btn = document.getElementById('modal-confirm');
  btn.classList.add('loading'); btn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('zhipin.com')) {
      throw new Error('请切换到 Boss 直聘页面');
    }

    const result = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SEND_GREETING',
        jobTitle: currentGreetingJob.title,
        company: currentGreetingJob.company,
        greetingText: greeting,
      }, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve(res);
      });
    });

    if (result?.success) {
      const record = {
        title: currentGreetingJob.title,
        company: currentGreetingJob.company,
        greeting,
        status: 'sent',
        time: new Date().toLocaleString('zh-CN'),
      };
      sendHistory.unshift(record);
      await saveStore({ sendHistory });
      renderHistory();
      updateStats();
      toast('招呼语已发送','success');
    } else {
      throw new Error(result?.error || '发送失败');
    }
  } catch (err) {
    const record = {
      title: currentGreetingJob.title,
      company: currentGreetingJob.company,
      greeting,
      status: 'failed',
      time: new Date().toLocaleString('zh-CN'),
    };
    sendHistory.unshift(record);
    await saveStore({ sendHistory });
    renderHistory();
    toast(`发送失败: ${err.message}`, 'error');
  }

  btn.classList.remove('loading'); btn.disabled = false;
  closeModal();
}

// ────────────────────────────────────────
//  Toast
// ────────────────────────────────────────
function toast(msg, type = 'info') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}

/* ============================================================
   Offer 捕手 v2 — Content Script
   负责：岗位 DOM 抓取 · 浮窗面板 · 自动打招呼
   ============================================================ */

(() => {
  'use strict';

  // ────────────────────────────────────────
  //  State
  // ────────────────────────────────────────
  let panel = null;
  let isOperating = false;        // 是否正在执行自动操作
  let stopRequested = false;      // 是否请求停止

  // ────────────────────────────────────────
  //  Message Listener
  // ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_SCAN') {
      handleScan(sendResponse);
      return true; // async
    }
    if (msg.type === 'SEND_GREETING') {
      handleGreeting(msg).then(sendResponse);
      return true; // async
    }
  });

  // ────────────────────────────────────────
  //  Scan Handler
  // ────────────────────────────────────────
  function handleScan(sendResponse) {
    try {
      const jobs = scanJobCards();
      showPanel('scan', { count: jobs.length });
      sendResponse({ success: true, count: jobs.length, jobs });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  // ────────────────────────────────────────
  //  Job Card Scanner
  // ────────────────────────────────────────
  function scanJobCards() {
    const jobs = [];
    const selectors = [
      '.job-card-wrapper',
      '.search-job-result .job-card-body',
      '[class*="job-card"]',
      '.job-list-box .job-card-wrapper',
    ];

    let cards = [];
    for (const sel of selectors) {
      cards = document.querySelectorAll(sel);
      if (cards.length > 0) break;
    }

    cards.forEach(card => {
      try {
        const getTxt = sels => {
          for (const s of sels) {
            const el = card.querySelector(s);
            if (el?.textContent?.trim()) return el.textContent.trim();
          }
          return '';
        };
        const getHref = sels => {
          for (const s of sels) {
            const el = card.querySelector(s);
            if (el?.href) return el.href;
          }
          return '';
        };

        const job = {
          title:      getTxt(['.job-name', '[class*="job-name"]', '.job-title']),
          company:    getTxt(['.company-name a', '[class*="company-name"]', '.company-name']),
          salary:     getTxt(['.salary', '[class*="salary"]', '.job-limit .red']),
          location:   getTxt(['.job-area', '[class*="job-area"]']),
          experience: getTxt(['.tag-list li:first-child', '.job-limit .tag-list li']),
          education:  getTxt(['.tag-list li:nth-child(2)', '.job-limit .tag-list li:last-child']),
          tags:       [...card.querySelectorAll('.tag-list li, .job-tags span')].map(t => t.textContent.trim()).filter(Boolean),
          link:       getHref(['.job-card-left a', 'a[ka*="search"]', 'a']),
          hasButton:  !!card.querySelector('[class*="btn-startchat"], .op-btn-chat, [ka*="search_job_btn_im"]'),
        };

        if (job.title) jobs.push(job);
      } catch (_) { /* skip */ }
    });

    return jobs;
  }

  // ────────────────────────────────────────
  //  Greeting Automation
  // ────────────────────────────────────────
  async function handleGreeting({ jobTitle, company, greetingText }) {
    if (isOperating) return { success: false, error: '正在执行其他操作，请稍候' };
    isOperating = true;
    stopRequested = false;

    try {
      showPanel('greeting', { jobTitle, company, status: '查找岗位…' });

      // 1. Find job card
      const jobCard = findJobCard(jobTitle, company);
      if (!jobCard) throw new Error('未在当前页面找到该岗位，请确保搜索结果中包含此岗位');

      if (stopRequested) throw new Error('用户已取消');

      // 2. Find & click "立即沟通"
      updatePanelStatus('正在打开聊天…');
      const chatBtn = findChatButton(jobCard);
      if (!chatBtn) throw new Error('未找到「立即沟通」按钮');
      chatBtn.click();
      await sleep(2500);

      if (stopRequested) throw new Error('用户已取消');

      // 3. Wait for chat input
      updatePanelStatus('等待聊天加载…');
      const chatInput = await waitForElement([
        '.chat-conversation textarea',
        '.chat-conversation [contenteditable="true"]',
        '.chat-input textarea',
        '[class*="chat"] textarea',
        '[class*="chat-input"] [contenteditable]',
        '[class*="chat-input"] textarea',
        'textarea[name="message"]',
        '.conversation-wrap textarea',
      ], 8000);

      if (!chatInput) throw new Error('聊天输入框未加载，请手动操作');
      if (stopRequested) throw new Error('用户已取消');

      // 4. Type greeting
      updatePanelStatus('正在输入招呼语…');
      await typeText(chatInput, greetingText);
      await sleep(800);

      // 5. Send
      updatePanelStatus('正在发送…');
      const sendBtn = findSendButton();
      if (!sendBtn) throw new Error('未找到发送按钮，请手动点击发送');
      sendBtn.click();
      await sleep(1500);

      updatePanelStatus('发送完成 ✓');
      isOperating = false;
      return { success: true };

    } catch (err) {
      isOperating = false;
      updatePanelStatus(`失败: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ────────────────────────────────────────
  //  DOM Helpers
  // ────────────────────────────────────────
  function findJobCard(title, company) {
    const cardSels = [
      '.job-card-wrapper',
      '.search-job-result .job-card-body',
      '[class*="job-card"]',
      '.job-list-box .job-card-wrapper',
    ];

    let cards = [];
    for (const sel of cardSels) {
      cards = document.querySelectorAll(sel);
      if (cards.length > 0) break;
    }

    // Normalize for fuzzy matching
    const norm = s => (s || '').replace(/\s+/g, '').toLowerCase();
    const nTitle = norm(title);
    const nCompany = norm(company);

    for (const card of cards) {
      const ct = norm(getTextFrom(card, ['.job-name', '[class*="job-name"]', '.job-title']));
      const cc = norm(getTextFrom(card, ['.company-name a', '[class*="company-name"]', '.company-name']));

      // Fuzzy match: one contains the other
      if ((ct.includes(nTitle) || nTitle.includes(ct)) &&
          (cc.includes(nCompany) || nCompany.includes(cc))) {
        return card;
      }
    }
    return null;
  }

  function findChatButton(card) {
    const sels = [
      '.op-btn-chat',
      '[class*="btn-startchat"]',
      '[class*="btn-chat"]',
      'button[class*="chat"]',
    ];
    for (const s of sels) {
      const btn = card.querySelector(s);
      if (btn) return btn;
    }
    // Text fallback
    for (const btn of card.querySelectorAll('button, a')) {
      const txt = btn.textContent.trim();
      if (txt.includes('立即沟通') || txt === '沟通') return btn;
    }
    return null;
  }

  function findSendButton() {
    const sels = [
      '.chat-conversation .btn-send',
      '[class*="btn-send"]',
      '[class*="send-btn"]',
      'button[class*="send"]',
      '.conversation-wrap .btn-send',
    ];
    for (const s of sels) {
      const btn = document.querySelector(s);
      if (btn && !btn.disabled) return btn;
    }
    // Text fallback
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent.trim() === '发送' && !btn.disabled) return btn;
    }
    return null;
  }

  async function waitForElement(selectors, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      await sleep(300);
    }
    return null;
  }

  async function typeText(el, text) {
    el.focus();
    await sleep(200);

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // React-compatible value setting
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable
      el.innerHTML = '';
      document.execCommand('insertText', false, text);
    }
  }

  function getTextFrom(parent, selectors) {
    for (const s of selectors) {
      const el = parent.querySelector(s);
      if (el?.textContent?.trim()) return el.textContent.trim();
    }
    return '';
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ────────────────────────────────────────
  //  Floating Panel (injected into page)
  // ────────────────────────────────────────
  function showPanel(mode, data = {}) {
    if (panel) { updatePanelContent(mode, data); return; }

    panel = document.createElement('div');
    panel.className = 'oc-panel';
    document.body.appendChild(panel);
    updatePanelContent(mode, data);

    // Make draggable
    let drag = false, ox, oy;
    const header = panel.querySelector('.oc-panel-header');
    header.addEventListener('mousedown', e => {
      drag = true;
      ox = e.clientX - panel.offsetLeft;
      oy = e.clientY - panel.offsetTop;
      header.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = (e.clientX - ox) + 'px';
      panel.style.top  = (e.clientY - oy) + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { drag = false; if(header) header.style.cursor = 'grab'; });
  }

  function updatePanelContent(mode, data = {}) {
    if (!panel) return;

    let body = '';
    if (mode === 'scan') {
      body = `
        <div class="oc-row"><span class="oc-label">已扫描</span><span class="oc-val">${data.count || 0} 个岗位</span></div>
        <div class="oc-hint">匹配结果请查看扩展弹窗</div>
      `;
    } else if (mode === 'greeting') {
      body = `
        <div class="oc-row"><span class="oc-label">目标</span><span class="oc-val">${esc(data.jobTitle || '')}</span></div>
        <div class="oc-row"><span class="oc-label">公司</span><span class="oc-val">${esc(data.company || '')}</span></div>
        <div class="oc-row oc-status-row"><span class="oc-dot oc-dot-loading"></span><span class="oc-val" id="oc-status">${esc(data.status || '')}</span></div>
        <button class="oc-btn-stop" id="oc-stop">紧急停止</button>
      `;
    }

    panel.innerHTML = `
      <div class="oc-panel-header">
        <span class="oc-logo">◆ Offer 捕手</span>
        <button class="oc-close" id="oc-close">✕</button>
      </div>
      <div class="oc-panel-body">${body}</div>
    `;

    document.getElementById('oc-close')?.addEventListener('click', destroyPanel);
    document.getElementById('oc-stop')?.addEventListener('click', () => {
      stopRequested = true;
      updatePanelStatus('已请求停止…');
    });
  }

  function updatePanelStatus(text) {
    const el = document.getElementById('oc-status');
    if (el) el.textContent = text;
  }

  function destroyPanel() {
    panel?.remove();
    panel = null;
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

})();

/* ============================================================
   Offer 捕手 — Service Worker
   ============================================================ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Update badge on scan complete
  if (msg.type === 'UPDATE_BADGE') {
    chrome.action.setBadgeText({ text: msg.text || '' });
    chrome.action.setBadgeBackgroundColor({ color: msg.color || '#00e8a1' });
  }
});

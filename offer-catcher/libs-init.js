/* libs-init.js — 放在 popup.js 之前执行 */
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.min.js');

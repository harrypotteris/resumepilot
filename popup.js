const enabled = document.getElementById('enabled');
const backend = document.getElementById('backend');
const last = document.getElementById('last');

chrome.storage.local.get(['enabled', 'lastRun'], ({ enabled: on = true, lastRun }) => {
  enabled.checked = on;
  if (lastRun) last.textContent = `Last run: ${lastRun.filled}/${lastRun.total} fields on ${lastRun.host}`;
});

enabled.onchange = () => chrome.storage.local.set({ enabled: enabled.checked });

document.getElementById('now').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'fillNow' });
  window.close();
};

fetch('http://localhost:8000/health')
  .then(r => r.json())
  .then(() => { backend.textContent = 'Backend: running'; backend.className = 'line ok'; })
  .catch(() => { backend.textContent = 'Backend: NOT running (start uvicorn)'; backend.className = 'line bad'; });
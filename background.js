const BACKEND = 'http://localhost:8000';

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg.type !== 'fill') return;
  fetch(BACKEND + '/fill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: msg.url, fields: msg.fields }),
  })
    .then(async r => {
      if (!r.ok) throw new Error('backend ' + r.status + ': ' + (await r.text()).slice(0, 200));
      return r.json();
    })
    .then(data => send({ ok: true, data }))
    .catch(e => send({ ok: false, error: e.message }));
  return true; // keep the channel open for the async response
});
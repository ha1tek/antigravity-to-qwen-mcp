const WebSocket = require('ws');

(async () => {
  const targetsRes = await fetch('http://localhost:9222/json/list');
  const targets = await targetsRes.json();
  const webview = targets.find(t => t.type === 'webview' || t.url.includes('chat.qwen.ai'));
  const ws = new WebSocket(webview.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const curId = id++;
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === curId) {
          ws.off('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id: curId, method, params }));
    });
  }

  await send('Debugger.enable', {});
  const src = await send('Debugger.getScriptSource', { scriptId: '136' });

  // Look for cn.IMAGE or cn.DOC or uploadHandler calls
  const cnIdx = src.scriptSource.indexOf('cn={})');
  const cnDefIdx = src.scriptSource.indexOf('cn.IMAGE');
  console.log('cn.IMAGE idx:', cnDefIdx);
  if (cnDefIdx !== -1) {
    console.log(src.scriptSource.slice(cnDefIdx - 100, cnDefIdx + 200));
  }

  // Look for mode-select upload options
  const uploadMenuIdx = src.scriptSource.indexOf('Загрузить вложение');
  console.log('Upload menu idx:', uploadMenuIdx);
  if (uploadMenuIdx !== -1) {
    console.log(src.scriptSource.slice(uploadMenuIdx - 200, uploadMenuIdx + 300));
  }

  ws.close();
})().catch(console.error);

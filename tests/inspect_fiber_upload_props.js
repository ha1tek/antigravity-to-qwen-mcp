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

  const res = await send('Runtime.evaluate', {
    expression: `
      (function() {
        const inp = document.querySelector('#filesUpload');
        const fiberKey = Object.keys(inp).find(k => k.startsWith('__reactFiber'));
        let cur = inp[fiberKey];
        let dE_fiber = null;
        while (cur) {
          if (cur.memoizedProps && cur.memoizedProps.uploadHandler) {
            dE_fiber = cur;
            break;
          }
          cur = cur.return;
        }

        return {
          dE_props: dE_fiber ? Object.keys(dE_fiber.memoizedProps) : null
        };
      })()
    `,
    returnByValue: true
  });

  console.log('Result:', res.result.value);

  ws.close();
})().catch(console.error);

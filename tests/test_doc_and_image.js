const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

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

  // Clear existing cards
  await send('Runtime.evaluate', {
    expression: `
      (function() {
        const btns = document.querySelectorAll('.close-button');
        btns.forEach(b => b.click());
      })()
    `
  });
  await new Promise(r => setTimeout(r, 600));

  // Small 1x1 PNG base64:
  const redDotPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

        if (!dE_fiber || !dE_fiber.memoizedProps.uploadHandler) {
          return { error: 'uploadHandler not found' };
        }

        const handler = dE_fiber.memoizedProps.uploadHandler;

        // 1. Create document File
        const docFile = new File(['[ЗАДАЧА СУБАГЕНТА]\\nТекст задачи'], 'task_prompt.txt', { type: 'text/plain' });

        // 2. Create image File
        const binStr = atob('${redDotPngBase64}');
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        const imgFile = new File([bytes], 'screenshot_ui.png', { type: 'image/png' });

        try {
          // Upload documents
          handler({ files: [docFile], type: ["document"] });
          // Upload images
          handler({ files: [imgFile], type: ["vision"] });
          return { success: true };
        } catch(e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true
  });

  console.log('Upload result:', JSON.stringify(res.result.value, null, 2));

  await new Promise(r => setTimeout(r, 2000));

  const check = await send('Runtime.evaluate', {
    expression: `
      (function() {
        const items = Array.from(document.querySelectorAll('.fileitem-btn')).map(item => item.innerText.replace(/\\n/g, ' '));
        return { count: items.length, items };
      })()
    `,
    returnByValue: true
  });
  console.log('DOM check:', JSON.stringify(check.result.value, null, 2));

  // Screenshot
  await send('Page.enable', {});
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(screenshot.data, 'base64');
  const outPath = path.resolve('tests/doc_and_image_screenshot.png');
  fs.writeFileSync(outPath, buffer);
  console.log('Screenshot saved to:', outPath);

  ws.close();
})().catch(console.error);

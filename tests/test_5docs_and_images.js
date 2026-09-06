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

  // Small PNG base64
  const redDotPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const blueDotPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEfQHz/P+VwAAAAABJRU5ErkJggg==';

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

        // 1. Create 5 documents (1 prompt + 4 project files)
        const doc1 = new File(['[ПРОМТ ЗАДАЧИ] Содержимое task_prompt.txt'], 'task_prompt.txt', { type: 'text/plain' });
        const doc2 = new File(['export default function App() {}'], 'App.tsx', { type: 'text/plain' });
        const doc3 = new File(['{"name": "my-app"}'], 'package.json', { type: 'text/plain' });
        const doc4 = new File(['export const utils = {};'], 'utils.ts', { type: 'text/plain' });
        const doc5 = new File(['body { margin: 0; }'], 'index.css', { type: 'text/plain' });

        // 2. Create 2 images
        function b64ToFile(b64, name) {
          const binStr = atob(b64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
          return new File([bytes], name, { type: 'image/png' });
        }

        const img1 = b64ToFile('${redDotPngBase64}', 'reference_design.png');
        const img2 = b64ToFile('${blueDotPngBase64}', 'screenshot_navbar.png');

        try {
          // Upload 5 documents
          handler({ files: [doc1, doc2, doc3, doc4, doc5], type: ["document"] });
          // Upload 2 images
          handler({ files: [img1, img2], type: ["vision"] });
          return { success: true };
        } catch(e) {
          return { error: e.message };
        }
      })()
    `,
    returnByValue: true
  });

  console.log('Upload result:', JSON.stringify(res.result.value, null, 2));

  // Wait 2.5s for analysis
  await new Promise(r => setTimeout(r, 2500));

  // Check DOM items
  const check = await send('Runtime.evaluate', {
    expression: `
      (function() {
        const docCards = Array.from(document.querySelectorAll('.fileitem-btn')).map(item => item.innerText.replace(/\\n/g, ' '));
        const allCloseBtns = document.querySelectorAll('.close-button').length;
        return {
          docCount: docCards.length,
          docCards,
          totalCards: allCloseBtns
        };
      })()
    `,
    returnByValue: true
  });
  console.log('Check in DOM:', JSON.stringify(check.result.value, null, 2));

  // Screenshot
  await send('Page.enable', {});
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(screenshot.data, 'base64');
  const outPath = path.resolve('tests/five_docs_and_two_images.png');
  fs.writeFileSync(outPath, buffer);
  console.log('Screenshot saved to:', outPath);

  ws.close();
})().catch(console.error);

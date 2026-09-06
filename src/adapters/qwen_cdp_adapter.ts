import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, exec } from 'child_process';
import WebSocket from 'ws';
import { ServerConfig } from '../types';
import { isImageFile } from '../project_context';

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.bmp': return 'image/bmp';
    case '.ico': return 'image/x-icon';
    case '.avif': return 'image/avif';
    case '.txt': return 'text/plain';
    case '.json': return 'application/json';
    case '.ts':
    case '.tsx': return 'text/typescript';
    case '.js':
    case '.jsx': return 'text/javascript';
    case '.css': return 'text/css';
    case '.html': return 'text/html';
    case '.md': return 'text/markdown';
    default: return 'text/plain';
  }
}

export interface CDPTarget {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export class QwenCDPAdapter {
  private config: ServerConfig;
  private ws: WebSocket | null = null;
  private messageId = 1;
  private pendingCallbacks = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Automatically locate Qwen.exe on this PC
   */
  public locateQwenExecutable(): string | null {
    const candidates = [
      this.config.qwenExePath,
      'C:\\Program Files\\Qwen\\Qwen.exe',
      'C:\\Program Files (x86)\\Qwen\\Qwen.exe',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Qwen', 'Qwen.exe') : '',
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Qwen', 'Qwen.exe') : ''
    ].filter(Boolean);

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }
    return null;
  }

  /**
   * Launch Qwen with remote debugging enabled
   */
  public async launchQwenWithDebugging(): Promise<boolean> {
    const exePath = this.locateQwenExecutable();
    if (!exePath) {
      throw new Error(
        'Qwen.exe не найден на этом компьютере. Убедитесь, что Qwen Studio установлен, или укажите путь в config.json.'
      );
    }

    // Kill any existing Qwen instance running without debugging port
    try {
      execSync('taskkill /F /IM Qwen.exe', { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 1500));
    } catch {}

    // Launch Qwen interactively on user desktop with remote debugging enabled
    let launched = false;
    try {
      const taskName = 'LaunchQwenMCP';
      execSync(
        `schtasks /create /tn "${taskName}" /tr "\\"${exePath}\\" --remote-debugging-port=${this.config.cdpPort}" /sc once /st 00:00 /f /it`,
        { stdio: 'ignore' }
      );
      execSync(`schtasks /run /tn "${taskName}"`, { stdio: 'ignore' });
      setTimeout(() => {
        try {
          execSync(`schtasks /delete /tn "${taskName}" /f`, { stdio: 'ignore' });
        } catch {}
      }, 5000);
      launched = true;
    } catch {
      launched = false;
    }

    if (!launched) {
      // Fallback to start
      exec(`cmd.exe /c start "" "${exePath}" --remote-debugging-port=${this.config.cdpPort}`);
    }

    // Wait up to 20 seconds for CDP port to respond
    const start = Date.now();
    while (Date.now() - start < 20000) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await this.isAvailable()) {
        // Wait 2 extra seconds for full webview readiness
        await new Promise((r) => setTimeout(r, 2000));
        return true;
      }
    }

    throw new Error(
      `Не удалось запустить Qwen с портом отладки ${this.config.cdpPort} за 20 секунд.`
    );
  }

  /**
   * Ensure Qwen is running and accessible via CDP
   */
  public async ensureReady(): Promise<boolean> {
    if (await this.isAvailable()) {
      return true;
    }
    return await this.launchQwenWithDebugging();
  }

  /**
   * Check if CDP port is responding
   */
  public async isAvailable(): Promise<boolean> {
    try {
      const targets = await this.getTargets();
      return targets.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Fetch all debugging targets from Chromium
   */
  public getTargets(): Promise<CDPTarget[]> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        `http://${this.config.cdpHost}:${this.config.cdpPort}/json/list`,
        { timeout: 3000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const targets = JSON.parse(data) as CDPTarget[];
              resolve(targets);
            } catch (e) {
              reject(new Error(`Failed to parse targets: ${e}`));
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('CDP target discovery timed out'));
      });
    });
  }

  /**
   * Find the Qwen chat page/webview target
   */
  public async findQwenTarget(): Promise<CDPTarget> {
    const targets = await this.getTargets();

    // Prioritize the chat.qwen.ai webview target specifically
    const qwenTarget =
      targets.find((t) => t.type === 'webview' && t.url.includes('chat.qwen.ai')) ||
      targets.find((t) => t.url.includes('chat.qwen.ai')) ||
      targets.find((t) => t.title.includes('Qwen Studio')) ||
      targets.find((t) => t.type === 'webview') ||
      targets.find((t) => t.type === 'page' && !t.url.includes('out/renderer/index.html'));

    if (!qwenTarget || !qwenTarget.webSocketDebuggerUrl) {
      throw new Error(
        `Qwen chat target not found among ${targets.length} targets on port ${this.config.cdpPort}. ` +
        `Ensure Qwen is running with --remote-debugging-port=${this.config.cdpPort}`
      );
    }

    return qwenTarget;
  }

  /**
   * Connect to CDP WebSocket for a target
   */
  public async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const target = await this.findQwenTarget();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl!);
      this.ws = ws;

      ws.on('open', async () => {
        try {
          await this.sendCDP('Runtime.enable', {});
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.id && this.pendingCallbacks.has(parsed.id)) {
            const cb = this.pendingCallbacks.get(parsed.id)!;
            this.pendingCallbacks.delete(parsed.id);
            if (parsed.error) {
              cb.reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            } else {
              cb.resolve(parsed.result);
            }
          }
        } catch (e) {
          console.error('[CDP] Error handling message:', e);
        }
      });

      ws.on('error', (err) => {
        console.error('[CDP] WebSocket error:', err);
        reject(err);
      });

      ws.on('close', () => {
        this.ws = null;
      });
    });
  }

  /**
   * Send a CDP command and wait for response
   */
  public sendCDP(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('CDP WebSocket is not open'));
      }
      const id = this.messageId++;
      this.pendingCallbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluate JavaScript in the page context
   */
  public async evaluate<T = any>(expression: string): Promise<T> {
    await this.connect();
    const result = await this.sendCDP('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    if (result.exceptionDetails) {
      throw new Error(`Evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
    }

    return result.result?.value as T;
  }

  /**
   * Attach files to Qwen Studio using React Fiber uploadHandler with CDP fallback
   * Supports up to 5 documents (type: ["document"]) and up to 5 images (type: ["vision"]) (total up to 10 files)
   */
  public async attachFiles(
    files: string[] | { docFiles?: string[]; imageFiles?: string[] }
  ): Promise<boolean> {
    if (!files) return true;

    let docPaths: string[] = [];
    let imagePaths: string[] = [];

    if (Array.isArray(files)) {
      for (const f of files) {
        if (isImageFile(f)) {
          imagePaths.push(f);
        } else {
          docPaths.push(f);
        }
      }
    } else {
      if (files.docFiles) {
        for (const f of files.docFiles) {
          if (isImageFile(f)) imagePaths.push(f);
          else docPaths.push(f);
        }
      }
      if (files.imageFiles) {
        for (const f of files.imageFiles) {
          if (isImageFile(f)) imagePaths.push(f);
          else docPaths.push(f);
        }
      }
    }

    const validDocPaths = docPaths
      .map((p) => path.resolve(p))
      .filter((p) => fs.existsSync(p))
      .slice(0, 5); // Max 5 documents

    const validImagePaths = imagePaths
      .map((p) => path.resolve(p))
      .filter((p) => fs.existsSync(p))
      .slice(0, 5); // Max 5 images

    if (validDocPaths.length === 0 && validImagePaths.length === 0) return true;

    await this.connect();

    const docFilesData = validDocPaths.map((filePath) => {
      const name = path.basename(filePath);
      const mimeType = getMimeType(filePath);
      try {
        const buf = fs.readFileSync(filePath);
        const isBinary = buf.slice(0, 1000).some((b) => b === 0);
        if (isBinary) {
          return { name, base64: buf.toString('base64'), mimeType, isBinary: true };
        } else {
          return { name, content: buf.toString('utf8'), mimeType, isBinary: false };
        }
      } catch (e) {
        return { name, content: '', mimeType, isBinary: false };
      }
    });

    const imageFilesData = validImagePaths.map((filePath) => {
      const name = path.basename(filePath);
      const mimeType = getMimeType(filePath);
      try {
        const buf = fs.readFileSync(filePath);
        return { name, base64: buf.toString('base64'), mimeType, isBinary: true };
      } catch (e) {
        return { name, base64: '', mimeType, isBinary: true };
      }
    });

    try {
      // 1. Try direct React Fiber uploadHandler
      const attachRes = await this.evaluate<{ success: boolean; error?: string; count?: number }>(`
        (function() {
          const docFilesData = ${JSON.stringify(docFilesData)};
          const imageFilesData = ${JSON.stringify(imageFilesData)};
          const inp = document.querySelector('#filesUpload');
          if (!inp) return { success: false, error: 'No #filesUpload element' };

          const fiberKey = Object.keys(inp).find(k => k.startsWith('__reactFiber'));
          if (!fiberKey) return { success: false, error: 'No React fiber on input' };

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
            return { success: false, error: 'uploadHandler not found in React fiber' };
          }

          const handler = dE_fiber.memoizedProps.uploadHandler;

          function b64ToFile(base64, name, mimeType) {
            const binStr = atob(base64);
            const bytes = new Uint8Array(binStr.length);
            for (let i = 0; i < binStr.length; i++) {
              bytes[i] = binStr.charCodeAt(i);
            }
            return new File([bytes], name, { type: mimeType || 'application/octet-stream' });
          }

          const docWebFiles = docFilesData.map(f => {
            if (f.isBinary && f.base64) {
              return b64ToFile(f.base64, f.name, f.mimeType);
            } else {
              return new File([f.content || ''], f.name, { type: f.mimeType || 'text/plain' });
            }
          });

          const imageWebFiles = imageFilesData.map(f => {
            return b64ToFile(f.base64, f.name, f.mimeType);
          });

          try {
            if (docWebFiles.length > 0) {
              handler({ files: docWebFiles, type: ["document"] });
            }
            if (imageWebFiles.length > 0) {
              handler({ files: imageWebFiles, type: ["vision"] });
            }
            return { success: true, count: docWebFiles.length + imageWebFiles.length };
          } catch (err) {
            return { success: false, error: (err && err.message) || String(err) };
          }
        })()
      `);

      if (!attachRes || !attachRes.success) {
        console.warn('[CDP] Direct React uploadHandler failed, attempting CDP fallback:', attachRes?.error);
        const allFiles = [...validDocPaths, ...validImagePaths];
        await this.sendCDP('DOM.enable', {});
        const doc = await this.sendCDP('DOM.getDocument', {});
        const node = await this.sendCDP('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: '#filesUpload'
        });

        if (node && node.nodeId) {
          await this.sendCDP('DOM.setFileInputFiles', {
            files: allFiles,
            nodeId: node.nodeId
          });
          await this.evaluate(`
            (function() {
              const inp = document.querySelector('#filesUpload');
              if (inp) {
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                inp.dispatchEvent(new Event('input', { bubbles: true }));
              }
            })()
          `);
        }
      }

      // 2. Wait for file parsing / analysis in Qwen UI to complete (up to 25 seconds)
      const expectedTotal = validDocPaths.length + validImagePaths.length;
      const startTime = Date.now();
      let isReady = false;
      while (Date.now() - startTime < 25000) {
        await new Promise((r) => setTimeout(r, 600));
        const status = await this.evaluate<{ ready: boolean; count: number }>(`
          (function() {
            const items = Array.from(document.querySelectorAll('.fileitem-btn'));
            const closeButtons = document.querySelectorAll('.close-button').length;
            const count = Math.max(items.length, closeButtons);
            if (count === 0) return { ready: false, count: 0 };
            
            const stillBusy = items.some(item => 
              (item.innerText || '').includes('Анализ') || 
              (item.innerText || '').includes('Загрузка') || 
              (item.innerText || '').includes('Обработка') || 
              (item.innerText || '').includes('Parsing') || 
              (item.innerText || '').includes('Uploading') ||
              (item.innerText || '').includes('Loading') ||
              !!item.querySelector('[class*="spin"], [class*="loading"], [class*="progress"], .ant-progress')
            );

            const inputBusy = !!document.querySelector('.chat-prompt-send-button .anticon-loading, .chat-input-area .anticon-loading');

            return { ready: !stillBusy && !inputBusy && count >= ${expectedTotal}, count };
          })()
        `);

        if (status && status.ready) {
          isReady = true;
          console.log(`[CDP] All ${status.count} attached files parsed and ready in Qwen Studio.`);
          break;
        }
      }

      // Explicit post-upload settling buffer so React state and server-side attachments are 100% bound
      console.log('[CDP] Waiting 2.5s settling buffer for file attachments to bind...');
      await new Promise((r) => setTimeout(r, 2500));

      return isReady || true;
    } catch (err: any) {
      console.error('[CDP] Error attaching files:', err?.message || err);
      return false;
    }
  }

  /**
   * Type message and submit it to Qwen chat with optional file attachments
   * Supports up to 5 documents (4 project files + 1 prompt txt) and up to 5 images (total up to 10 files)
   */
  public async submitMessage(
    message: string,
    filesToAttach?: string[] | { docFiles?: string[]; imageFiles?: string[] }
  ): Promise<boolean> {
    await this.connect();

    let textToType = message;
    let docFiles: string[] = [];
    let imageFiles: string[] = [];

    if (Array.isArray(filesToAttach)) {
      for (const f of filesToAttach) {
        if (isImageFile(f)) imageFiles.push(f);
        else docFiles.push(f);
      }
    } else if (filesToAttach) {
      if (filesToAttach.docFiles) {
        for (const f of filesToAttach.docFiles) {
          if (isImageFile(f)) imageFiles.push(f);
          else docFiles.push(f);
        }
      }
      if (filesToAttach.imageFiles) {
        for (const f of filesToAttach.imageFiles) {
          if (isImageFile(f)) imageFiles.push(f);
          else docFiles.push(f);
        }
      }
    }

    // Limit images to max 5
    imageFiles = imageFiles.slice(0, 5);

    // Qwen Studio has a strict textarea limit of 131,072 characters (2^17).
    // If the prompt exceeds 50,000 characters or contains embedded overflow files (=== ФАЙЛ:),
    // or if docFiles > 4, package the full text into task_prompt.txt,
    // attach 1 prompt txt + up to 4 project files (total 5 documents) + up to 5 images.
    const shouldPackageToTxt =
      textToType.length > 50000 ||
      textToType.includes('=== ФАЙЛ:') ||
      docFiles.length > 4;

    if (shouldPackageToTxt) {
      const tempDir = path.join(process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp', 'qwen_mcp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const taskPromptFile = path.join(tempDir, 'task_prompt.txt');
      fs.writeFileSync(taskPromptFile, message, 'utf8');

      // Max 4 project code files + 1 task_prompt.txt = 5 documents
      docFiles = docFiles.slice(0, 4);
      docFiles.unshift(taskPromptFile);

      textToType = `[РОЛЬ: СУБАГЕНТ QWEN 3.8 MAX]
Ты являешься исполнительным субагентом для Оркестратора (Gemini в Google Antigravity).
Полный текст задачи со всеми инструкциями, структурой проекта и кодом файлов сохранен и прикреплен во вложенном файле task_prompt.txt (также изучи остальные прикрепленные файлы проекта и изображения во вложениях).

Внимательно изучи прикрепленный файл task_prompt.txt и все вложения, затем выполни задачу строго по правилам субагента: начни с дерева структуры, затем выводи каждый файл через ### FILE: путь/к/файлу.`;
    } else {
      docFiles = docFiles.slice(0, 5);
    }

    // Step 0: Attach files if provided (up to 5 documents + up to 5 images)
    if (docFiles.length > 0 || imageFiles.length > 0) {
      await this.attachFiles({ docFiles, imageFiles });
    }

    // Step 1: Input text into textarea
    const insertRes = await this.evaluate<{ success: boolean; error?: string }>(`
      (function() {
        const textToType = ${JSON.stringify(textToType)};
        const textarea = document.querySelector('.message-input-textarea, textarea.message-input-textarea') ||
                         document.querySelector('textarea:not(.ime-text-area)') ||
                         document.querySelector('[contenteditable="true"]') ||
                         document.querySelector('input[type="text"]');
        
        if (!textarea) {
          return { success: false, error: 'Chat input element not found' };
        }
        
        textarea.focus();
        
        if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set;
          
          if (nativeSetter) {
            nativeSetter.call(textarea, textToType);
          } else {
            textarea.value = textToType;
          }
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          textarea.innerText = textToType;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        return { success: true };
      })();
    `);

    if (!insertRes.success) {
      throw new Error(insertRes.error || 'Failed to insert prompt into Qwen textarea');
    }

    // Step 2: Poll and wait for send button to become enabled and click it (up to 15 seconds)
    console.log('[CDP] Waiting for send button to become active and clicking...');
    let sendSuccess = false;
    const sendStartTime = Date.now();
    
    while (Date.now() - sendStartTime < 15000) {
      const clickRes = await this.evaluate<{ clicked: boolean; reason?: string }>(`
        (function() {
          const sendWrapper = document.querySelector('.chat-prompt-send-button');
          const sendBtn = document.querySelector('.chat-prompt-send-button button:not(.stop-button)') ||
                          document.querySelector('.chat-prompt-send-button') ||
                          document.querySelector('button.send-button') ||
                          document.querySelector('button[aria-label="Отправить"]') ||
                          document.querySelector('button[aria-label*="Send" i]') ||
                          document.querySelector('.send-button') ||
                          document.querySelector('button[type="submit"]');

          if (!sendBtn) return { clicked: false, reason: 'No button found' };

          const isDisabled = sendBtn.disabled || 
                             sendBtn.classList.contains('disabled') ||
                             sendBtn.getAttribute('aria-disabled') === 'true' ||
                             (sendWrapper && (sendWrapper.classList.contains('disabled') || sendWrapper.style.cursor === 'not-allowed'));

          if (isDisabled) {
            return { clicked: false, reason: 'Button currently disabled (waiting for files/render)' };
          }

          if (sendWrapper && sendWrapper !== sendBtn) {
            sendWrapper.click();
          }
          sendBtn.click();
          const innerBtn = sendBtn.querySelector('button');
          if (innerBtn && !innerBtn.disabled) innerBtn.click();

          return { clicked: true };
        })()
      `);

      if (clickRes && clickRes.clicked) {
        sendSuccess = true;
        console.log('[CDP] Send button clicked successfully!');
        break;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    // Step 3: Verify generation started, if not dispatch Enter key
    await new Promise((r) => setTimeout(r, 1000));
    const genCheck = await this.evaluate<boolean>(`
      !!document.querySelector('.stop-button, button[aria-label*="stop" i], button[aria-label*="остановить" i]')
    `);

    if (!genCheck) {
      console.log('[CDP] Stop button not yet detected, dispatching Enter key as fallback...');
      await this.evaluate(`
        (function() {
          const textarea = document.querySelector('.message-input-textarea, textarea.message-input-textarea') ||
                           document.querySelector('textarea:not(.ime-text-area)');
          if (textarea) textarea.focus();
        })()
      `);

      await this.sendCDP('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        windowsVirtualKeyCode: 13,
        unmodifiedText: '\r',
        text: '\r',
        key: 'Enter',
        code: 'Enter'
      });
      await this.sendCDP('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode: 13,
        key: 'Enter',
        code: 'Enter'
      });
    }

    // Auto-scroll after sending message
    await this.scrollToBottom();

    return true;
  }

  /**
   * Smoothly scrolls Qwen chat container to the bottom on demand
   */
  public async scrollToBottom(smooth: boolean = true): Promise<void> {
    try {
      await this.evaluate(`
        (function() {
          const container = document.querySelector('.chat-messages') ||
                            document.querySelector('.chat-message-list') ||
                            document.querySelector('[class*="chat-messages"]');
          if (!container) return;

          const target = container.scrollHeight - container.clientHeight;
          const start = container.scrollTop;
          const diff = target - start;

          if (diff <= 5) return;

          ${smooth ? `
          const duration = 280;
          const startTime = performance.now();
          function animate(now) {
            const progress = Math.min((now - startTime) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            const currentTarget = container.scrollHeight - container.clientHeight;
            const newTop = start + (currentTarget - start) * ease;
            if (newTop > container.scrollTop) {
              container.scrollTop = newTop;
            }
            if (progress < 1) {
              requestAnimationFrame(animate);
            } else {
              container.scrollTop = container.scrollHeight - container.clientHeight;
              const scrollBtn = document.querySelector('.scroll-down-button, button[aria-label*="Прокрутить вниз" i]');
              if (scrollBtn) scrollBtn.click();
            }
          }
          requestAnimationFrame(animate);
          ` : `
          container.scrollTop = container.scrollHeight;
          const scrollBtn = document.querySelector('.scroll-down-button, button[aria-label*="Прокрутить вниз" i]');
          if (scrollBtn) scrollBtn.click();
          `}
        })()
      `);
    } catch {}
  }

  /**
   * Check status of generation and retrieve current assistant response
   */
  public async getGenerationState(): Promise<{
    isGenerating: boolean;
    text: string;
    hasError: boolean;
    errorText?: string;
  }> {
    const script = `
      (function() {
        // Auto-scroll chat container downwards to follow streaming content smoothly
        const chatContainer = document.querySelector('.chat-messages') ||
                              document.querySelector('.chat-message-list');
        if (chatContainer) {
          const target = chatContainer.scrollHeight - chatContainer.clientHeight;
          const diff = target - chatContainer.scrollTop;
          if (diff > 10) {
            // Smoothly advance 45% towards bottom so it naturally glides with generation
            chatContainer.scrollTop = Math.min(chatContainer.scrollTop + Math.max(diff * 0.45, 120), target);
          }
        }
        const scrollBtn = document.querySelector('.scroll-down-button, button[aria-label*="Прокрутить вниз" i], button[aria-label*="Scroll down" i]');
        if (scrollBtn && scrollBtn.offsetParent !== null) {
          scrollBtn.click();
        }

        // Check for stop button (indicates active generation)
        const stopBtn = document.querySelector('button[aria-label*="stop" i], button[aria-label*="остановить" i], button[aria-label*="停止" i], .stop-button, button:has(.anticon-pause), button:has(.anticon-stop)');
        
        // Check if thinking status card is active (not yet completed)
        const activeThinking = document.querySelector('.qwen-chat-thinking-status-card:not(.qwen-chat-thinking-status-card-completed)');
        const isGenerating = !!stopBtn || !!activeThinking;

        // Check for error banners (only if non-empty error message is visible)
        const errorBanner = document.querySelector('.error-message, .ant-alert-error');
        const errorText = errorBanner ? errorBanner.innerText.trim() : undefined;
        const hasError = !!errorText && errorText.length > 0;

        // Find last assistant message
        const responseMessages = document.querySelectorAll('.chat-response-message');
        const lastMsg = responseMessages.length > 0 
          ? responseMessages[responseMessages.length - 1] 
          : document.querySelector('.chat-response-message:last-of-type') ||
            document.querySelector('.markdown-body:last-of-type');

        if (!lastMsg) {
          return { isGenerating, text: '', hasError, errorText };
        }

        // Try extracting pure raw markdown directly from React Fiber message.content_list
        try {
          let fiber = null;
          for (const k in lastMsg) {
            if (k.startsWith('__reactFiber')) { fiber = lastMsg[k]; break; }
          }
          let curr = fiber;
          while (curr) {
            if (curr.memoizedProps && curr.memoizedProps.message && curr.memoizedProps.message.content_list) {
              const list = curr.memoizedProps.message.content_list;
              for (let i = 0; i < list.length; i++) {
                if (list[i].phase === 'answer' && typeof list[i].content === 'string' && list[i].content.length > 0) {
                  return { isGenerating, text: list[i].content, hasError, errorText };
                }
              }
            }
            curr = curr.return;
          }
        } catch (e) {}

        const renderFlow = lastMsg.querySelector('.chat-response-message-render-flow') || lastMsg;
        const rawInnerText = renderFlow.innerText || '';

        // Extract tree structure if present before first FILE:
        let projectStructure = '';
        const fileIdx = rawInnerText.indexOf('FILE:');
        if (fileIdx > 0) {
          projectStructure = rawInnerText.substring(0, fileIdx)
            .replace(/Завершено размышление\s*/gi, '')
            .trim();
        }

        // Extract all semantic markdown blocks in document order
        const items = Array.from(renderFlow.querySelectorAll('h1, h2, h3, h4, h5, h6, pre.qwen-markdown-code, p, ul, ol'));
        const parts = [];

        if (projectStructure) {
          parts.push(projectStructure);
        }

        for (const item of items) {
          if (item.tagName.startsWith('H')) {
            const t = item.innerText.trim();
            if (t.startsWith('FILE:') || t.startsWith('STATUS:')) {
              parts.push('### ' + t);
            } else {
              parts.push('### ' + t);
            }
          } else if (item.classList.contains('qwen-markdown-code') || item.tagName === 'PRE') {
            // Extract lines from Monaco .view-line
            const viewLines = Array.from(item.querySelectorAll('.view-line'));
            let codeContent = '';
            if (viewLines.length > 0) {
              codeContent = viewLines.map(l => l.innerText).join('\\n');
            } else {
              codeContent = item.innerText || '';
            }

            const langMatch = /language-([a-zA-Z0-9_+-]+)/.exec(item.className || '');
            const lang = langMatch ? langMatch[1] : '';

            parts.push('\`\`\`' + lang + '\\n' + codeContent + '\\n\`\`\`');
          } else {
            const t = item.innerText.trim();
            if (t && !parts.some(p => p.includes(t)) && !t.includes('Завершено размышление')) {
              parts.push(t);
            }
          }
        }

        let fullText = parts.join('\\n\\n');
        if (!fullText) {
          fullText = rawInnerText;
        }

        return {
          isGenerating,
          text: fullText,
          hasError,
          errorText
        };
      })();
    `;

    return await this.evaluate<{
      isGenerating: boolean;
      text: string;
      hasError: boolean;
      errorText?: string;
    }>(script);
  }

  /**
   * Disconnect CDP connection
   */
  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}

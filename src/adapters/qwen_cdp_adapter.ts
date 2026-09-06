import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, exec } from 'child_process';
import WebSocket from 'ws';
import { ServerConfig } from '../types';

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
   * Type message and submit it to Qwen chat
   */
  public async submitMessage(message: string): Promise<boolean> {
    await this.connect();

    // Step 1: Input text into textarea
    const insertRes = await this.evaluate<{ success: boolean; error?: string }>(`
      (function() {
        const textToType = ${JSON.stringify(message)};
        const textarea = document.querySelector('textarea') || 
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

    // Wait 350ms for React state update so send button becomes active
    await new Promise((r) => setTimeout(r, 350));

    // Step 2: Find and click the send button
    const clickRes = await this.evaluate<{ clicked: boolean }>(`
      (function() {
        const sendBtn = document.querySelector('button.send-button') ||
                        document.querySelector('button[aria-label="Отправить"]') ||
                        document.querySelector('.send-button') ||
                        document.querySelector('button[type="submit"]');

        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          return { clicked: true };
        }
        return { clicked: false };
      })();
    `);

    if (clickRes.clicked) {
      return true;
    }

    // Step 3: Fallback - focus textarea and dispatch Enter key
    await this.evaluate(`
      (function() {
        const textarea = document.querySelector('textarea');
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

    return true;
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

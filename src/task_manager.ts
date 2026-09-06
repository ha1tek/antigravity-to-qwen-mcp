import {
  QwenSubagentTask,
  TaskStatus,
  ServerConfig,
  ChatMessage,
  ParsedFile
} from './types';
import * as fs from 'fs';
import * as path from 'path';
import { parseQwenOutput } from './parser';
import { buildProjectContext, isImageFile } from './project_context';
import { QwenCDPAdapter } from './adapters/qwen_cdp_adapter';
import { QwenAPIAdapter } from './adapters/qwen_api_adapter';

export class TaskManager {
  private tasks = new Map<string, QwenSubagentTask>();
  private config: ServerConfig;
  private cdpAdapter: QwenCDPAdapter;
  private apiAdapter: QwenAPIAdapter;
  private storePath: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.cdpAdapter = new QwenCDPAdapter(config);
    this.apiAdapter = new QwenAPIAdapter(config);
    const tempDir = path.join(process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp', 'qwen_mcp');
    if (!fs.existsSync(tempDir)) {
      try { fs.mkdirSync(tempDir, { recursive: true }); } catch {}
    }
    this.storePath = path.join(tempDir, 'tasks_store.json');
    this.loadTasksFromDisk();
  }

  public loadTasksFromDisk(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const data = fs.readFileSync(this.storePath, 'utf8');
        const list = JSON.parse(data) as QwenSubagentTask[];
        for (const t of list) {
          const existing = this.tasks.get(t.id);
          if (!existing || (t.updatedAt && (!existing.updatedAt || t.updatedAt >= existing.updatedAt))) {
            this.tasks.set(t.id, t);
          }
        }
      }
    } catch (e) {
      console.error('[TaskManager] Error loading tasks from disk:', e);
    }
  }

  public saveTasksToDisk(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        try {
          const data = fs.readFileSync(this.storePath, 'utf8');
          const diskList = JSON.parse(data) as QwenSubagentTask[];
          for (const dt of diskList) {
            if (!this.tasks.has(dt.id)) {
              this.tasks.set(dt.id, dt);
            }
          }
        } catch {}
      }
      const list = Array.from(this.tasks.values());
      fs.writeFileSync(this.storePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
      console.error('[TaskManager] Error saving tasks to disk:', e);
    }
  }

  public updateConfig(newConfig: Partial<ServerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.cdpAdapter = new QwenCDPAdapter(this.config);
    this.apiAdapter = new QwenAPIAdapter(this.config);
  }

  public getConfig(): ServerConfig {
    return { ...this.config };
  }

  /**
   * Build the strict Subagent System Prompt for Qwen
   */
  public buildSubagentPrompt(params: {
    userPrompt: string;
    skillsContent?: string;
    workspaceContext?: string;
    projectStructure?: string;
    attachedFilesList?: string[];
    embeddedFilesPrompt?: string;
    customSystemPrompt?: string;
    isTargeted?: boolean;
  }): { systemPrompt: string; fullUserMessage: string } {
    const systemPrompt = `[РОЛЬ: СУБАГЕНТ QWEN 3.8 MAX]
Ты являешься исполнительным субагентом для Оркестратора (Gemini в Google Antigravity).
Оркестратор передает тебе оригинальную задачу пользователя без изменений.
Твоя цель — полностью и качественно реализовать задачу и вывести файлы проекта по строгим правилам.

ПРАВИЛА СТРУКТУРИРОВАНИЯ И ВЫВОДА:
1. Сначала выведи полную структуру файлов проекта в виде дерева каталогов.
2. Затем выведи содержимое каждого файла по очереди.
3. Формат каждого файла ОБЯЗАТЕЛЕН:
### FILE: путь/к/файлу
\`\`\`[язык]
[полный рабочий код файла без сокращений]
\`\`\`

ПРАВИЛА ОБЪЕМА И ПРОДОЛЖЕНИЯ (CHUNK GENERATION):
- Если файлов несколько и они небольшие (скрипты, конфиги, компоненты) — выведи их все в одном ответе.
- Если файл большой (>1000 строк кода или приближается к лимиту токенов ответа) — выведи этот файл целиком и закончи ответ строкой:
### STATUS: NEED_CONTINUATION
Укажи список файлов, которые осталось вывести, и жди команду "Продолжить" от Оркестратора.
- Когда ВСЕ файлы проекта выведены полностью, закончи ответ строкой:
### STATUS: ALL_FILES_COMPLETED

СТРОГО ЗАПРЕЩЕНО:
- Писать вступительные объяснения или пространные рассуждения до дерева структуры проекта.
- Сокращать код (например, "// остальной код здесь", "TODO: implement").
- Менять исходную бизнес-логику или требования оригинальной задачи.
${params.customSystemPrompt ? `\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${params.customSystemPrompt}` : ''}
`;

    let fullUserMessage = `[ОРИГИНАЛЬНЫЙ ЗАПРОС ПОЛЬЗОВАТЕЛЯ]:\n${params.userPrompt}\n`;

    if (params.skillsContent && params.skillsContent.trim()) {
      fullUserMessage += `\n[ПОЛНОЕ СОДЕРЖИМОЕ СКИЛЛОВ ДЛЯ ВЫПОЛНЕНИЯ ЗАДАЧИ]:\n${params.skillsContent.trim()}\n`;
    }

    if (params.workspaceContext && params.workspaceContext.trim()) {
      fullUserMessage += `\n[ТЕКУЩИЙ КОНТЕКСТ ПРОЕКТА / РАБОЧАЯ ОБЛАСТЬ]:\n${params.workspaceContext.trim()}\n`;
    }

    if (params.projectStructure && params.projectStructure.trim()) {
      fullUserMessage += `\n[СТРУКТУРА СУЩЕСТВУЮЩЕГО ПРОЕКТА]:\n${params.projectStructure.trim()}\n`;
    }

    if (params.attachedFilesList && params.attachedFilesList.length > 0) {
      const docFiles = params.attachedFilesList.filter((f) => !isImageFile(f));
      const imgFiles = params.attachedFilesList.filter((f) => isImageFile(f));

      fullUserMessage += `\n[ПРИКРЕПЛЕННЫЕ ВЛОЖЕНИЯ К СООБЩЕНИЮ (всего до 10 файлов: до 5 документов и до 5 изображений)]:\n`;
      if (docFiles.length > 0) {
        fullUserMessage += `[Документы и код проекта (${docFiles.length})]:\n` + docFiles.map((f) => `  - ${f}`).join('\n') + '\n';
      }
      if (imgFiles.length > 0) {
        fullUserMessage += `[Изображения, референсы и скриншоты (${imgFiles.length})]:\n` + imgFiles.map((f) => `  - ${f}`).join('\n') + '\n';
      }
      fullUserMessage += `(Изучи прикрепленные файлы и изображения во вложениях перед написанием кода).\n`;
    }

    if (params.embeddedFilesPrompt && params.embeddedFilesPrompt.trim()) {
      fullUserMessage += `\n${params.embeddedFilesPrompt.trim()}\n`;
    }

    if (params.isTargeted) {
      fullUserMessage += `\n[РЕЖИМ: ТОЧЕЧНАЯ ПРАВКА]:\nТребуется точечная доработка/исправление. Вноси изменения строго в целевой файл (или целевые файлы) без переписывания всего остального проекта.\n`;
    }

    fullUserMessage += `\nВыполняй задачу строго по правилам субагента: начни с дерева структуры, затем выводи каждый файл через ### FILE: путь/к/файлу.`;

    return { systemPrompt, fullUserMessage };
  }

  /**
   * Submit a new task to Qwen subagent
   */
  public async submitTask(params: {
    userPrompt: string;
    skillsContent?: string;
    workspaceContext?: string;
    projectDir?: string;
    targetFiles?: string[];
    images?: string[];
    attachedFiles?: string[];
    customSystemPrompt?: string;
  }): Promise<QwenSubagentTask> {
    const taskId = `qwen_task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    let docFilesToAttach: string[] = [];
    let imageFilesToAttach: string[] = [];
    let projectStructure = '';
    let embeddedFilesPrompt = '';
    let isTargeted = false;
    let effectiveProjectDir = params.projectDir;

    // Collect explicitly provided images and detect any image file paths in userPrompt
    const explicitImages: string[] = params.images ? [...params.images] : [];
    const promptImageMatches = params.userPrompt.match(/[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+\.(?:png|jpg|jpeg|webp|gif|svg|bmp|ico)/gi);
    if (promptImageMatches) {
      for (const imgPath of promptImageMatches) {
        if (fs.existsSync(imgPath) && !explicitImages.includes(imgPath)) {
          explicitImages.push(imgPath);
        }
      }
    }

    // Process any attachedFiles into docs or images
    if (params.attachedFiles) {
      for (const f of params.attachedFiles) {
        if (isImageFile(f)) {
          if (!explicitImages.includes(f)) explicitImages.push(f);
        } else {
          docFilesToAttach.push(f);
        }
      }
    }

    // Automatic fallback: if Gemini did not pass project_dir, auto-detect from context or process.cwd()
    if (!effectiveProjectDir) {
      const combinedText = `${params.workspaceContext || ''}\n${params.userPrompt || ''}`;
      const pathMatches = combinedText.match(/[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+/g);
      if (pathMatches) {
        for (const cand of pathMatches) {
          try {
            const cleanCand = cand.trim().replace(/[.,;:)\]'"]+$/, '');
            if (fs.existsSync(cleanCand) && fs.statSync(cleanCand).isDirectory()) {
              effectiveProjectDir = cleanCand;
              console.error(`[TaskManager] Auto-detected projectDir from context: ${effectiveProjectDir}`);
              break;
            }
          } catch {}
        }
      }

      if (!effectiveProjectDir) {
        try {
          const cwd = process.cwd();
          if (fs.existsSync(cwd) && !cwd.toLowerCase().endsWith('qwen_mcp')) {
            const entries = fs.readdirSync(cwd);
            const hasProjectMarkers = entries.some(
              (e: string) => e === 'package.json' || e === 'src' || e === 'requirements.txt' || e === 'go.mod'
            );
            if (hasProjectMarkers) {
              effectiveProjectDir = cwd;
              console.error(`[TaskManager] Auto-detected projectDir from cwd: ${effectiveProjectDir}`);
            }
          }
        } catch {}
      }
    }

    if (effectiveProjectDir) {
      const ctx = buildProjectContext({
        projectDir: effectiveProjectDir,
        targetFiles: params.targetFiles,
        imageFiles: explicitImages,
        maxDocAttachments: 4, // 4 project files + 1 task_prompt.txt = 5 documents
        maxImageAttachments: 5 // up to 5 photos/screenshots/images
      });
      isTargeted = ctx.isTargeted;
      projectStructure = ctx.directoryTree;
      docFilesToAttach = Array.from(new Set([...docFilesToAttach, ...ctx.docFilesToAttach]));
      imageFilesToAttach = Array.from(new Set([...imageFilesToAttach, ...ctx.imageFilesToAttach]));
      embeddedFilesPrompt = ctx.embeddedFilesPrompt;
    } else if (params.targetFiles && params.targetFiles.length > 0) {
      for (const t of params.targetFiles) {
        if (isImageFile(t)) imageFilesToAttach.push(t);
        else docFilesToAttach.push(t);
      }
      imageFilesToAttach.push(...explicitImages);
      isTargeted = true;
    } else {
      imageFilesToAttach.push(...explicitImages);
    }

    // Enforce limits: max 4 project docs (reserves 1 slot for task_prompt.txt) and max 5 images
    docFilesToAttach = docFilesToAttach.slice(0, 4);
    imageFilesToAttach = imageFilesToAttach.slice(0, 5);
    const filesToAttach = [...docFilesToAttach, ...imageFilesToAttach];

    const { systemPrompt, fullUserMessage } = this.buildSubagentPrompt({
      userPrompt: params.userPrompt,
      skillsContent: params.skillsContent,
      workspaceContext: params.workspaceContext,
      projectStructure,
      attachedFilesList: filesToAttach,
      embeddedFilesPrompt,
      customSystemPrompt: params.customSystemPrompt,
      isTargeted
    });

    const task: QwenSubagentTask = {
      id: taskId,
      userPrompt: params.userPrompt,
      skillsContent: params.skillsContent,
      workspaceContext: params.workspaceContext,
      projectDir: params.projectDir,
      targetFiles: params.targetFiles,
      images: params.images,
      attachedFiles: params.attachedFiles,
      filesToAttach: filesToAttach.length > 0 ? filesToAttach : undefined,
      docFilesToAttach: docFilesToAttach.length > 0 ? docFilesToAttach : undefined,
      imageFilesToAttach: imageFilesToAttach.length > 0 ? imageFilesToAttach : undefined,
      isTargeted,
      customSystemPrompt: params.customSystemPrompt,
      status: 'RUNNING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullUserMessage }
      ],
      currentResponse: '',
      projectStructure: projectStructure || '',
      parsedFiles: []
    };

    this.tasks.set(taskId, task);
    this.saveTasksToDisk();

    // Launch execution in background without blocking tool return
    this.runTaskAsync(taskId).catch((err) => {
      task.status = 'ERROR';
      task.error = err?.message || String(err);
      task.updatedAt = Date.now();
      this.saveTasksToDisk();
    });

    return task;
  }

  /**
   * Background task runner
   */
  private async runTaskAsync(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Check available adapter
    const cdpAvailable = await this.cdpAdapter.isAvailable();
    const apiAvailable = this.apiAdapter.isAvailable();

    if (this.config.mode === 'api') {
      await this.runViaAPI(task);
    } else {
      // Auto or CDP mode: ensure Qwen Desktop is running with debugging port
      try {
        await this.cdpAdapter.ensureReady();
        await this.runViaCDP(task);
      } catch (cdpErr: any) {
        if (this.apiAdapter.isAvailable()) {
          console.error('[TaskManager] CDP autolaunch failed, falling back to API:', cdpErr.message);
          await this.runViaAPI(task);
        } else {
          throw new Error(
            `Не удалось подключиться к Qwen Studio: ${cdpErr.message}. ` +
            `Убедитесь, что приложение Qwen установлено на данном ПК (C:\\Program Files\\Qwen\\Qwen.exe), ` +
            `либо укажите API-ключ в config.json.`
          );
        }
      }
    }
  }

  /**
   * Run task via Chrome DevTools Protocol to Qwen Desktop
   */
  private async runViaCDP(task: QwenSubagentTask): Promise<void> {
    const lastUserMessage = task.history[task.history.length - 1].content;
    const systemPrompt = task.history.find((h) => h.role === 'system')?.content || '';

    // If first message in chat, include system directive directly in message
    const messageToSend =
      task.history.length <= 2
        ? `${systemPrompt}\n\n${lastUserMessage}`
        : lastUserMessage;

    const filesToUpload = {
      docFiles: task.docFilesToAttach,
      imageFiles: task.imageFilesToAttach
    };
    await this.cdpAdapter.submitMessage(messageToSend, filesToUpload);

    // Clear filesToAttach after sending initial message so continuations don't re-upload
    task.filesToAttach = undefined;
    task.docFilesToAttach = undefined;
    task.imageFilesToAttach = undefined;

    // Polling loop to wait for generation to complete
    const startTime = Date.now();
    const timeoutMs = (this.config.timeoutSeconds || 300) * 1000;
    let lastText = '';
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));

      const state = await this.cdpAdapter.getGenerationState();
      task.updatedAt = Date.now();

      if (state.hasError && state.errorText) {
        task.status = 'ERROR';
        task.error = state.errorText;
        this.saveTasksToDisk();
        return;
      }

      if (state.text) {
        task.currentResponse = state.text;
        this.saveTasksToDisk();
      }

      if (!state.isGenerating && state.text.length > 0) {
        // If text stopped growing for 2 checks, consider done
        if (state.text === lastText) {
          stableCount++;
          if (stableCount >= 2) {
            break;
          }
        } else {
          stableCount = 0;
          lastText = state.text;
        }
      }
    }

    if (Date.now() - startTime >= timeoutMs) {
      task.status = 'ERROR';
      task.error = `Generation timed out after ${this.config.timeoutSeconds} seconds.`;
      this.saveTasksToDisk();
      return;
    }

    // Process output
    this.finalizeTaskResponse(task, task.currentResponse);
  }

  /**
   * Run task via direct API
   */
  private async runViaAPI(task: QwenSubagentTask): Promise<void> {
    const fullText = await this.apiAdapter.completeChat(task.history, (_, updated) => {
      task.currentResponse = updated;
      task.updatedAt = Date.now();
      this.saveTasksToDisk();
    });

    this.finalizeTaskResponse(task, fullText);
  }

  /**
   * Finalize task response with parser
   */
  private finalizeTaskResponse(task: QwenSubagentTask, fullResponse: string): void {
    task.currentResponse = fullResponse;
    task.updatedAt = Date.now();
    task.history.push({ role: 'assistant', content: fullResponse });

    const parsed = parseQwenOutput(fullResponse);
    task.projectStructure = parsed.projectStructure;
    task.parsedFiles = parsed.files;
    task.completionStatus = parsed.completionStatus;
    task.continuationNotes = parsed.continuationNotes;

    if (parsed.completionStatus === 'NEED_CONTINUATION') {
      task.status = 'NEED_CONTINUATION';
    } else {
      task.status = 'COMPLETED';
    }
    this.saveTasksToDisk();
  }

  /**
   * Continue task with instruction
   */
  public async continueTask(taskId: string, instruction: string): Promise<QwenSubagentTask> {
    this.loadTasksFromDisk();
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    const continuationPrompt = `[КОМАНДА ОРКЕСТРАТОРА - ПРОДОЛЖЕНИЕ]:\n${instruction}\nПродолжай вывод оставшихся файлов строго в формате ### FILE: путь/к/файлу.`;
    task.history.push({ role: 'user', content: continuationPrompt });
    task.status = 'RUNNING';
    task.updatedAt = Date.now();
    this.saveTasksToDisk();

    this.runTaskAsync(taskId).catch((err) => {
      task.status = 'ERROR';
      task.error = err?.message || String(err);
      task.updatedAt = Date.now();
      this.saveTasksToDisk();
    });

    return task;
  }

  /**
   * Verify assembled project with Qwen
   */
  public async verifyTask(params: {
    taskId: string;
    assembledStructure: string;
    verificationStatus: 'SUCCESS' | 'ERRORS_FOUND';
    errorLog?: string;
    troubledFiles?: { path: string; content: string }[];
  }): Promise<QwenSubagentTask> {
    this.loadTasksFromDisk();
    const task = this.tasks.get(params.taskId);
    if (!task) {
      throw new Error(`Task ${params.taskId} not found.`);
    }

    let verificationMessage = `[ЭТАП ВЕРИФИКАЦИИ ПРОЕКТА ОРКЕСТРАТОРОМ (Шаг 6)]\n`;
    verificationMessage += `Оркестратор собрал проект на диске. Вот структура собранных файлов:\n${params.assembledStructure}\n\n`;

    if (params.verificationStatus === 'SUCCESS') {
      verificationMessage += `СТАТУС: Все файлы собраны без синтаксических ошибок.\n`;
      verificationMessage += `Вопрос субагенту Qwen: Всё ли реализовано корректно и полностью в соответствии с оригинальной задачей? Ответь "ПРОЕКТ_СОБРАН_ВЕРНО", если всё правильно, или укажи, что требуется исправить.`;
    } else {
      verificationMessage += `СТАТУС: ОБНАРУЖЕНЫ ОШИБКИ ПРИ СБОРКЕ / ТЕСТИРОВАНИИ:\n${params.errorLog || 'Неизвестная ошибка'}\n\n`;
      if (params.troubledFiles && params.troubledFiles.length > 0) {
        verificationMessage += `СОДЕРЖИМОЕ ПРОБЛЕМНЫХ ФАЙЛОВ:\n`;
        for (const file of params.troubledFiles) {
          verificationMessage += `### FILE: ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
        }
      }
      verificationMessage += `Исправь выявленные ошибки и предоставь скорректированные файлы в стандартном формате ### FILE: путь/к/файлу.`;
    }

    task.history.push({ role: 'user', content: verificationMessage });
    task.status = 'RUNNING';
    task.updatedAt = Date.now();
    this.saveTasksToDisk();

    this.runTaskAsync(params.taskId).catch((err) => {
      task.status = 'ERROR';
      task.error = err?.message || String(err);
      task.updatedAt = Date.now();
      this.saveTasksToDisk();
    });

    return task;
  }

  /**
   * Get current task status (async, reloads from disk and actively probes CDP if RUNNING)
   */
  public async getTask(taskId: string): Promise<QwenSubagentTask | undefined> {
    this.loadTasksFromDisk();
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    // If task is RUNNING in CDP mode, actively query CDP generation state
    if (task.status === 'RUNNING' && this.config.mode !== 'api') {
      try {
        const cdpAvail = await this.cdpAdapter.isAvailable();
        if (cdpAvail) {
          const state = await this.cdpAdapter.getGenerationState();
          task.updatedAt = Date.now();

          if (state.hasError && state.errorText) {
            task.status = 'ERROR';
            task.error = state.errorText;
            this.saveTasksToDisk();
          } else if (state.text) {
            task.currentResponse = state.text;
            if (!state.isGenerating && state.text.length > 0) {
              // Generation completed in Qwen Desktop while server was offline or idle
              this.finalizeTaskResponse(task, state.text);
            } else {
              // Still generating, update latest progress to disk
              this.saveTasksToDisk();
            }
          }
        }
      } catch (err: any) {
        console.error(`[TaskManager] Error probing CDP state for task ${taskId}:`, err?.message || err);
      }
    }

    return task;
  }

  /**
   * Synchronous getTask fallback (reloads from disk without probing CDP)
   */
  public getTaskSync(taskId: string): QwenSubagentTask | undefined {
    this.loadTasksFromDisk();
    return this.tasks.get(taskId);
  }

  /**
   * Check and synchronize task status
   */
  public async checkTaskStatus(taskId: string): Promise<QwenSubagentTask | undefined> {
    return this.getTask(taskId);
  }

  /**
   * List all tasks (reloads from disk)
   */
  public listTasks(): QwenSubagentTask[] {
    this.loadTasksFromDisk();
    return Array.from(this.tasks.values());
  }
}

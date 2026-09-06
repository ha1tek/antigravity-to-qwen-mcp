import {
  QwenSubagentTask,
  TaskStatus,
  ServerConfig,
  ChatMessage,
  ParsedFile
} from './types';
import { parseQwenOutput } from './parser';
import { QwenCDPAdapter } from './adapters/qwen_cdp_adapter';
import { QwenAPIAdapter } from './adapters/qwen_api_adapter';

export class TaskManager {
  private tasks = new Map<string, QwenSubagentTask>();
  private config: ServerConfig;
  private cdpAdapter: QwenCDPAdapter;
  private apiAdapter: QwenAPIAdapter;

  constructor(config: ServerConfig) {
    this.config = config;
    this.cdpAdapter = new QwenCDPAdapter(config);
    this.apiAdapter = new QwenAPIAdapter(config);
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
  public buildSubagentPrompt(
    userPrompt: string,
    skillsContent?: string,
    workspaceContext?: string,
    customSystemPrompt?: string
  ): { systemPrompt: string; fullUserMessage: string } {
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
${customSystemPrompt ? `\nДОПОЛНИТЕЛЬНЫЕ ИНСТРУКЦИИ:\n${customSystemPrompt}` : ''}
`;

    let fullUserMessage = `[ОРИГИНАЛЬНЫЙ ЗАПРОС ПОЛЬЗОВАТЕЛЯ]:\n${userPrompt}\n`;

    if (skillsContent && skillsContent.trim()) {
      fullUserMessage += `\n[ПОЛНОЕ СОДЕРЖИМОЕ СКИЛЛОВ ДЛЯ ВЫПОЛНЕНИЯ ЗАДАЧИ]:\n${skillsContent.trim()}\n`;
    }

    if (workspaceContext && workspaceContext.trim()) {
      fullUserMessage += `\n[ТЕКУЩИЙ КОНТЕКСТ ПРОЕКТА / РАБОЧАЯ ОБЛАСТЬ]:\n${workspaceContext.trim()}\n`;
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
    customSystemPrompt?: string;
  }): Promise<QwenSubagentTask> {
    const taskId = `qwen_task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const { systemPrompt, fullUserMessage } = this.buildSubagentPrompt(
      params.userPrompt,
      params.skillsContent,
      params.workspaceContext,
      params.customSystemPrompt
    );

    const task: QwenSubagentTask = {
      id: taskId,
      userPrompt: params.userPrompt,
      skillsContent: params.skillsContent,
      workspaceContext: params.workspaceContext,
      customSystemPrompt: params.customSystemPrompt,
      status: 'RUNNING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullUserMessage }
      ],
      currentResponse: '',
      projectStructure: '',
      parsedFiles: []
    };

    this.tasks.set(taskId, task);

    // Launch execution in background without blocking tool return
    this.runTaskAsync(taskId).catch((err) => {
      task.status = 'ERROR';
      task.error = err?.message || String(err);
      task.updatedAt = Date.now();
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

    await this.cdpAdapter.submitMessage(messageToSend);

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
        return;
      }

      if (state.text) {
        task.currentResponse = state.text;
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
  }

  /**
   * Continue task with instruction
   */
  public async continueTask(taskId: string, instruction: string): Promise<QwenSubagentTask> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found.`);
    }

    const continuationPrompt = `[КОМАНДА ОРКЕСТРАТОРА - ПРОДОЛЖЕНИЕ]:\n${instruction}\nПродолжай вывод оставшихся файлов строго в формате ### FILE: путь/к/файлу.`;
    task.history.push({ role: 'user', content: continuationPrompt });
    task.status = 'RUNNING';
    task.updatedAt = Date.now();

    this.runTaskAsync(taskId).catch((err) => {
      task.status = 'ERROR';
      task.error = err?.message || String(err);
      task.updatedAt = Date.now();
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

    this.runTaskAsync(params.taskId).catch((err) => {
      task.status = 'ERROR';
      task.error = err?.message || String(err);
      task.updatedAt = Date.now();
    });

    return task;
  }

  /**
   * Get current task status
   */
  public getTask(taskId: string): QwenSubagentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * List all tasks
   */
  public listTasks(): QwenSubagentTask[] {
    return Array.from(this.tasks.values());
  }
}

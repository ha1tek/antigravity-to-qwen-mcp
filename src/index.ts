import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, saveConfig } from './config';
import { TaskManager } from './task_manager';
import { writeFilesToDisk } from './file_writer';

const config = loadConfig();
const taskManager = new TaskManager(config);

export const ORCHESTRATION_INSTRUCTIONS = `
# ПРАВИЛА ОРКЕСТРАЦИИ GEMINI ДЛЯ СУБАГЕНТА QWEN 3.8 MAX (mcp_qwen)

Когда пользователь запрашивает разработку или решение задачи с использованием Qwen (mcp_qwen), агент Gemini переходит в статус 100% ОРКЕСТРАТОРА:
1. ТЫ СТРОГО 100% ОРКЕСТРАТОР. Не пиши код самостоятельно в обход субагента Qwen.
2. ЗАПРЕЩЕНО перефразировать, дополнять или "улучшать" оригинальный запрос пользователя при передаче в mcp_qwen_submit_task.
3. Собирай полный контекст: оригинальный запрос пользователя без изменений (user_prompt), полный текст скиллов (skills_content) и контекст рабочего каталога (workspace_context).
4. Запускай задачу через mcp_qwen_submit_task.
5. Сразу после запуска ОБЯЗАТЕЛЬНО ставь таймер на 60 секунд через системный инструмент schedule:
   schedule(DurationSeconds=60, Prompt="Проверить статус субагента Qwen через mcp_qwen_check_status(task_id)").
6. При каждом срабатывании таймера вызывай mcp_qwen_check_status:
   - Если RUNNING: снова ставь таймер на 60 секунд через schedule.
   - Если NEED_CONTINUATION: запиши полученные файлы на диск и вызови mcp_qwen_continue_task.
   - Если COMPLETED: переходи к записи файлов и сборке проекта.
7. Не изменяй код субагента при переносе на диск (переноси строго 1:1, verbatim).
8. ОБЯЗАТЕЛЬНЫЙ ШАГ ВЕРИФИКАЦИИ (Шаг 6): После записи файлов и сборки проекта вызывай mcp_qwen_verify_task с деревом структуры собранных файлов и логами ошибок (если возникли). Дожидайся подтверждения правильности ("ПРОЕКТ_СОБРАН_ВЕРНО") от субагента Qwen перед завершением ответа пользователю.
`.trim();

const server = new McpServer(
  {
    name: 'mcp_qwen',
    version: '1.0.0'
  },
  {
    instructions: ORCHESTRATION_INSTRUCTIONS
  }
);

/**
 * Resource: qwen://rules
 */
server.resource(
  'orchestration-rules',
  'qwen://rules',
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: ORCHESTRATION_INSTRUCTIONS,
        mimeType: 'text/markdown'
      }
    ]
  })
);

/**
 * Tool: mcp_qwen_submit_task
 */
server.tool(
  'mcp_qwen_submit_task',
  'Делегирует задачу субагенту Qwen 3.8 Max (в Qwen Studio / API). ' +
  'ОБЯЗАТЕЛЬНОЕ ПРАВИЛО ДЛЯ GEMINI: При вызове этого инструмента ты являешься 100% ТОЛЬКО ОРКЕСТРАТОРОМ. ' +
  'СТРОГО ЗАПРЕЩЕНО искажать, "улучшать" или перефразировать запрос пользователя — передавай оригинальный текст как есть. ' +
  'Собери весь контекст (оригинальный промпт, полный текст используемых скиллов, файлы контекста). ' +
  'После вызова инструмента ОБЯЗАТЕЛЬНО установи таймер на 60 секунд через инструмент schedule, ' +
  'чтобы каждые 60 секунд опрашивать статус через mcp_qwen_check_status(task_id).',
  {
    user_prompt: z.string().describe('Оригинальный, неизмененный запрос пользователя без перефразирования'),
    skills_content: z.string().optional().describe('Полный текст содержимого скиллов (если используются для задачи)'),
    workspace_context: z.string().optional().describe('Текущий контекст рабочей области, структура существующих файлов'),
    custom_system_prompt: z.string().optional().describe('Дополнительные системные указания для субагента Qwen')
  },
  async (args) => {
    try {
      const task = await taskManager.submitTask({
        userPrompt: args.user_prompt,
        skillsContent: args.skills_content,
        workspaceContext: args.workspace_context,
        customSystemPrompt: args.custom_system_prompt
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                task_id: task.id,
                status: task.status,
                message:
                  `Задача успешно отправлена субагенту Qwen (Task ID: ${task.id}).\n` +
                  `ИНСТРУКЦИЯ ДЛЯ ОРКЕСТРАТОРА (GEMINI):\n` +
                  `1. Установи таймер на 60 секунд через вызов инструмента schedule(DurationSeconds=60, Prompt="Check Qwen status").\n` +
                  `2. При срабатывании таймера вызови mcp_qwen_check_status(task_id="${task.id}").\n` +
                  `3. Если статус RUNNING — повтори таймер на 60 секунд.\n` +
                  `4. Если статус COMPLETED или NEED_CONTINUATION — запиши полученные файлы без изменения кода и при необходимости продолжи задачу.`
              },
              null,
              2
            )
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Ошибка запуска задачи Qwen: ${err?.message || String(err)}`
          }
        ]
      };
    }
  }
);

/**
 * Tool: mcp_qwen_check_status
 */
server.tool(
  'mcp_qwen_check_status',
  'Проверяет статус выполнения задачи субагентом Qwen. ' +
  'Возвращает статус (RUNNING, COMPLETED, NEED_CONTINUATION, ERROR), массив распарсенных файлов (parsed_files) и структуру проекта.',
  {
    task_id: z.string().describe('Идентификатор задачи, полученный из mcp_qwen_submit_task')
  },
  async (args) => {
    const task = taskManager.getTask(args.task_id);
    if (!task) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Задача с ID "${args.task_id}" не найдена.`
          }
        ]
      };
    }

    const elapsedSeconds = Math.floor((Date.now() - task.createdAt) / 1000);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              task_id: task.id,
              status: task.status,
              elapsed_seconds: elapsedSeconds,
              completion_status: task.completionStatus || 'UNKNOWN',
              project_structure: task.projectStructure,
              raw_response: task.currentResponse,
              parsed_files_count: task.parsedFiles.length,
              parsed_files: task.parsedFiles,
              continuation_notes: task.continuationNotes,
              error: task.error,
              next_action_instructions:
                task.status === 'RUNNING'
                  ? 'Генерация еще выполняется. Поставь таймер на 60 секунд через schedule и проверь снова.'
                  : task.status === 'NEED_CONTINUATION'
                  ? 'Субагент завершил часть файлов и ждет продолжения. Запиши готовые файлы на диск без изменений и вызови mcp_qwen_continue_task.'
                  : task.status === 'COMPLETED'
                  ? 'Субагент завершил вывод всех файлов проекта. Собери проект, проверь на ошибки и перейди к Шагу 6 (mcp_qwen_verify_task).'
                  : `Ошибка: ${task.error}. Повтори запрос или устрани проблему.`
            },
            null,
            2
          )
        }
      ]
    };
  }
);

/**
 * Tool: mcp_qwen_continue_task
 */
server.tool(
  'mcp_qwen_continue_task',
  'Отправляет команду на продолжение генерации следующих файлов субагентом Qwen в рамках текущей сессии задачи.',
  {
    task_id: z.string().describe('Идентификатор задачи'),
    instruction: z.string().describe('Инструкция продолжения (например: "Файлы A, B сохранены. Продолжай вывод следующих файлов начиная с C")')
  },
  async (args) => {
    try {
      const task = await taskManager.continueTask(args.task_id, args.instruction);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                task_id: task.id,
                status: task.status,
                message: `Команда продолжения отправлена Qwen. Установи таймер на 60 секунд через schedule.`
              },
              null,
              2
            )
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Ошибка продолжения задачи: ${err?.message || String(err)}`
          }
        ]
      };
    }
  }
);

/**
 * Tool: mcp_qwen_verify_task
 */
server.tool(
  'mcp_qwen_verify_task',
  'ШАГ 6 ВЕРИФИКАЦИИ: Отправляет структуру собранного проекта и отчет о сборке/ошибках обратно субагенту Qwen на подтверждение. ' +
  'Если проект собран с ошибками — прикрепляет логи ошибок и содержимое проблемных файлов. ' +
  'Qwen либо подтверждает правильность ("ПРОЕКТ_СОБРАН_ВЕРНО"), либо возвращает исправленные файлы.',
  {
    task_id: z.string().describe('Идентификатор задачи'),
    assembled_structure: z.string().describe('Дерево фактически собранных файлов в проекте'),
    verification_status: z.enum(['SUCCESS', 'ERRORS_FOUND']).describe('Статус проверки: SUCCESS если синтаксис/тесты в порядке, ERRORS_FOUND при ошибках'),
    error_log: z.string().optional().describe('Текст ошибки компилятора, линтера или сборщика (если есть)'),
    troubled_files: z.array(
      z.object({
        path: z.string().describe('Путь к файлу с ошибкой'),
        content: z.string().describe('Полное содержимое файла с ошибкой')
      })
    ).optional().describe('Содержимое только тех файлов, в которых обнаружены ошибки')
  },
  async (args) => {
    try {
      const task = await taskManager.verifyTask({
        taskId: args.task_id,
        assembledStructure: args.assembled_structure,
        verificationStatus: args.verification_status,
        errorLog: args.error_log,
        troubledFiles: args.troubled_files
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                task_id: task.id,
                status: task.status,
                message: 'Запрос верификации отправлен Qwen. Установи таймер на 60 секунд через schedule для ожидания вердикта субагента.'
              },
              null,
              2
            )
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Ошибка отправки верификации: ${err?.message || String(err)}`
          }
        ]
      };
    }
  }
);

/**
 * Tool: mcp_qwen_extract_and_write_files
 */
server.tool(
  'mcp_qwen_extract_and_write_files',
  'Безопасно и автоматически извлекает сгенерированные Qwen файлы и записывает их на диск в целевую директорию ' +
  'БЕЗ КАКИХ-ЛИБО ИЗМЕНЕНИЙ ИЛИ ИСКАЖЕНИЙ КОДА (100% verbatim). Создает необходимые подпапки автоматически.',
  {
    task_id: z.string().optional().describe('ID задачи (извлечет файлы из ответа задачи)'),
    raw_content: z.string().optional().describe('Или исходный текст с блоками ### FILE: ...'),
    target_directory: z.string().describe('Абсолютный путь к целевой директории проекта')
  },
  async (args) => {
    try {
      let filesToSave = [];

      if (args.task_id) {
        const task = taskManager.getTask(args.task_id);
        if (!task) {
          throw new Error(`Задача ${args.task_id} не найдена.`);
        }
        filesToSave = task.parsedFiles;
      } else if (args.raw_content) {
        const { parseQwenOutput } = await import('./parser');
        const parsed = parseQwenOutput(args.raw_content);
        filesToSave = parsed.files;
      } else {
        throw new Error('Укажите либо task_id, либо raw_content.');
      }

      if (filesToSave.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                written_files: [],
                message: 'В предоставленном ответе не найдено блоков ### FILE: ...'
              })
            }
          ]
        };
      }

      const writeResult = writeFilesToDisk(args.target_directory, filesToSave);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: writeResult.success,
                written_count: writeResult.writtenFiles.length,
                written_files: writeResult.writtenFiles.map((f) => f.path),
                errors: writeResult.errors,
                message: `Успешно сохранено ${writeResult.writtenFiles.length} файлов на диск без изменений кода.`
              },
              null,
              2
            )
          }
        ]
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Ошибка сохранения файлов: ${err?.message || String(err)}`
          }
        ]
      };
    }
  }
);

/**
 * Tool: mcp_qwen_get_config
 */
server.tool(
  'mcp_qwen_get_config',
  'Возвращает текущую конфигурацию подключения к Qwen (режим: cdp / api, порт отладки, статус подключения).',
  {},
  async () => {
    const currentConfig = taskManager.getConfig();
    const cdpAdapter = new (await import('./adapters/qwen_cdp_adapter')).QwenCDPAdapter(currentConfig);
    const cdpAvailable = await cdpAdapter.isAvailable();
    const apiAvailable = !!currentConfig.apiKey || !!currentConfig.apiBaseUrl;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              config: {
                mode: currentConfig.mode,
                cdpHost: currentConfig.cdpHost,
                cdpPort: currentConfig.cdpPort,
                qwenExePath: currentConfig.qwenExePath,
                apiBaseUrl: currentConfig.apiBaseUrl,
                apiKeyConfigured: !!currentConfig.apiKey,
                model: currentConfig.model,
                timeoutSeconds: currentConfig.timeoutSeconds
              },
              diagnostics: {
                cdp_port_9222_available: cdpAvailable,
                api_available: apiAvailable,
                active_adapter:
                  currentConfig.mode === 'cdp'
                    ? 'CDP (Qwen Desktop)'
                    : currentConfig.mode === 'api'
                    ? 'API Mode'
                    : cdpAvailable
                    ? 'Auto -> CDP (Qwen Desktop)'
                    : apiAvailable
                    ? 'Auto -> API Mode'
                    : 'None (Requires starting Qwen with debugging or setting API key)'
              }
            },
            null,
            2
          )
        }
      ]
    };
  }
);

/**
 * Tool: mcp_qwen_set_config
 */
server.tool(
  'mcp_qwen_set_config',
  'Обновляет параметры конфигурации MCP сервера (mode, apiKey, apiBaseUrl, model, cdpPort).',
  {
    mode: z.enum(['auto', 'cdp', 'api']).optional(),
    apiKey: z.string().optional(),
    apiBaseUrl: z.string().optional(),
    model: z.string().optional(),
    cdpPort: z.number().optional()
  },
  async (args) => {
    saveConfig(args);
    taskManager.updateConfig(args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, updatedConfig: taskManager.getConfig() }, null, 2)
        }
      ]
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[mcp_qwen] MCP Server running on stdio');
}

main().catch((err) => {
  console.error('[mcp_qwen] Fatal error starting server:', err);
  process.exit(1);
});

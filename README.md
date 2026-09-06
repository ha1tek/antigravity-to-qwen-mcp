# 🧠 Antigravity to Qwen MCP (`mcp_qwen`)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/Version-v1.1%20(Attachments%20%26%20Vision%20Engine)-blue.svg)](https://github.com/ha1tek/antigravity-to-qwen-mcp)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP%20Protocol-2024--11--05-purple.svg)](https://modelcontextprotocol.io/)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-0078D6.svg)](https://www.microsoft.com/windows)

[ 🇷🇺 [Русская версия (Russian)](README.md) | 🇬🇧 [English Version](README.en.md) ]

> **Автономный MCP-сервер для двухмодельной оркестрации разработки: Gemini в Google Antigravity (Оркестратор) + Qwen 3.8 Max (Субагент-исполнитель). «Из коробки» инструмент работает локально через десктопное приложение Qwen Studio (по протоколу Chrome DevTools / CDP), а на основе открытого исходного кода может быть легко адаптирован под любой другой AI-чат в браузере или прямой API.**
>
> **Релиз: `v1.1` (Attachments & Vision Engine: до 10 файлов — 4 файла проекта + 1 txt промпт + 5 фото/скриншотов)**

---

## 🚀 Что нового в версии v1.1 (Attachments & Vision Engine)

- 📎 **Поддержка до 10 вложений в Qwen Studio:**
  - **До 5 документов (`type: ["document"]`):** до 4 файлов проекта прикрепляются как документы + 1 файл `task_prompt.txt` (содержит полный промпт со всеми директивами, дерево структуры проекта и полный рабочий код всех остальных файлов с 5-го по N-й).
  - **До 5 изображений (`type: ["vision"]`):** автоматическое сканирование и прикрепление референсов, скриншотов, макетов (`references_photos/`, `screenshots/`, `assets/`, `mockups/`) либо передача через параметр `images: ["путь/к/фото.png"]`.
- ⚡ **Полный обход лимита 131 072 символов:** больше никаких ограничений на размер промпта в textarea — весь избыточный объем автоматически упаковывается в документ `task_prompt.txt`, а субагент с контекстным окном >1 000 000 токенов изучает весь код за один шаг.
- 🎨 **Двухканальный React Fiber загрузчик:** нативная эмуляция загрузки документов и изображений без перезагрузки страницы.
- 🎯 **Точечная правка с изображениями:** одновременная передача целевого файла (`target_files`) и дизайн-макетов (`images`).
- 🛠 **Новый инструмент `mcp_qwen_build_project_context`:** предварительное сканирование директории и построение контекста.

---

## 📑 Содержание

1. [О проекте и архитектура оркестрации](#-о-проекте-и-архитектура-оркестрации)
2. [Регламент и строгие правила работы агента](#-регламент-и-строгие-правила-работы-агента)
3. [Как устроен инструмент изнутри (CDP Automation Engine)](#-как-устроен-инструмент-изнутри-cdp-automation-engine)
4. [Доступные MCP-инструменты](#-доступные-mcp-инструменты)
5. [Установка и быстрый старт («В один клик»)](#-установка-и-быстрый-старт-в-один-клик)
6. [Инструкция по использованию (Пошаговые сценарии)](#-инструкция-по-использованию-пошаговые-сценарии)
7. [Адаптация кода под ЛЮБОЙ ДРУГОЙ ЧАТ](#-адаптация-кода-под-любой-другой-чат)
   - [Адаптация под веб-чаты в Chrome (ChatGPT, Claude, DeepSeek)](#1-адаптация-под-веб-чаты-в-браузере-google-chrome)
   - [Адаптация под Chrome DevTools Browser / Headless](#2-адаптация-под-chrome-devtools-browser--headless)
   - [Адаптация под локальные WebUI (Ollama, LM Studio)](#3-адаптация-под-локальные-webui-ollama-lm-studio)
8. [Конфигурация (`config.json`)](#-конфигурация-configjson)
9. [Структура проекта](#-структура-проекта)
10. [Тестирование](#-тестирование)
11. [Лицензия](#-лицензия)

---

## 🌟 О проекте и архитектура оркестрации

**Qwen MCP Server** реализует профессиональный паттерн двухмодельной разработки (**Orchestrator-Worker Pattern**):

- **Gemini в Google Antigravity (100% Оркестратор):** планирует архитектуру, собирает требования пользователя, исходный контекст проекта, активные скиллы и передает задачу субагенту через MCP без малейших искажений. Контролирует ход выполнения через 60-секундные таймеры, переносит сгенерированные файлы на диск строго *verbatim* (1:1) и передает проект на финальную верификацию.
- **Qwen 3.8 Max в Qwen Studio Desktop (Субагент-исполнитель):** генерирует полное дерево файлов проекта, выводит код каждого файла в блоках `### FILE: путь/к/файлу`, управляет порционной выдачей для больших файлов (>1000 строк) и проводит независимый аудит собранного проекта (Шаг 6).

```
┌─────────────────────────────────────────────────────────────┐
│                 Google Antigravity (Gemini)                 │
│                      [100% ОРКЕСТРАТОР]                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON-RPC (stdio)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    mcp_qwen (MCP Сервер)                     │
│  ┌───────────────────────────┴───────────────────────────┐  │
│  │                     TaskManager                       │  │
│  │   • Prompt Builder          • Chunking / Continuation │  │
│  │   • Parser (Tree & Files)   • Verbatim File Writer    │  │
│  └───────────────────────────┬───────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────┘
                               │ Chrome DevTools Protocol (ws://localhost:9222)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  Qwen Studio Desktop (Electron)             │
│                     [СУБАГЕНТ QWEN 3.8 MAX]                 │
│   • Интерактивное GUI-окно на рабочем столе пользователя    │
│   • Monaco Code Editor (полный вывод кода без сокращений)   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📜 Регламент и строгие правила работы агента

При работе с `mcp_qwen` действуют строгие правила оркестрации, зашитые на всех уровнях (спецификация MCP, описания инструментов, системные инструкции):

1. **Строго 100% Оркестратор:** Gemini не пишет код самостоятельно в обход субагента, а полностью делегирует реализацию Qwen.
2. **Запрет на искажение промпта:** СТРОГО ЗАПРЕЩЕНО перефразировать, «улучшать» или сокращать запрос пользователя. Текст передаётся субагенту в первозданном виде.
3. **Сбор контекста проекта и лимиты вложений:** Если в проекте есть существующие файлы, обязательно передается `project_dir`. Сервер упаковывает проект во вложения: до 4 файлов проекта + 1 txt промпт со всеми остальными файлами 5..N + до 5 изображений/скриншотов (всего до 10 файлов). Для точечной правки передается `target_files` (и при необходимости `images`).
4. **Таймер 60 секунд:** Сразу после вызова `mcp_qwen_submit_task` Gemini ставит 60-секундный таймер через инструмент `schedule` для периодического опроса статуса через `mcp_qwen_check_status`.
5. **Запись Verbatim (1:1):** Код субагента переносится на диск без изменения ни единого символа, без удаления комментариев и сокращений.
6. **Порционный вывод (Continuation):** Для файлов длиннее 1000 строк субагент возвращает `### STATUS: NEED_CONTINUATION`. Оркестратор сохраняет готовую часть и отправляет команду `mcp_qwen_continue_task`.
7. **Обязательная верификация (Шаг 6):** После сборки проекта на диске вызывается `mcp_qwen_verify_task` со структурой файлов и логами ошибок компилятора/линтера. Оркестратор ожидает подтверждения `ПРОЕКТ_СОБРАН_ВЕРНО` от субагента перед завершением задачи.

---

## ⚙️ Как устроен инструмент изнутри (CDP Automation Engine)

### 1. Автономный запуск с интерактивным окном (`launchQwenWithDebugging`)
Обычный вызов `child_process.spawn` в среде агентов Windows порождает процессы на служебном десктопе (`exebox-...`), из-за чего окно приложения остается невидимым для пользователя.
В адаптере `QwenCDPAdapter` реализован запуск через планировщик задач Windows с флагом интерактивности:
```powershell
schtasks /create /tn "LaunchQwenMCP" /tr "\"C:\Program Files\Qwen\Qwen.exe\" --remote-debugging-port=9222" /sc once /st 00:00 /f /it
schtasks /run /tn "LaunchQwenMCP"
```
Флаг `/it` предписывает операционной системе открыть GUI-окно на **интерактивном рабочем столе пользователя** (`WinSta0\Default`).

### 2. Подключение к Webview через CDP
Qwen Studio — это приложение Electron, внутри которого страница `https://chat.qwen.ai/` загружена во внутренний тег `<webview>`. Адаптер опрашивает список целей `/json/list` и подключается именно к сессии чата (`type === 'webview'` и `url.includes('chat.qwen.ai')`).

### 3. Эмуляция пользовательского ввода и клика
Современные веб-интерфейсы на React игнорируют простое изменение `textarea.value = ...`. Адаптер использует прототипный нативный сеттер с последующим вызовом событий:
```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, 'value'
)?.set;
nativeSetter.call(textarea, promptText);
textarea.dispatchEvent(new Event('input', { bubbles: true }));
textarea.dispatchEvent(new Event('change', { bubbles: true }));
```
После паузы 350 мс (необходимой React для переключения интерфейса с иконки микрофона на стрелку отправки) адаптер нажимает кнопку `button.send-button` (aria-label: *"Отправить"*).

### 4. Чтение кода из Monaco Editor
В Qwen Studio блоки кода рендерятся через встроенный редактор Monaco Editor (`pre.qwen-markdown-code`). Адаптер извлекает строки напрямую из элементов `.view-line`, исключая повреждения отступов, HTML-сущностей и спецсимволов.

---

## 🛠 Доступные MCP-инструменты

| Инструмент | Описание |
|---|---|
| `mcp_qwen_submit_task` | Делегирует задачу субагенту Qwen. Поддерживает `project_dir` (авто-сканирование структуры, прикрепление до 10 файлов: 4 файла проекта + 1 txt промпт со всем недостающим + до 5 фото/скриншотов), `images` (фото, референсы, скриншоты), `target_files` (точечная правка) и `attached_files`. Возвращает `task_id`. |
| `mcp_qwen_check_status` | Опрашивает статус (`RUNNING`, `COMPLETED`, `NEED_CONTINUATION`, `ERROR`), возвращает распарсенные файлы, структуру и текстовый ответ (`raw_response`). |
| `mcp_qwen_continue_task` | Отправляет команду продолжения генерации оставшихся файлов. |
| `mcp_qwen_verify_task` | **Шаг 6:** Отправляет структуру собранного проекта и логи ошибок сборки субагенту на подтверждение. |
| `mcp_qwen_extract_and_write_files` | Записывает сгенерированные файлы на диск строго без изменений с защитой от Path Traversal. |
| `mcp_qwen_build_project_context` | Сканирует директорию проекта, формирует дерево структуры, отбирает до 4 файлов кода и до 5 изображений во вложения и подготавливает остальные для запроса. |
| `mcp_qwen_get_config` | Возвращает текущие настройки и результаты сетевой диагностики. |
| `mcp_qwen_set_config` | Динамически обновляет параметры конфигурации сервера. |

---

## 🚀 Установка и быстрый старт («В один клик»)

### Требования
- **Node.js** версии 18 или новее.
- **Qwen Studio Desktop** (по умолчанию устанавливается в `C:\Program Files\Qwen\Qwen.exe`) либо браузер Google Chrome.

### Шаг 1: Установка зависимостей и сборка
```bash
git clone https://github.com/your-username/qwen_mcp.git
cd qwen_mcp
npm install
npm run build
```

### Шаг 2: Регистрация в AI-ассистенте

#### Для Google Antigravity:
Добавьте сервер в файл `~/.gemini/config/mcp_config.json`:
```json
{
  "mcpServers": {
    "qwen": {
      "command": "node",
      "args": ["C:\\ai_projects\\qwen_mcp\\build\\index.js"]
    }
  }
}
```

#### Для Claude Desktop:
Добавьте сервер в файл `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "qwen": {
      "command": "node",
      "args": ["C:\\ai_projects\\qwen_mcp\\build\\index.js"]
    }
  }
}
```

#### Для Cursor IDE:
В настройках MCP (`Settings > Features > MCP`):
- **Name:** `qwen`
- **Type:** `command`
- **Command:** `node C:\ai_projects\qwen_mcp\build\index.js`

### 💡 Полная автономность:
Вам **не нужно** вручную создавать ярлыки, запускать батники или включать отладку. При первом обращении агент проверит статус Qwen, при необходимости сам запустит его на экране пользователя с флагом отладки и передаст промпт.

---

## 📖 Инструкция по использованию (Пошаговые сценарии)

### Сценарий 1: Разработка проекта с нуля
1. **Пользователь:** *«Создай REST API сервис на FastAPI с авторизацией JWT и базой SQLite»*.
2. **Gemini (Оркестратор):**
   - Вызывает `mcp_qwen_submit_task` с неизмененным промптом пользователя.
   - Ставит таймер на 60 секунд: `schedule(DurationSeconds=60, Prompt="Проверить статус")`.
3. **Qwen (Субагент):**
   - Формирует дерево проекта:
     ```
     fastapi_project/
     ├── app/
     │   ├── main.py
     │   ├── auth.py
     │   └── models.py
     ├── requirements.txt
     └── README.md
     ```
   - Генерирует код каждого файла через `### FILE: app/main.py`, `### FILE: app/auth.py` и т.д.
4. **Gemini (Оркестратор):**
   - По таймеру опрашивает `mcp_qwen_check_status`.
   - Получив статус `COMPLETED`, сохраняет файлы на диск (verbatim).
   - Запускает сборку / проверку синтаксиса.
   - Вызывает `mcp_qwen_verify_task` с деревом структуры файлов.
   - Получив подтверждение `ПРОЕКТ_СОБРАН_ВЕРНО`, сообщает пользователю о готовности.

### Сценарий 2: Доработка существующего проекта (Контекст + Вложения + Встроенный код)
Когда в проекте уже есть кодовая база и нужно добавить фичу или провести рефакторинг:
1. Gemini передает параметр `project_dir: "C:\\projects\\my_app"` (и при необходимости `images: ["C:\\photos\\mockup.png"]`).
2. MCP-сервер автоматически:
   - Строит полное визуальное дерево структуры файлов проекта (исключая `node_modules`, `.git`, бинарники).
   - Распределяет вложения в пределах лимита **до 10 файлов (до 5 документов + до 5 изображений)**:
     * **До 5 документов**: первые до 4 ключевых файлов кода проекта прикрепляются как документы (`type: ["document"]`) + 1 файл `task_prompt.txt` (содержит полный промпт, дерево структуры и полный рабочий код всех остальных файлов с 5-го по N-й), что полностью исключает лимит поля ввода 131 072 символов.
     * **До 5 изображений / фото / скриншотов**: автоматически сканируются из проекта (`references_photos/`, `screenshots/`, `assets/`, `mockups/`) либо передаются через параметр `images` (`type: ["vision"]`).
3. Qwen 3.8 Max (контекстное окно более 1 000 000 токенов) получает целостный контекст всей кодовой базы и всех референсов/скриншотов за один запрос и выполняет задачу с полным пониманием архитектуры.

### Сценарий 3: Точечная правка (Targeted Single-File Edit)
Если нужно изменить только один файл или исправить изолированный баг:
1. **Пользователь:** *«Поправь валидацию email в файле src/auth/validator.ts»*.
2. Gemini передает `target_files: ["src/auth/validator.ts"]`.
3. Сервер прикрепляет **ТОЛЬКО этот файл** (или файлы из списка) без сканирования и отправки всей кодовой базы проекта.
4. Субагент мгновенно фокусируется на конкретном файле, экономя время и вычислительные ресурсы.

### Сценарий 4: Генерация огромных файлов (Chunking / Continuation)
Если генерируется файл более 1000 строк кода:
1. Qwen выводит полный файл и завершает ответ меткой:
   ```markdown
   ### STATUS: NEED_CONTINUATION
   Осталось вывести: components/Dashboard.tsx, utils/analytics.ts
   ```
2. Gemini опрашивает статус, обнаруживает `NEED_CONTINUATION`, сохраняет готовый файл на диск.
3. Gemini вызывает `mcp_qwen_continue_task(task_id, instruction="Файл сохранен. Продолжай вывод начиная с components/Dashboard.tsx")`.
4. Процесс циклически повторяется до `### STATUS: ALL_FILES_COMPLETED`.

### Сценарий 5: Исправление ошибок сборки (Верификация)
1. Если при сборке проекта возникла ошибка (например, конфликт типов в TypeScript):
2. Gemini вызывает `mcp_qwen_verify_task`:
   ```json
   {
     "task_id": "qwen_task_...",
     "assembled_structure": "src/index.ts, src/types.ts",
     "verification_status": "ERRORS_FOUND",
     "error_log": "TS2322: Type 'string' is not assignable to type 'number' at src/index.ts:42",
     "troubled_files": [
       { "path": "src/index.ts", "content": "...исходный код с ошибкой..." }
     ]
   }
   ```
3. Qwen анализирует ошибку, генерирует исправленную версию файла.
4. Gemini перезаписывает файл и проверяет повторно.

---

## 🔄 Адаптация кода под ЛЮБОЙ ДРУГОЙ ЧАТ

Архитектура адаптера [`src/adapters/qwen_cdp_adapter.ts`](src/adapters/qwen_cdp_adapter.ts) полностью универсальна. Вы можете легко адаптировать его под любой веб-интерфейс AI.

### 1. Адаптация под веб-чаты в браузере Google Chrome

Вы можете использовать **ChatGPT, Claude.ai, DeepSeek, Google AI Studio, HuggingChat, Perplexity** вместо Qwen Desktop.

#### Шаг А: Запуск Chrome с портом отладки
```cmd
chrome.exe --remote-debugging-port=9222 "https://chatgpt.com"
```

#### Шаг Б: Настройка поиска вкладки (`findQwenTarget`)
В файле `src/adapters/qwen_cdp_adapter.ts` измените фильтрацию целей:
```typescript
public async findQwenTarget(): Promise<CDPTarget> {
  const targets = await this.getTargets();
  
  // Ищем вкладку ChatGPT (или claude.ai / deepseek.com):
  const target = targets.find(
    (t) => t.type === 'page' && t.url.includes('chatgpt.com')
  );
  
  if (!target) {
    throw new Error('Вкладка ChatGPT не найдена в запущенном браузере Chrome!');
  }
  return target;
}
```

#### Шаг В: Таблица селекторов для популярных чатов

| Чат | Поле ввода (`textarea`) | Кнопка отправки (`sendBtn`) | Индикатор генерации (`isGenerating`) | Контейнер ответа |
|---|---|---|---|---|
| **ChatGPT** | `#prompt-textarea` | `button[data-testid="send-button"]` | `button[data-testid="stop-button"]` | `div[data-message-author-role="assistant"]` |
| **Claude.ai** | `div[contenteditable="true"]` | `button[aria-label="Send Message"]` | `button[aria-label="Stop response"]` | `.font-claude-message` |
| **DeepSeek** | `textarea` | `.chat-input-send-button` | `.chat-input-stop-button` | `.ds-markdown` |
| **Google AI Studio** | `textarea.mat-input-element` | `button.run-button` | `mat-spinner, button.stop-button` | `.model-response-text` |
| **Perplexity** | `textarea[placeholder*="Ask"]` | `button[aria-label="Submit"]` | `button[aria-label="Stop"]` | `.prose` |

---

### 2. Адаптация под Chrome DevTools Browser / Headless

Инструмент можно использовать в полностью бесшумном фоновом режиме (Headless) без отображения графического окна:

```bash
chrome.exe --headless=new --remote-debugging-port=9222 "https://chat.qwen.ai"
```

Через протокол CDP доступны расширенные возможности:
- **Скриншоты:** вызов метода `Page.captureScreenshot` для визуального контроля страницы.
- **Перехват сети:** прослушивание Server-Sent Events (SSE) через домен `Network` для мгновенного получения токенов в реальном времени.
- **Внедрение скриптов:** вызов `Runtime.evaluate` для прямого взаимодействия с глобальными объектами страницы.

---

### 3. Адаптация под локальные WebUI (Ollama, LM Studio)

Для работы с локальными открытыми моделями через веб-интерфейсы:
1. **Ollama OpenWebUI:** запустите интерфейс на `http://localhost:3000` в отладочном Chrome и настройте селекторы аналогично ChatGPT.
2. **Прямой REST API:** включите API-режим в `config.json`:
   ```json
   {
     "mode": "api",
     "apiBaseUrl": "http://localhost:11434/v1",
     "model": "qwen2.5-coder:32b",
     "apiKey": "ollama"
   }
   ```

---

## 🔧 Конфигурация (`config.json`)

Конфигурационный файл `config.json` автоматически создается в корне проекта:

```json
{
  "mode": "auto",
  "cdpHost": "127.0.0.1",
  "cdpPort": 9222,
  "qwenExePath": "C:\\Program Files\\Qwen\\Qwen.exe",
  "apiBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  "apiKey": "",
  "model": "qwen-max",
  "timeoutSeconds": 300
}
```

- **`mode`**: 
  - `"auto"` — по умолчанию: пытается подключиться к Qwen Desktop по CDP, при отсутствии переключается на API.
  - `"cdp"` — только через Qwen Desktop / Chrome CDP.
  - `"api"` — только через облачный эндпоинт (DashScope / OpenAI-совместимый).
- **`cdpPort`**: порт удаленной отладки Chromium (по умолчанию `9222`).
- **`timeoutSeconds`**: максимальное время ожидания ответа субагента (по умолчанию 300 секунд).

---

## 📂 Структура проекта

```
qwen_mcp/
├── src/
│   ├── index.ts                     # Точка входа MCP-сервера, регистрация инструментов
│   ├── task_manager.ts              # Управление жизненным циклом задач, верификация
│   ├── parser.ts                    # Парсер деревьев файлов, блоков ### FILE: и статусов
│   ├── file_writer.ts               # Атомарная запись кода на диск (verbatim)
│   ├── config.ts                    # Менеджер конфигурации config.json
│   ├── types.ts                     # TypeScript интерфейсы и модели протокола
│   └── adapters/
│       ├── qwen_cdp_adapter.ts      # CDP-клиент (интерактивный запуск, ввод, чтение Monaco)
│       └── qwen_api_adapter.ts      # REST API-клиент (OpenAI-совместимый DashScope)
├── tests/
│   ├── run_all_tests.js             # Главный тест-раннер
│   ├── test_parser.js               # Юнит-тесты парсера файлов и продолжения
│   └── test_server_mcp.js           # Тест протокола JSON-RPC MCP и всех инструментов
├── instructions.md                  # Официальный регламент оркестрации для AI-агентов
├── GEMINI.md                        # Инструкция для Gemini в Antigravity
├── package.json                     # Конфигурация зависимостей и скриптов
├── tsconfig.json                    # Настройки компилятора TypeScript
├── LICENSE                          # Лицензия MIT
└── README.md                        # Полная документация проекта
```

---

## 🧪 Тестирование

Для запуска полного набора автоматических тестов выполните:
```bash
npm test
```

Набор тестов проверяет:
- Корректный парсинг деревьев каталогов и блоков файлов `### FILE:`.
- Обработку больших файлов и чанкования (`### STATUS: NEED_CONTINUATION`).
- Атомарную запись файлов на диск с защитой от Path Traversal.
- Полный цикл рукопожатия протокола MCP (JSON-RPC) и регистрацию всех 7 инструментов.

---

## 📄 Лицензия

Проект распространяется под открытой лицензией [MIT](LICENSE).

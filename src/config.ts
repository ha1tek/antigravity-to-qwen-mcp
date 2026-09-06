import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { ServerConfig } from './types';

dotenv.config({ quiet: true });

const CONFIG_FILE_PATH = path.resolve(__dirname, '../config.json');

const DEFAULT_CONFIG: ServerConfig = {
  mode: 'auto',
  cdpHost: '127.0.0.1',
  cdpPort: 9222,
  qwenExePath: 'C:\\Program Files\\Qwen\\Qwen.exe',
  apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.QWEN_API_KEY || '',
  model: process.env.QWEN_MODEL || 'qwen-max',
  timeoutSeconds: 300
};

export function loadConfig(): ServerConfig {
  let fileConfig: Partial<ServerConfig> = {};
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
      fileConfig = JSON.parse(content);
    } catch (e) {
      console.error(`[Config] Failed to parse config.json:`, e);
    }
  }

  return {
    mode: (process.env.QWEN_MODE as any) || fileConfig.mode || DEFAULT_CONFIG.mode,
    cdpHost: process.env.QWEN_CDP_HOST || fileConfig.cdpHost || DEFAULT_CONFIG.cdpHost,
    cdpPort: Number(process.env.QWEN_CDP_PORT) || fileConfig.cdpPort || DEFAULT_CONFIG.cdpPort,
    qwenExePath: process.env.QWEN_EXE_PATH || fileConfig.qwenExePath || DEFAULT_CONFIG.qwenExePath,
    apiBaseUrl: process.env.QWEN_API_BASE || fileConfig.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl,
    apiKey: process.env.QWEN_API_KEY || fileConfig.apiKey || DEFAULT_CONFIG.apiKey,
    model: process.env.QWEN_MODEL || fileConfig.model || DEFAULT_CONFIG.model,
    timeoutSeconds: Number(process.env.QWEN_TIMEOUT) || fileConfig.timeoutSeconds || DEFAULT_CONFIG.timeoutSeconds
  };
}

export function saveConfig(config: Partial<ServerConfig>): void {
  const current = loadConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(updated, null, 2), 'utf8');
}

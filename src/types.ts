export type TaskStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'NEED_CONTINUATION'
  | 'ERROR'
  | 'CANCELLED';

export interface ParsedFile {
  path: string;
  content: string;
  language: string;
}

export interface ParseResult {
  projectStructure: string;
  files: ParsedFile[];
  completionStatus: 'NEED_CONTINUATION' | 'ALL_FILES_COMPLETED' | 'UNKNOWN';
  continuationNotes?: string;
  rawText: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface QwenSubagentTask {
  id: string;
  userPrompt: string;
  skillsContent?: string;
  workspaceContext?: string;
  projectDir?: string;
  targetFiles?: string[];
  images?: string[];
  attachedFiles?: string[];
  filesToAttach?: string[];
  docFilesToAttach?: string[];
  imageFilesToAttach?: string[];
  isTargeted?: boolean;
  customSystemPrompt?: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  history: ChatMessage[];
  currentResponse: string;
  projectStructure: string;
  parsedFiles: ParsedFile[];
  completionStatus?: 'NEED_CONTINUATION' | 'ALL_FILES_COMPLETED' | 'UNKNOWN';
  continuationNotes?: string;
  error?: string;
}

export interface ServerConfig {
  mode: 'auto' | 'cdp' | 'api';
  cdpHost: string;
  cdpPort: number;
  qwenExePath: string;
  apiBaseUrl: string;
  apiKey?: string;
  model: string;
  timeoutSeconds: number;
}

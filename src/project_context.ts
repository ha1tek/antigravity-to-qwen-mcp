import * as fs from 'fs';
import * as path from 'path';

export interface ProjectFileEntry {
  relativePath: string;
  fullPath: string;
  content: string;
  size: number;
}

export interface ProjectContextResult {
  isTargeted: boolean;
  directoryTree: string;
  filesToAttach: string[]; // Combined list: docs (up to 4) + images (up to 5)
  docFilesToAttach: string[]; // Up to 4 project code/doc files
  imageFilesToAttach: string[]; // Up to 5 image/screenshot files
  embeddedFilesPrompt: string; // Formatted "=== ФАЙЛ: ... ===" text for remaining code files (5..N)
  totalFilesCount: number;
  totalCodeFilesCount: number;
  totalImageFilesCount: number;
  attachedCount: number;
  embeddedCount: number;
}

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.gemini',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.idea',
  '.vscode',
  'bin',
  'obj'
]);

const DEFAULT_IGNORED_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock'
]);

const BINARY_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.pdf', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.woff', '.woff2', '.ttf', '.eot',
  '.pyc', '.class', '.db', '.sqlite'
]);

export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.avif', '.bmp'
]);

/**
 * Checks if a file is an image/photo/screenshot
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Checks if a file is considered a text/code file suitable for AI reading
 */
export function isTextCodeFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);

  if (DEFAULT_IGNORED_FILES.has(basename)) return false;
  if (IMAGE_EXTENSIONS.has(ext)) return false;
  if (BINARY_EXTENSIONS.has(ext)) return false;

  return true;
}

/**
 * Generates an ASCII directory tree of the project
 */
export function generateDirectoryTree(
  dirPath: string,
  prefix = '',
  maxDepth = 6,
  currentDepth = 0
): string {
  if (currentDepth > maxDepth || !fs.existsSync(dirPath)) return '';

  let output = '';
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    // Filter out ignored dirs and hidden cache
    const filteredEntries = entries.filter((e) => {
      if (e.name.startsWith('.') && e.name !== '.env.example') {
        if (e.name === '.git' || e.name === '.gemini' || e.name === '.vscode') return false;
      }
      if (e.isDirectory() && DEFAULT_IGNORED_DIRS.has(e.name)) return false;
      if (e.isFile() && !isTextCodeFile(e.name) && !isImageFile(e.name)) return false;
      return true;
    });

    // Sort: directories first, then files alphabetically
    filteredEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < filteredEntries.length; i++) {
      const entry = filteredEntries[i];
      const isLast = i === filteredEntries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const subPrefix = prefix + (isLast ? '    ' : '│   ');

      if (entry.isDirectory()) {
        output += `${prefix}${connector}${entry.name}/\n`;
        output += generateDirectoryTree(
          path.join(dirPath, entry.name),
          subPrefix,
          maxDepth,
          currentDepth + 1
        );
      } else {
        output += `${prefix}${connector}${entry.name}\n`;
      }
    }
  } catch (err: any) {
    output += `${prefix}[Ошибка чтения директории: ${err.message}]\n`;
  }

  return output;
}

/**
 * Recursively scans project files and collects their content
 */
export function scanProjectFiles(
  dirPath: string,
  baseDir: string = dirPath,
  maxFileSize = 500 * 1024 // 500 KB limit per file
): ProjectFileEntry[] {
  if (!fs.existsSync(dirPath)) return [];

  const results: ProjectFileEntry[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.git')) {
          results.push(...scanProjectFiles(fullPath, baseDir, maxFileSize));
        }
      } else if (entry.isFile()) {
        if (isTextCodeFile(fullPath)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= maxFileSize) {
              const content = fs.readFileSync(fullPath, 'utf8');
              results.push({
                relativePath,
                fullPath,
                content,
                size: stat.size
              });
            }
          } catch {
            // Ignore unreadable files
          }
        }
      }
    }
  } catch {}

  return results;
}

/**
 * Recursively scans project for image files (photos, screenshots, mockups)
 */
export function scanProjectImages(
  dirPath: string,
  baseDir: string = dirPath,
  maxFileSize = 15 * 1024 * 1024 // 15 MB limit per image
): ProjectFileEntry[] {
  if (!fs.existsSync(dirPath)) return [];
  const results: ProjectFileEntry[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.git')) {
          results.push(...scanProjectImages(fullPath, baseDir, maxFileSize));
        }
      } else if (entry.isFile()) {
        if (isImageFile(fullPath)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= maxFileSize) {
              results.push({
                relativePath,
                fullPath,
                content: '',
                size: stat.size
              });
            }
          } catch {}
        }
      }
    }
  } catch {}

  return results;
}

/**
 * Builds full project context:
 * - Targeted mode if targetFiles provided (attaches only target file)
 * - Full project mode:
 *   - Up to 4 project code files attached as documents (reserving 1 slot for task_prompt.txt)
 *   - Up to 5 project images/screenshots attached as vision
 *   - Remaining code files (5..N) embedded into prompt text
 */
export function buildProjectContext(params: {
  projectDir: string;
  targetFiles?: string[];
  imageFiles?: string[];
  maxDocAttachments?: number; // default: 4 (leaving 1 slot for task_prompt.txt)
  maxImageAttachments?: number; // default: 5 (up to 5 photos/screenshots)
  maxAttachments?: number; // backward compatibility
}): ProjectContextResult {
  const {
    projectDir,
    targetFiles,
    imageFiles = [],
    maxDocAttachments = 4,
    maxImageAttachments = 5,
    maxAttachments
  } = params;
  const absProjectDir = path.resolve(projectDir);

  const effectiveMaxDocs =
    params.maxDocAttachments !== undefined
      ? params.maxDocAttachments
      : params.maxAttachments !== undefined
      ? params.maxAttachments
      : 4;
  const effectiveMaxImages =
    params.maxImageAttachments !== undefined ? params.maxImageAttachments : 5;

  if (!fs.existsSync(absProjectDir)) {
    return {
      isTargeted: false,
      directoryTree: `[Директория ${projectDir} не найдена]`,
      filesToAttach: [],
      docFilesToAttach: [],
      imageFilesToAttach: [],
      embeddedFilesPrompt: '',
      totalFilesCount: 0,
      totalCodeFilesCount: 0,
      totalImageFilesCount: 0,
      attachedCount: 0,
      embeddedCount: 0
    };
  }

  // CASE 1: Targeted Edit Mode (Точечная правка)
  if (targetFiles && targetFiles.length > 0) {
    const targetFileEntries: ProjectFileEntry[] = [];
    const targetImageEntries: ProjectFileEntry[] = [];

    const allTargets = [...targetFiles, ...imageFiles];
    for (const target of allTargets) {
      const fullPath = path.isAbsolute(target) ? target : path.join(absProjectDir, target);
      if (fs.existsSync(fullPath)) {
        const relativePath = path.relative(absProjectDir, fullPath).replace(/\\/g, '/');
        try {
          const stat = fs.statSync(fullPath);
          if (isImageFile(fullPath)) {
            targetImageEntries.push({
              relativePath,
              fullPath,
              content: '',
              size: stat.size
            });
          } else {
            const content = fs.readFileSync(fullPath, 'utf8');
            targetFileEntries.push({
              relativePath,
              fullPath,
              content,
              size: stat.size
            });
          }
        } catch {}
      }
    }

    const docFilesToAttach = targetFileEntries.slice(0, effectiveMaxDocs).map((f) => f.fullPath);
    const overflowFiles = targetFileEntries.slice(effectiveMaxDocs);
    const imageFilesToAttach = targetImageEntries.slice(0, effectiveMaxImages).map((f) => f.fullPath);

    let embeddedFilesPrompt = '';
    if (overflowFiles.length > 0) {
      embeddedFilesPrompt = overflowFiles
        .map(
          (f) =>
            `=== ФАЙЛ: ${f.relativePath} ===\n${f.content}\n=== КОНЕЦ ФАЙЛА ===`
        )
        .join('\n\n');
    }

    const targetList = targetFileEntries.map((f) => `  - [КОД]: ${f.relativePath}`).join('\n');
    const imageList = targetImageEntries.map((f) => `  - [ФОТО]: ${f.relativePath}`).join('\n');
    const directoryTree = `[РЕЖИМ ТОЧЕЧНОЙ ПРАВКИ - ЦЕЛЕВЫЕ ФАЙЛЫ]:\n${targetList || ''}\n${imageList || ''}`.trim();

    const filesToAttach = [...docFilesToAttach, ...imageFilesToAttach];

    return {
      isTargeted: true,
      directoryTree,
      filesToAttach,
      docFilesToAttach,
      imageFilesToAttach,
      embeddedFilesPrompt,
      totalFilesCount: targetFileEntries.length + targetImageEntries.length,
      totalCodeFilesCount: targetFileEntries.length,
      totalImageFilesCount: targetImageEntries.length,
      attachedCount: filesToAttach.length,
      embeddedCount: overflowFiles.length
    };
  }

  // CASE 2: Full Project Mode (Существующий проект)
  const dirName = path.basename(absProjectDir);
  const rawTree = generateDirectoryTree(absProjectDir);
  const directoryTree = `${dirName}/\n${rawTree}`;

  const allCodeFiles = scanProjectFiles(absProjectDir);
  const allImageFiles = scanProjectImages(absProjectDir);

  // Add any explicitly provided image files
  for (const img of imageFiles) {
    const fullPath = path.isAbsolute(img) ? img : path.join(absProjectDir, img);
    if (fs.existsSync(fullPath) && !allImageFiles.some((i) => i.fullPath === fullPath)) {
      try {
        const stat = fs.statSync(fullPath);
        allImageFiles.push({
          relativePath: path.relative(absProjectDir, fullPath).replace(/\\/g, '/'),
          fullPath,
          content: '',
          size: stat.size
        });
      } catch {}
    }
  }

  // Sort code files: configuration and entrypoint files first
  allCodeFiles.sort((a, b) => {
    const isPriorityA =
      a.relativePath.includes('package.json') ||
      a.relativePath.includes('tsconfig.json') ||
      a.relativePath.includes('index.') ||
      a.relativePath.includes('main.') ||
      a.relativePath.includes('App.');
    const isPriorityB =
      b.relativePath.includes('package.json') ||
      b.relativePath.includes('tsconfig.json') ||
      b.relativePath.includes('index.') ||
      b.relativePath.includes('main.') ||
      b.relativePath.includes('App.');

    if (isPriorityA && !isPriorityB) return -1;
    if (!isPriorityA && isPriorityB) return 1;
    return a.relativePath.localeCompare(b.relativePath);
  });

  // Sort image files: prioritize explicitly passed files, then references, photos, screenshots, mockups
  const explicitSet = new Set(
    imageFiles.map((img) => path.resolve(path.isAbsolute(img) ? img : path.join(absProjectDir, img)))
  );
  allImageFiles.sort((a, b) => {
    const aIsExp = explicitSet.has(a.fullPath);
    const bIsExp = explicitSet.has(b.fullPath);
    if (aIsExp && !bIsExp) return -1;
    if (!aIsExp && bIsExp) return 1;

    const priorityKeywords = ['reference', 'photo', 'screenshot', 'mockup', 'ui', 'design', 'preview'];
    const pA = priorityKeywords.some((k) => a.relativePath.toLowerCase().includes(k));
    const pB = priorityKeywords.some((k) => b.relativePath.toLowerCase().includes(k));
    if (pA && !pB) return -1;
    if (!pA && pB) return 1;
    return a.relativePath.localeCompare(b.relativePath);
  });

  // Up to effectiveMaxDocs (default 4) attached as documents via CDP
  const docFilesToAttach = allCodeFiles.slice(0, effectiveMaxDocs).map((f) => f.fullPath);

  // Up to effectiveMaxImages (default 5) attached as images via CDP
  const imageFilesToAttach = allImageFiles.slice(0, effectiveMaxImages).map((f) => f.fullPath);

  // Code files beyond effectiveMaxDocs embedded into prompt text in full (files 5..N)
  const remainingFiles = allCodeFiles.slice(effectiveMaxDocs);

  let embeddedFilesPrompt = '';
  if (remainingFiles.length > 0) {
    embeddedFilesPrompt =
      `[СОДЕРЖИМОЕ ОСТАЛЬНЫХ ФАЙЛОВ ПРОЕКТА (файлы ${effectiveMaxDocs + 1}..${allCodeFiles.length})]:\n` +
      remainingFiles
        .map(
          (f) =>
            `=== ФАЙЛ: ${f.relativePath} ===\n${f.content}\n=== КОНЕЦ ФАЙЛА ===`
        )
        .join('\n\n');
  }

  const filesToAttach = [...docFilesToAttach, ...imageFilesToAttach];

  return {
    isTargeted: false,
    directoryTree,
    filesToAttach,
    docFilesToAttach,
    imageFilesToAttach,
    embeddedFilesPrompt,
    totalFilesCount: allCodeFiles.length + allImageFiles.length,
    totalCodeFilesCount: allCodeFiles.length,
    totalImageFilesCount: allImageFiles.length,
    attachedCount: filesToAttach.length,
    embeddedCount: remainingFiles.length
  };
}

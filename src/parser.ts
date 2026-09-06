import { ParsedFile, ParseResult } from './types';

/**
 * Parses Qwen subagent output into structured project files, directory tree, and status.
 */
export function parseQwenOutput(rawText: string): ParseResult {
  if (!rawText) {
    return {
      projectStructure: '',
      files: [],
      completionStatus: 'UNKNOWN',
      rawText: ''
    };
  }

  // Normalize line endings
  const normalized = rawText.replace(/\r\n/g, '\n');

  // Regex to match file header and code block
  // Format: (### )?FILE: <filepath>
  // followed by optional newlines, then ```[lang]\n<code>\n```
  const fileHeaderRegex = /(?:###\s*)?FILE:\s*[`*\[]?([^\n`*\]]+)[`*\]]?\s*\n/gi;

  const files: ParsedFile[] = [];
  let firstFileIndex = -1;

  // Find all file header matches
  const matches: { path: string; startIndex: number; headerEndIndex: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = fileHeaderRegex.exec(normalized)) !== null) {
    const filePath = match[1].trim();
    if (firstFileIndex === -1) {
      firstFileIndex = match.index;
    }
    matches.push({
      path: filePath,
      startIndex: match.index,
      headerEndIndex: match.index + match[0].length
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].startIndex : normalized.length;
    const blockContent = normalized.substring(current.headerEndIndex, nextStart);

    // Extract code from markdown code block ```lang ... ```
    // We look for the first code block within this file segment
    const codeBlockRegex = /```([a-zA-Z0-9_\-\.\+]*)\n([\s\S]*?)(?:```|$)/;
    const codeMatch = codeBlockRegex.exec(blockContent);

    if (codeMatch) {
      const language = (codeMatch[1] || '').trim();
      let code = codeMatch[2];
      // If code ends with a single trailing newline, preserve it, but don't add extra
      files.push({
        path: current.path.replace(/\\/g, '/').replace(/^\.\//, ''),
        content: code,
        language
      });
    } else {
      // Fallback: if no code fence was used, take clean content up to next file or status
      const cleanContent = blockContent.replace(/###\s*STATUS:[\s\S]*$/i, '').trim();
      files.push({
        path: current.path.replace(/\\/g, '/').replace(/^\.\//, ''),
        content: cleanContent,
        language: ''
      });
    }
  }

  // Extract project structure (everything before the first ### FILE:)
  let projectStructure = '';
  if (firstFileIndex > 0) {
    projectStructure = normalized.substring(0, firstFileIndex).trim();
  }

  // Determine completion status
  let completionStatus: 'NEED_CONTINUATION' | 'ALL_FILES_COMPLETED' | 'UNKNOWN' = 'UNKNOWN';
  let continuationNotes = '';

  const statusMatch = /(?:###\s*)?STATUS:\s*([A-Z_]+)([\s\S]*)/i.exec(normalized);
  if (statusMatch) {
    const rawStatus = statusMatch[1].toUpperCase();
    if (rawStatus.includes('NEED_CONTINUATION') || rawStatus.includes('CONTINUE')) {
      completionStatus = 'NEED_CONTINUATION';
      continuationNotes = statusMatch[2].trim();
    } else if (rawStatus.includes('ALL_FILES_COMPLETED') || rawStatus.includes('COMPLETED')) {
      completionStatus = 'ALL_FILES_COMPLETED';
      continuationNotes = statusMatch[2].trim();
    }
  } else {
    // If no explicit status tag, check textual hints
    if (/NEED_CONTINUATION/i.test(normalized)) {
      completionStatus = 'NEED_CONTINUATION';
    } else if (files.length > 0) {
      completionStatus = 'ALL_FILES_COMPLETED';
    }
  }

  return {
    projectStructure,
    files,
    completionStatus,
    continuationNotes: continuationNotes || undefined,
    rawText
  };
}

import * as fs from 'fs';
import * as path from 'path';
import { ParsedFile } from './types';

export interface WriteResult {
  success: boolean;
  writtenFiles: { path: string; fullPath: string; bytes: number }[];
  errors: { path: string; error: string }[];
}

/**
 * Safely writes parsed files to disk without modifying any content.
 */
export function writeFilesToDisk(targetDirectory: string, files: ParsedFile[]): WriteResult {
  const resolvedTarget = path.resolve(targetDirectory);
  const writtenFiles: { path: string; fullPath: string; bytes: number }[] = [];
  const errors: { path: string; error: string }[] = [];

  for (const file of files) {
    try {
      // Normalize relative path
      const cleanRelPath = file.path.replace(/^[/\\]+/, '');
      const fullPath = path.resolve(resolvedTarget, cleanRelPath);

      // Security check: ensure path is inside targetDirectory
      if (!fullPath.startsWith(resolvedTarget)) {
        errors.push({
          path: file.path,
          error: `Path traversal detected: "${file.path}" escapes target directory.`
        });
        continue;
      }

      // Ensure directory exists
      const dirName = path.dirname(fullPath);
      if (!fs.existsSync(dirName)) {
        fs.mkdirSync(dirName, { recursive: true });
      }

      // Write verbatim content as UTF-8
      fs.writeFileSync(fullPath, file.content, 'utf8');

      writtenFiles.push({
        path: cleanRelPath,
        fullPath,
        bytes: Buffer.byteLength(file.content, 'utf8')
      });
    } catch (err: any) {
      errors.push({
        path: file.path,
        error: err?.message || String(err)
      });
    }
  }

  return {
    success: errors.length === 0,
    writtenFiles,
    errors
  };
}

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { parseQwenOutput } = require('../build/parser');
const { writeFilesToDisk } = require('../build/file_writer');

console.log('[TEST 1] Testing Parser with typical Qwen subagent output...');

const sampleOutput = `
Project structure:
├── src/
│   ├── index.ts
│   └── utils/
│       └── helper.ts
└── package.json

### FILE: src/index.ts
\`\`\`typescript
import { helper } from './utils/helper';

export function main(): void {
  console.log("Hello from Qwen Subagent!");
  helper();
}
\`\`\`

### FILE: src/utils/helper.ts
\`\`\`typescript
export function helper(): string {
  // Verbatim comment with special characters: $ & < >
  return "OK";
}
\`\`\`

### FILE: package.json
\`\`\`json
{
  "name": "test-project",
  "version": "1.0.0"
}
\`\`\`

### STATUS: ALL_FILES_COMPLETED
Все 3 файла проекта успешно сгенерированы.
`;

const result = parseQwenOutput(sampleOutput);

assert.strictEqual(result.files.length, 3, 'Should parse 3 files');
assert.strictEqual(result.files[0].path, 'src/index.ts');
assert.ok(result.files[0].content.includes('Hello from Qwen Subagent!'));
assert.strictEqual(result.files[1].path, 'src/utils/helper.ts');
assert.ok(result.files[1].content.includes('Verbatim comment with special characters'));
assert.strictEqual(result.files[2].path, 'package.json');
assert.strictEqual(result.completionStatus, 'ALL_FILES_COMPLETED');
assert.ok(result.projectStructure.includes('Project structure:'));
console.log('✓ Parser test 1 passed!');

console.log('[TEST 2] Testing Parser with chunked/continuation output...');

const chunkedOutput = `
Структура:
- huge_service.py
- next_service.py

### FILE: huge_service.py
\`\`\`python
# Over 500 lines simulated
def huge_computation():
    return 42
\`\`\`

### STATUS: NEED_CONTINUATION
Осталось сгенерировать: next_service.py
`;

const resultChunk = parseQwenOutput(chunkedOutput);
assert.strictEqual(resultChunk.files.length, 1);
assert.strictEqual(resultChunk.files[0].path, 'huge_service.py');
assert.strictEqual(resultChunk.completionStatus, 'NEED_CONTINUATION');
assert.ok(resultChunk.continuationNotes.includes('next_service.py'));
console.log('✓ Parser test 2 (continuation) passed!');

console.log('[TEST 3] Testing File Writer...');
const tempTestDir = path.join(__dirname, 'temp_output');
if (fs.existsSync(tempTestDir)) {
  fs.rmSync(tempTestDir, { recursive: true, force: true });
}

const writeRes = writeFilesToDisk(tempTestDir, result.files);
assert.strictEqual(writeRes.success, true);
assert.strictEqual(writeRes.writtenFiles.length, 3);
assert.ok(fs.existsSync(path.join(tempTestDir, 'src', 'index.ts')));
assert.ok(fs.existsSync(path.join(tempTestDir, 'src', 'utils', 'helper.ts')));
assert.ok(fs.existsSync(path.join(tempTestDir, 'package.json')));

// Verify content is 100% verbatim
const writtenContent = fs.readFileSync(path.join(tempTestDir, 'src', 'utils', 'helper.ts'), 'utf8');
assert.strictEqual(writtenContent, result.files[1].content, 'Written content must match verbatim');

// Clean up
fs.rmSync(tempTestDir, { recursive: true, force: true });
console.log('✓ File writer test passed!');

console.log('All parser & writer tests successfully passed!');

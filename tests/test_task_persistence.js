const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { TaskManager } = require('../build/task_manager');

console.log('=== RUNNING TASK PERSISTENCE TESTS ===\n');

const tempDir = path.join(process.env.TEMP || process.env.TMP || 'C:\\Windows\\Temp', 'qwen_mcp');
const storePath = path.join(tempDir, 'tasks_store.json');

const testTaskId = 'qwen_persist_test_' + Date.now();
const testTask = {
  id: testTaskId,
  userPrompt: 'Test persistence prompt',
  status: 'COMPLETED',
  createdAt: Date.now() - 60000,
  updatedAt: Date.now(),
  history: [
    { role: 'user', content: 'Test prompt' },
    { role: 'assistant', content: '### FILE: test.js\n```js\nconsole.log(1);\n```\n### STATUS: ALL_FILES_COMPLETED' }
  ],
  currentResponse: '### FILE: test.js\n```js\nconsole.log(1);\n```\n### STATUS: ALL_FILES_COMPLETED',
  projectStructure: 'test.js',
  parsedFiles: [
    { path: 'test.js', content: 'console.log(1);' }
  ],
  completionStatus: 'ALL_FILES_COMPLETED'
};

// 1. Initialize first TaskManager instance and save a task
console.log('1. Initializing instance 1 and saving test task...');
const tm1 = new TaskManager({ mode: 'cdp', cdpPort: 9222, timeoutSeconds: 300 });
tm1.tasks.set(testTaskId, testTask);
tm1.saveTasksToDisk();

assert(fs.existsSync(storePath), 'tasks_store.json should exist');
const diskData = JSON.parse(fs.readFileSync(storePath, 'utf8'));
const foundInDisk = diskData.find(t => t.id === testTaskId);
assert(foundInDisk, 'Task should be found in tasks_store.json');
assert.strictEqual(foundInDisk.status, 'COMPLETED');
assert.strictEqual(foundInDisk.parsedFiles.length, 1);
console.log('   Task successfully stored to disk.');

// 2. Simulate process exit and restart with new TaskManager instance
console.log('2. Simulating MCP process restart (new TaskManager instance)...');
const tm2 = new TaskManager({ mode: 'cdp', cdpPort: 9222, timeoutSeconds: 300 });
const restoredTask = tm2.getTaskSync(testTaskId);
assert(restoredTask, 'Restored task must exist in new TaskManager instance');
assert.strictEqual(restoredTask.id, testTaskId);
assert.strictEqual(restoredTask.status, 'COMPLETED');
assert.strictEqual(restoredTask.parsedFiles.length, 1);
assert.strictEqual(restoredTask.parsedFiles[0].path, 'test.js');
console.log('   Task successfully restored across simulated process restart!');

// Clean up test task from disk
const cleaned = diskData.filter(t => t.id !== testTaskId);
fs.writeFileSync(storePath, JSON.stringify(cleaned, null, 2), 'utf8');

console.log('\n=== ALL TASK PERSISTENCE TESTS PASSED! ===');
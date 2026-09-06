const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { buildProjectContext, generateDirectoryTree, scanProjectFiles, isImageFile } = require('../build/project_context');

console.log('>>> Running Project Context Unit Tests...');

const testDir = path.resolve('tests/sample_project');
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}
fs.mkdirSync(testDir, { recursive: true });
fs.mkdirSync(path.join(testDir, 'src'), { recursive: true });
fs.mkdirSync(path.join(testDir, 'references_photos'), { recursive: true });
fs.mkdirSync(path.join(testDir, 'node_modules/fake_pkg'), { recursive: true });

// Create 15 sample code files
fs.writeFileSync(path.join(testDir, 'package.json'), '{"name": "sample"}');
fs.writeFileSync(path.join(testDir, 'tsconfig.json'), '{"compilerOptions": {}}');
fs.writeFileSync(path.join(testDir, 'node_modules/fake_pkg/index.js'), 'should be ignored');

for (let i = 1; i <= 13; i++) {
  fs.writeFileSync(
    path.join(testDir, `src/file${i}.ts`),
    `export const val${i} = ${i};\n`
  );
}

// Create 7 sample image files
const dummyImageBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
fs.writeFileSync(path.join(testDir, 'references_photos/mockup.png'), dummyImageBytes);
fs.writeFileSync(path.join(testDir, 'references_photos/screenshot_main.jpg'), dummyImageBytes);
fs.writeFileSync(path.join(testDir, 'references_photos/ui_ref.webp'), dummyImageBytes);
fs.writeFileSync(path.join(testDir, 'references_photos/design_palette.png'), dummyImageBytes);
fs.writeFileSync(path.join(testDir, 'src/app_icon.ico'), dummyImageBytes);
fs.writeFileSync(path.join(testDir, 'src/photo_extra.jpeg'), dummyImageBytes);
fs.writeFileSync(path.join(testDir, 'src/anim.gif'), dummyImageBytes);

// Test 1: Full Project Context with 4 Docs + 5 Images Split
console.log('[TEST 1] Testing 4 Documents + 5 Images Allocation...');
const fullContext = buildProjectContext({
  projectDir: testDir,
  maxDocAttachments: 4,
  maxImageAttachments: 5
});

assert.strictEqual(fullContext.isTargeted, false);
assert.strictEqual(fullContext.totalCodeFilesCount, 15); // 2 configs + 13 ts files
assert.strictEqual(fullContext.totalImageFilesCount, 7); // 7 images
assert.strictEqual(fullContext.docFilesToAttach.length, 4); // max 4 code docs (reserves 5th slot for prompt txt)
assert.strictEqual(fullContext.imageFilesToAttach.length, 5); // max 5 images
assert.strictEqual(fullContext.filesToAttach.length, 9); // 4 docs + 5 images
assert.strictEqual(fullContext.embeddedCount, 11); // 15 - 4 = 11 remaining code files embedded
assert.ok(fullContext.directoryTree.includes('src/'));
assert.ok(fullContext.directoryTree.includes('references_photos/'));
assert.ok(!fullContext.directoryTree.includes('node_modules'));
assert.ok(fullContext.embeddedFilesPrompt.includes('=== ФАЙЛ:'));
console.log('✓ 4 Docs + 5 Images allocation passed! (4 docs, 5 images attached, 11 code files embedded)');

// Test 2: Targeted Edit Mode with code and image
console.log('[TEST 2] Testing Targeted Edit Mode with Code and Image...');
const targetedContext = buildProjectContext({
  projectDir: testDir,
  targetFiles: ['src/file3.ts'],
  imageFiles: ['references_photos/mockup.png']
});

assert.strictEqual(targetedContext.isTargeted, true);
assert.strictEqual(targetedContext.totalCodeFilesCount, 1);
assert.strictEqual(targetedContext.totalImageFilesCount, 1);
assert.strictEqual(targetedContext.docFilesToAttach.length, 1);
assert.strictEqual(targetedContext.imageFilesToAttach.length, 1);
assert.strictEqual(targetedContext.attachedCount, 2);
assert.strictEqual(targetedContext.embeddedCount, 0);
assert.ok(targetedContext.docFilesToAttach[0].endsWith('file3.ts'));
assert.ok(targetedContext.imageFilesToAttach[0].endsWith('mockup.png'));
console.log('✓ Targeted Edit Mode with Code & Image passed!');

// Test 3: Backward compatibility (maxAttachments)
console.log('[TEST 3] Testing Backward Compatibility with maxAttachments: 10...');
const legacyContext = buildProjectContext({
  projectDir: testDir,
  maxAttachments: 10
});
assert.strictEqual(legacyContext.docFilesToAttach.length, 10);
assert.strictEqual(legacyContext.imageFilesToAttach.length, 5);
console.log('✓ Backward compatibility passed!');

// Cleanup
fs.rmSync(testDir, { recursive: true, force: true });
console.log('=== All Project Context Tests Passed! ===\n');

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

console.log('[TEST MCP SERVER] Testing JSON-RPC MCP handshake and tools list...');

const serverPath = path.resolve(__dirname, '../build/index.js');
const child = spawn(process.execPath, [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let buffer = '';

function sendRpc(msg) {
  const json = JSON.stringify(msg);
  child.stdin.write(json + '\n');
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const res = JSON.parse(line);
      handleResponse(res);
    } catch (e) {
      console.error('Failed to parse line:', line, e);
    }
  }
});

let step = 0;

function handleResponse(res) {
  if (res.id === 1) {
    console.log('✓ Received initialize response:', res.result?.serverInfo?.name);
    assert.strictEqual(res.result?.serverInfo?.name, 'mcp_qwen');
    // Request tools/list
    sendRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    });
  } else if (res.id === 2) {
    console.log('✓ Received tools/list response:');
    const tools = res.result?.tools || [];
    const toolNames = tools.map((t) => t.name);
    console.log('Registered tools:', toolNames);

    assert.ok(toolNames.includes('mcp_qwen_submit_task'), 'Must have mcp_qwen_submit_task');
    assert.ok(toolNames.includes('mcp_qwen_check_status'), 'Must have mcp_qwen_check_status');
    assert.ok(toolNames.includes('mcp_qwen_continue_task'), 'Must have mcp_qwen_continue_task');
    assert.ok(toolNames.includes('mcp_qwen_verify_task'), 'Must have mcp_qwen_verify_task');
    assert.ok(toolNames.includes('mcp_qwen_extract_and_write_files'), 'Must have mcp_qwen_extract_and_write_files');
    assert.ok(toolNames.includes('mcp_qwen_get_config'), 'Must have mcp_qwen_get_config');
    assert.ok(toolNames.includes('mcp_qwen_set_config'), 'Must have mcp_qwen_set_config');

    // Call mcp_qwen_get_config
    sendRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'mcp_qwen_get_config',
        arguments: {}
      }
    });
  } else if (res.id === 3) {
    console.log('✓ Received mcp_qwen_get_config result:');
    const text = res.result?.content?.[0]?.text;
    console.log(text);
    const configData = JSON.parse(text);
    assert.ok(configData.config, 'Config data must exist');
    console.log('✓ All MCP server tests passed successfully!');
    child.kill();
    process.exit(0);
  }
}

// Start handshake
sendRpc({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }
});

setTimeout(() => {
  console.error('Test timed out after 10 seconds');
  child.kill();
  process.exit(1);
}, 10000);

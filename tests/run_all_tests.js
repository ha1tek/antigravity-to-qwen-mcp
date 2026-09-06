const { execSync } = require('child_process');

console.log('=== RUNNING ALL TESTS FOR QWEN MCP ===\n');

try {
  console.log('>>> Running Parser & Writer Tests...');
  execSync('node tests/test_parser.js', { stdio: 'inherit' });
  console.log('\n>>> Running Project Context Tests...');
  execSync('node tests/test_project_context.js', { stdio: 'inherit' });
  console.log('\n>>> Running MCP Protocol & RPC Tests...');
  execSync('node tests/test_server_mcp.js', { stdio: 'inherit' });
  console.log('\n>>> Running Task Persistence & Process Recovery Tests...');
  execSync('node tests/test_task_persistence.js', { stdio: 'inherit' });
  console.log('\n=== ALL TESTS PASSED! ===');
} catch (err) {
  console.error('Test suite failed:', err);
  process.exit(1);
}

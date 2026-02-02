import { executeTool } from '../services/tool-executor';
import { AVAILABLE_TOOLS } from '../config/default-tools';

(async () => {
  const tool = AVAILABLE_TOOLS.find(t => t.id === 'sys_diag_basic');
  if (!tool) {
    console.error('Tool sys_diag_basic not found.');
    process.exit(1);
  }
  console.log('Running test...');
  const result = await executeTool(tool, {});
  console.log('ToolExecutionResult:', result);
})();

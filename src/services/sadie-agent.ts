import { executeTool } from './tool-executor';
import { AVAILABLE_TOOLS } from '../config/default-tools';

export class SadieAgent {
  async processMessage(userText: string): Promise<string> {
    const text = userText.toLowerCase();
    if (text.includes('diagnostic') || text.includes('scan')) {
      const tool = AVAILABLE_TOOLS.find(t => t.id === 'sys_diag_basic');
      if (!tool) {
        return 'Diagnostic tool not found.';
      }
      const result = await executeTool(tool, {});
      return 'I have run the diagnostic. Result: ' + result.output;
    } else {
      return `I received your message: ${userText}. (No tools triggered).`;
    }
  }
}

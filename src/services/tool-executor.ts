
import { ToolDefinition, ToolExecutionResult } from '../shared/types/sadie-tools';
import { spawn } from 'child_process';
import { WorkflowService } from './n8n/workflow-service';
import path from 'path';

  // Handle internal tools
  if (tool.executablePath.startsWith('INTERNAL::')) {
    if (tool.executablePath === 'INTERNAL::list_workflows') {
      return (async () => {
        const workflowService = new WorkflowService();
        const workflowsDir = path.resolve(process.cwd(), 'n8n-workflows');
        try {
          const workflows = await workflowService.loadWorkflows(workflowsDir);
          const summary = workflows.map(wf => ({ id: wf.id, name: wf.name }));
          return {
            toolId: tool.id,
            success: true,
            output: JSON.stringify(summary, null, 2),
            timestamp: Date.now(),
          };
        } catch (err: any) {
          return {
            toolId: tool.id,
            success: false,
            output: '',
            error: err.message,
            timestamp: Date.now(),
          };
        }
      })();
    }
    // Add more internal tools here as needed
  }

  // Default: external tool execution
  return new Promise((resolve) => {
    let command: string;
    let spawnArgs: string[] = [];

    if (tool.executablePath.endsWith('.ps1')) {
      command = 'powershell.exe';
      spawnArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tool.executablePath];
    } else if (tool.executablePath.endsWith('.js')) {
      command = 'node';
      spawnArgs = [tool.executablePath];
    } else {
      command = tool.executablePath;
      spawnArgs = [];
    }

    // Add tool parameters as arguments
    if (tool.parameters && tool.parameters.length > 0) {
      for (const param of tool.parameters) {
        if (args.hasOwnProperty(param.name)) {
          spawnArgs.push(String(args[param.name]));
        }
      }
    }

    const env = tool.envVariables ? { ...process.env, ...tool.envVariables } : process.env;
    const child = spawn(command, spawnArgs, { env });

    let stdout = '';
    let stderr = '';
    const timestamp = Date.now();

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      resolve({
        toolId: tool.id,
        success: false,
        output: stdout,
        error: err.message,
        timestamp,
      });
    });

    child.on('close', (code) => {
      resolve({
        toolId: tool.id,
        success: code === 0,
        output: stdout,
        error: stderr || undefined,
        timestamp,
      });
    });
  });
}

import { ToolDefinition } from '../shared/types/sadie-tools';


export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    id: 'sys_diag_basic',
    name: 'System Diagnostic',
    description: 'Extracts system diagnostics and logs using the existing PowerShell script.',
    executablePath: './scripts/extract-diag.ps1',
    parameters: [],
  },
  {
    id: 'list_workflows',
    name: 'List Workflows',
    description: 'Lists all available n8n workflows in the library. Returns their IDs and Names.',
    executablePath: 'INTERNAL::list_workflows',
    parameters: [],
  },
];

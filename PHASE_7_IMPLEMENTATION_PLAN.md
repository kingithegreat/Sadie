# 🚀 SADIE Phase 7: Electron Widget Development
## Automation Control Center Implementation Plan

## 🎯 Executive Summary

Phase 7 transforms SADIE from a backend automation engine into a user-facing Desktop Automation Platform. We'll create an Electron-based UI that provides safe, controlled access to file operations, system information, and archive management through the validated n8n workflows.

## 🏗️ Architecture Overview

```
┌─────────────────┐    HTTP     ┌─────────────────┐    JSON     ┌─────────────────┐
│   Electron UI   │────────────▶│   n8n Workflows  │────────────▶│ PowerShell APIs │
│                 │             │                 │             │                 │
│ • File Manager  │             │ • file-manager   │             │ • FileOps.ps1   │
│ • System Info   │             │ • system-info    │             │ • SystemInfo.ps1│
│ • Archive Ops   │             │ • archive-ops    │             │ • ArchiveOps.ps1│
│ • Safety Gates  │             │ • SafetyValidation│             │ • SafetyValidation│
└─────────────────┘             └─────────────────┘             └─────────────────┘
```

## 📋 Implementation Roadmap

### Phase 7.1: Core Infrastructure (Week 1)

#### 1.1 n8n HTTP Integration Layer
**File**: `src/main/n8n-client.ts` (NEW)

```typescript
interface N8nWorkflowResponse {
  status: 'success' | 'failure' | 'validation_failed';
  timestamp: string;
  operation: string;
  action?: string;
  data?: any;
  error?: string;
  validation?: {
    validated: boolean;
    policy: string;
  };
}

class N8nClient {
  private baseUrl: string;

  async callWorkflow(workflowName: string, params: any): Promise<N8nWorkflowResponse> {
    const response = await axios.post(`${this.baseUrl}/webhook/${workflowName}`, {
      tool_call: { parameters: params }
    });
    return response.data;
  }
}
```

#### 1.2 UI State Management
**File**: `src/renderer/hooks/useAutomation.ts` (NEW)

```typescript
interface AutomationState {
  isLoading: boolean;
  lastResult: N8nWorkflowResponse | null;
  error: string | null;
}

export function useAutomation() {
  const [state, setState] = useState<AutomationState>({
    isLoading: false,
    lastResult: null,
    error: null
  });

  const executeOperation = async (workflow: string, params: any) => {
    setState({ isLoading: true, lastResult: null, error: null });
    try {
      const result = await window.electron.executeAutomation(workflow, params);
      setState({ isLoading: false, lastResult: result, error: null });
      return result;
    } catch (error) {
      setState({ isLoading: false, lastResult: null, error: error.message });
      throw error;
    }
  };

  return { ...state, executeOperation };
}
```

#### 1.3 IPC Handlers
**File**: `src/main/ipc-handlers.ts` (MODIFY)

```typescript
// Add automation execution handler
ipcMain.handle('execute-automation', async (event, workflowName, params) => {
  const n8nClient = new N8nClient(process.env.N8N_URL || 'http://localhost:5678');
  return await n8nClient.callWorkflow(workflowName, params);
});
```

### Phase 7.2: File Manager Panel (Week 2)

#### 2.1 File Manager Component
**File**: `src/renderer/components/FileManager.tsx` (NEW)

```tsx
interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  last_modified: string;
}

export function FileManager() {
  const { isLoading, lastResult, error, executeOperation } = useAutomation();
  const [currentPath, setCurrentPath] = useState('C:\\Users\\adenk\\Desktop');
  const [files, setFiles] = useState<FileItem[]>([]);

  const loadDirectory = async (path: string) => {
    const result = await executeOperation('file-manager', {
      action: 'list_directory',
      directory_path: path
    });

    if (result.status === 'success') {
      setFiles(result.data.items);
      setCurrentPath(path);
    }
  };

  const readFile = async (filePath: string) => {
    const result = await executeOperation('file-manager', {
      action: 'read_file',
      file_path: filePath
    });

    if (result.status === 'success') {
      // Show file content in modal or editor
      showFileContent(result.data.content);
    }
  };

  return (
    <div className="file-manager">
      <div className="path-bar">
        <input
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
        />
        <button onClick={() => loadDirectory(currentPath)}>Load</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="file-list">
        {files.map(file => (
          <div key={file.name} className="file-item">
            <span className="file-icon">{file.type === 'directory' ? '📁' : '📄'}</span>
            <span className="file-name">{file.name}</span>
            <span className="file-size">{file.size ? formatBytes(file.size) : ''}</span>
            <div className="file-actions">
              {file.type === 'directory' ? (
                <button onClick={() => loadDirectory(`${currentPath}\\${file.name}`)}>
                  Open
                </button>
              ) : (
                <button onClick={() => readFile(`${currentPath}\\${file.name}`)}>
                  Read
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 2.2 File Operations Modal
**File**: `src/renderer/components/FileOperationsModal.tsx` (NEW)

```tsx
interface FileOperation {
  type: 'read' | 'write' | 'delete' | 'move';
  path: string;
  content?: string;
  destination?: string;
}

export function FileOperationsModal({ operation, onClose, onExecute }) {
  const [params, setParams] = useState<FileOperation>(operation);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const requiresConfirmation = ['delete', 'move'].includes(params.type);

  const handleExecute = async () => {
    if (requiresConfirmation && !showConfirmation) {
      setShowConfirmation(true);
      return;
    }

    await onExecute('file-manager', {
      action: `${params.type}_file`,
      file_path: params.path,
      content: params.content,
      destination: params.destination,
      user_confirmed: showConfirmation
    });

    onClose();
  };

  return (
    <Modal>
      <h3>{params.type.toUpperCase()} FILE</h3>

      <div className="form-group">
        <label>Path:</label>
        <input
          value={params.path}
          onChange={(e) => setParams({...params, path: e.target.value})}
        />
      </div>

      {params.type === 'write' && (
        <div className="form-group">
          <label>Content:</label>
          <textarea
            value={params.content}
            onChange={(e) => setParams({...params, content: e.target.value})}
          />
        </div>
      )}

      {params.type === 'move' && (
        <div className="form-group">
          <label>Destination:</label>
          <input
            value={params.destination}
            onChange={(e) => setParams({...params, destination: e.target.value})}
          />
        </div>
      )}

      {showConfirmation && (
        <div className="confirmation-banner">
          ⚠️ This operation requires confirmation. Are you sure?
        </div>
      )}

      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button onClick={handleExecute} className="primary">
          {showConfirmation ? 'Confirm & Execute' : 'Execute'}
        </button>
      </div>
    </Modal>
  );
}
```

### Phase 7.3: System Info Panel (Week 3)

#### 3.1 System Info Dashboard
**File**: `src/renderer/components/SystemInfoDashboard.tsx` (NEW)

```tsx
interface SystemInfo {
  manufacturer: string;
  os_name: string;
  os_version: string;
  total_memory_gb: number;
  logical_processors: number;
  uptime_hours: number;
}

interface DiskInfo {
  name: string;
  used_gb: number;
  free_gb: number;
  total_gb: number;
  percent_used: number;
}

export function SystemInfoDashboard() {
  const { isLoading, lastResult, executeOperation } = useAutomation();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [diskInfo, setDiskInfo] = useState<DiskInfo[]>([]);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  const loadSystemInfo = async () => {
    const result = await executeOperation('system-info', {
      action: 'get_all_info'
    });

    if (result.status === 'success') {
      setSystemInfo(result.data.system);
      setDiskInfo(result.data.disk);
    }
  };

  return (
    <div className="system-info-dashboard">
      <div className="dashboard-header">
        <h2>System Information</h2>
        <button onClick={loadSystemInfo} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {systemInfo && (
        <div className="info-cards">
          <div className="info-card">
            <h3>System</h3>
            <div className="card-content">
              <div className="info-row">
                <span className="label">OS:</span>
                <span className="value">{systemInfo.os_name} {systemInfo.os_version}</span>
              </div>
              <div className="info-row">
                <span className="label">Manufacturer:</span>
                <span className="value">{systemInfo.manufacturer}</span>
              </div>
              <div className="info-row">
                <span className="label">Uptime:</span>
                <span className="value">{systemInfo.uptime_hours.toFixed(1)} hours</span>
              </div>
            </div>
          </div>

          <div className="info-card">
            <h3>Hardware</h3>
            <div className="card-content">
              <div className="info-row">
                <span className="label">CPU Cores:</span>
                <span className="value">{systemInfo.logical_processors}</span>
              </div>
              <div className="info-row">
                <span className="label">Memory:</span>
                <span className="value">{systemInfo.total_memory_gb} GB</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="disk-info">
        <h3>Disk Usage</h3>
        <div className="disk-list">
          {diskInfo.map(disk => (
            <div key={disk.name} className="disk-item">
              <div className="disk-header">
                <span className="disk-name">{disk.name}</span>
                <span className="disk-percent">{disk.percent_used}% used</span>
              </div>
              <div className="disk-bar">
                <div
                  className="disk-bar-fill"
                  style={{ width: `${disk.percent_used}%` }}
                />
              </div>
              <div className="disk-details">
                <span>{disk.used_gb.toFixed(1)} GB used</span>
                <span>{disk.free_gb.toFixed(1)} GB free</span>
                <span>{disk.total_gb.toFixed(1)} GB total</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Phase 7.4: Archive Operations Panel (Week 4)

#### 4.1 Archive Manager Component
**File**: `src/renderer/components/ArchiveManager.tsx` (NEW)

```tsx
interface ArchiveEntry {
  name: string;
  size_bytes: number;
  compressed_size: number;
  last_modified: string;
}

export function ArchiveManager() {
  const { isLoading, lastResult, executeOperation } = useAutomation();
  const [archivePath, setArchivePath] = useState('');
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [operation, setOperation] = useState<'list' | 'extract' | 'create' | null>(null);

  const listArchive = async () => {
    const result = await executeOperation('archive-ops', {
      action: 'list_archive',
      archive_path: archivePath
    });

    if (result.status === 'success') {
      setEntries(result.data.entries);
    }
  };

  const extractArchive = async (destination: string) => {
    const result = await executeOperation('archive-ops', {
      action: 'extract_archive',
      archive_path: archivePath,
      destination: destination,
      user_confirmed: true
    });

    if (result.status === 'success') {
      alert('Archive extracted successfully');
    }
  };

  const createArchive = async (sourcePath: string, files: string[]) => {
    const result = await executeOperation('archive-ops', {
      action: 'create_archive',
      source_path: sourcePath,
      files: files,
      destination: archivePath,
      user_confirmed: true
    });

    if (result.status === 'success') {
      alert('Archive created successfully');
    }
  };

  return (
    <div className="archive-manager">
      <div className="archive-controls">
        <input
          type="text"
          placeholder="Archive path (e.g., C:\backup.zip)"
          value={archivePath}
          onChange={(e) => setArchivePath(e.target.value)}
        />

        <div className="action-buttons">
          <button onClick={() => setOperation('list')}>List Contents</button>
          <button onClick={() => setOperation('extract')}>Extract</button>
          <button onClick={() => setOperation('create')}>Create</button>
        </div>
      </div>

      {operation === 'list' && (
        <div className="archive-contents">
          <h3>Archive Contents</h3>
          <div className="entries-list">
            {entries.map(entry => (
              <div key={entry.name} className="archive-entry">
                <span className="entry-name">{entry.name}</span>
                <span className="entry-size">{formatBytes(entry.size_bytes)}</span>
                <span className="entry-modified">{new Date(entry.last_modified).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {operation === 'extract' && (
        <ExtractModal
          onExtract={(dest) => extractArchive(dest)}
          onClose={() => setOperation(null)}
        />
      )}

      {operation === 'create' && (
        <CreateModal
          onCreate={(source, files) => createArchive(source, files)}
          onClose={() => setOperation(null)}
        />
      )}
    </div>
  );
}
```

### Phase 7.5: Main Application Integration (Week 5)

#### 5.1 App Router with Automation Mode
**File**: `src/renderer/App.tsx` (MODIFY)

```tsx
enum AppMode {
  CHAT = 'chat',
  AUTOMATION = 'automation'
}

const App: React.FC<AppProps> = ({ initialMessages }) => {
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);

  return (
    <div className="app">
      <div className="mode-switcher">
        <button
          className={mode === AppMode.CHAT ? 'active' : ''}
          onClick={() => setMode(AppMode.CHAT)}
        >
          💬 Chat
        </button>
        <button
          className={mode === AppMode.AUTOMATION ? 'active' : ''}
          onClick={() => setMode(AppMode.AUTOMATION)}
        >
          ⚙️ Automation
        </button>
      </div>

      {mode === AppMode.CHAT ? (
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          streamingState={streamingState}
        />
      ) : (
        <AutomationCenter />
      )}
    </div>
  );
};
```

#### 5.2 Automation Center Container
**File**: `src/renderer/components/AutomationCenter.tsx` (NEW)

```tsx
export function AutomationCenter() {
  const [activeTab, setActiveTab] = useState<'files' | 'system' | 'archive'>('files');

  return (
    <div className="automation-center">
      <div className="automation-header">
        <h1>🛠️ SADIE Automation Control Center</h1>
        <p>Safe, validated desktop automation through n8n workflows</p>
      </div>

      <div className="automation-tabs">
        <button
          className={activeTab === 'files' ? 'active' : ''}
          onClick={() => setActiveTab('files')}
        >
          📁 File Manager
        </button>
        <button
          className={activeTab === 'system' ? 'active' : ''}
          onClick={() => setActiveTab('system')}
        >
          💻 System Info
        </button>
        <button
          className={activeTab === 'archive' ? 'active' : ''}
          onClick={() => setActiveTab('archive')}
        >
          📦 Archive Ops
        </button>
      </div>

      <div className="automation-content">
        {activeTab === 'files' && <FileManager />}
        {activeTab === 'system' && <SystemInfoDashboard />}
        {activeTab === 'archive' && <ArchiveManager />}
      </div>

      <div className="automation-footer">
        <div className="safety-indicator">
          <span className="safety-icon">🛡️</span>
          <span>All operations validated through Phase 6 safety layer</span>
        </div>
      </div>
    </div>
  );
}
```

## 🎨 UI/UX Design Principles

### Safety-First Design
- **Red error banners** for validation failures
- **Yellow warning banners** for confirmation-required operations
- **Green success indicators** for completed operations
- **Clear path display** before destructive operations

### Consistent Interaction Patterns
- **Load/Refresh buttons** for data fetching
- **Modal confirmations** for destructive actions
- **Progress indicators** during operations
- **Structured result display** with timestamps

### Accessibility & Usability
- **Keyboard navigation** support
- **Clear visual hierarchy** with proper spacing
- **Responsive design** for different window sizes
- **Helpful tooltips** and validation messages

## 🧪 Testing Strategy

### Unit Tests
```typescript
// src/renderer/components/__tests__/FileManager.test.tsx
describe('FileManager', () => {
  it('loads directory contents successfully', async () => {
    const mockResult = {
      status: 'success',
      data: { items: [{ name: 'test.txt', type: 'file' }] }
    };

    mockedExecuteOperation.mockResolvedValue(mockResult);

    render(<FileManager />);
    fireEvent.click(screen.getByText('Load'));

    await waitFor(() => {
      expect(screen.getByText('test.txt')).toBeInTheDocument();
    });
  });
});
```

### Integration Tests
```typescript
// e2e/automation-center.spec.ts
test('file manager workflow', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('text=⚙️ Automation');

  // Navigate to file manager
  await page.click('text=📁 File Manager');

  // Load directory
  await page.fill('input[placeholder*="directory path"]', 'C:\\Users\\adenk\\Desktop');
  await page.click('text=Load');

  // Verify files are displayed
  await expect(page.locator('.file-item')).toHaveCountGreaterThan(0);
});
```

### E2E Validation Tests
- **Happy path operations** (read, list, system info)
- **Error handling** (invalid paths, permission denied)
- **Safety validation** (blocked operations, confirmations)
- **Performance** (large directory listings, system scans)

## 📋 Phase 7 Checklist

### ✅ Infrastructure
- [ ] n8n HTTP client implementation
- [ ] IPC handlers for automation execution
- [ ] UI state management hooks
- [ ] Error handling and validation display

### ✅ File Manager Panel
- [ ] Directory browsing interface
- [ ] File read/write operations
- [ ] Move/delete with confirmations
- [ ] Path validation and safety indicators
- [ ] File content viewer/editor

### ✅ System Info Panel
- [ ] Hardware information display
- [ ] Disk usage visualization
- [ ] Memory and CPU monitoring
- [ ] Refresh and auto-update capabilities

### ✅ Archive Operations Panel
- [ ] Archive content listing
- [ ] Extract operations with path validation
- [ ] Create archive from file selections
- [ ] Progress indicators and error handling

### ✅ Main Application Integration
- [ ] Mode switcher (Chat ↔ Automation)
- [ ] Consistent navigation and layout
- [ ] Settings integration
- [ ] Status indicators

### ✅ Testing & Validation
- [ ] Unit tests for all components
- [ ] Integration tests for n8n workflows
- [ ] E2E tests for complete user flows
- [ ] Performance and error handling tests

### ✅ Documentation & Release
- [ ] User guide for automation features
- [ ] API documentation updates
- [ ] Release notes for v0.9.0
- [ ] Migration guide from direct tool calls

## 🚀 Release Plan

### v0.9.0 — Automation UI Release
**Tag Message**: `v0.9.0 — Automation Control Center with validated n8n workflow integration`

**Release Notes**:
```
🎉 SADIE v0.9.0: Desktop Automation Platform

✨ New Features
• Automation Control Center UI
• File Manager with safe operations
• System Information Dashboard
• Archive Operations Panel
• n8n workflow integration layer

🛡️ Security
• Phase 6 safety validation enforcement
• Path whitelisting and confirmation flows
• Centralized security through PowerShell APIs

🔧 Technical
• HTTP-based workflow execution
• Structured JSON response handling
• Modal-based operation confirmations
• Comprehensive error handling and user feedback
```

## 🎯 Success Criteria

- **User can safely browse and manipulate files** through validated workflows
- **System information is displayed** in an intuitive dashboard format
- **Archive operations work reliably** with proper safety checks
- **All operations show clear success/failure feedback** with timestamps
- **UI prevents unsafe operations** through validation and confirmations
- **Performance is acceptable** for typical desktop automation tasks
- **Error handling is graceful** with helpful user messages

## 🔄 Next Steps After Phase 7

**Phase 8**: Advanced Features
- Bulk operations
- Scheduled automation
- Custom workflow builder
- Export/import capabilities

**Phase 9**: Production Polish
- Performance optimization
- Advanced error recovery
- User preference persistence
- Accessibility improvements

---

**Phase 7 Status**: Ready for implementation
**Estimated Duration**: 5 weeks
**Risk Level**: Medium (requires UI/UX design and n8n integration)
**Dependencies**: Phase 6.1 workflows, n8n running
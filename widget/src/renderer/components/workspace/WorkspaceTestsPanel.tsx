import { useEffect, useState } from 'react';
import type { WorkspaceDiscoveredTest, WorkspaceTestRequest, WorkspaceTestResult } from '../../../shared/workspace-test-types';
export default function WorkspaceTestsPanel({ root, onOpenFile }: { root: string; onOpenFile: (path: string, line?: number) => void }) {
  const api = window.electron as any; const [tests, setTests] = useState<WorkspaceDiscoveredTest[]>([]); const [state, setState] = useState<WorkspaceTestResult | null>(null); const [error, setError] = useState(''); const [coverage, setCoverage] = useState(false);
  const request = async (action: WorkspaceTestRequest['action'], extra: Partial<WorkspaceTestRequest> = {}) => {
    try { const result = await api?.workspaceTests?.({ root, action, ...extra }); if (!result?.success) setError(result?.error || 'Tests are unavailable in this build.'); else { setError(''); if (result.tests) setTests(result.tests); else setState(result); } } catch (error) { setError(String(error)); }
  };
  useEffect(() => {
    let current = true; void request('list');
    const timer = setInterval(() => { void api?.workspaceTests?.({ root, action: 'state' }).then((result: WorkspaceTestResult) => { if (current && result.success) setState(result); }).catch(() => {}); }, 700);
    return () => { current = false; clearInterval(timer); };
  // The project determines discovery and active runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  return <section aria-label="Tests" style={{ padding: 8, overflow: 'auto' }}>
    <p>Discovered Node, Jest and Vitest tests. Test code runs after confirmation; no dependencies are downloaded. Dynamic declarations can run as a complete file.</p>
    <button onClick={() => void request('list')}>Refresh tests</button><button disabled={!state?.running} onClick={() => void request('stop')}>Stop tests</button><label><input type="checkbox" checked={coverage} onChange={event => setCoverage(event.target.checked)} />Collect coverage (requires this runner's coverage support)</label>
    {error && <p role="alert">{error}</p>}
    {tests.map((test, index) => <div key={`${test.path}:${test.name}:${index}`}><button onClick={() => onOpenFile(test.path, test.line)}>{test.name}{test.skipped ? ' (skipped)' : ''}</button><small> {test.runner} — {test.path}</small><button disabled={state?.running || test.skipped} onClick={() => void request('run', { file: test.path, testName: test.name, coverage })}>Run test</button><button disabled={state?.running} onClick={() => void request('run', { file: test.path, coverage })}>Run file</button></div>)}
    {!tests.length && <p>No supported test files found. Use .test.js/.ts or .spec.js/.ts files.</p>}
    <p role="status">{state?.running ? 'Tests running…' : state?.exitCode !== null && state?.exitCode !== undefined ? `Process exited ${state.exitCode}` : 'Ready'}</p>{state?.summary && <p>{state.summary.passed} passed, {state.summary.failed} failed, {state.summary.skipped} skipped</p>}{state?.note && <p>{state.note}</p>}{state?.coveragePath && <p>Coverage files: {state.coveragePath}</p>}
    <pre style={{ whiteSpace: 'pre-wrap' }}>{state?.output || ''}</pre>
  </section>;
}

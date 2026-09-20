import { useCallback, useEffect, useState } from 'react';
import type { WorkspacePackageTask, WorkspaceProblem } from '../../../shared/types';

export default function ProblemsPanel({
  root,
  onOpenFile,
  onStatus,
}: {
  root: string;
  onOpenFile: (path: string, line?: number) => void;
  onStatus?: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<WorkspacePackageTask[]>([]);
  const [selected, setSelected] = useState('');
  const [problems, setProblems] = useState<WorkspaceProblem[]>([]);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState('');
  const api = window.electron;

  const refresh = useCallback(async () => {
    const result = await api.workspaceTaskList?.({ projectDir: root });
    if (!result?.success) {
      setTasks([]);
      setSelected('');
      setError(result?.error || 'Could not load package scripts.');
      return;
    }
    setError('');
    setTasks(result.tasks || []);
    setSelected(current => result.tasks?.some(task => task.name === current) ? current : (result.tasks?.[0]?.name || ''));
  }, [api, root]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async () => {
    if (!selected || running) return;
    setRunning(true);
    setError('');
    setOutput('');
    const result = await api.workspaceTaskRun?.({ projectDir: root, scriptName: selected });
    setRunning(false);
    if (!result) { setError('Package tasks are unavailable.'); return; }
    if (result.cancelled) { onStatus?.('Task cancelled.'); return; }
    setProblems(result.problems || []);
    setOutput(result.outputExcerpt || '');
    if (!result.success && result.error) setError(result.error);
    const code = result.exitCode == null ? '' : ` (exit ${result.exitCode})`;
    onStatus?.(`${selected}: ${result.problems?.length || 0} problem${result.problems?.length === 1 ? '' : 's'}${code}`);
  };

  return (
    <div className="ws-problems">
      <div className="ws-problems-controls">
        <select aria-label="Package script" value={selected} onChange={event => setSelected(event.target.value)} disabled={running || !tasks.length}>
          {!tasks.length && <option value="">No package scripts</option>}
          {tasks.map(task => <option key={task.name} value={task.name}>{task.name}</option>)}
        </select>
        <button type="button" onClick={() => void run()} disabled={!selected || running}>{running ? 'Running…' : 'Run'}</button>
        <button type="button" onClick={() => void refresh()} disabled={running} aria-label="Refresh package scripts">Refresh</button>
      </div>
      <div className="ws-problems-consent">HomeBot shows the exact package.json command and npm lifecycle scripts before running anything.</div>
      {error && <div className="ws-problems-error" role="alert">{error}</div>}
      <div className="ws-problems-count">{problems.length} problem{problems.length === 1 ? '' : 's'}</div>
      <div className="ws-problems-list">
        {problems.map((problem, index) => (
          <button
            type="button"
            className={`ws-problem ${problem.severity}`}
            key={`${problem.path}:${problem.line}:${problem.column}:${index}`}
            onClick={() => problem.clickable !== false && problem.path && onOpenFile(problem.path, problem.line)}
            disabled={problem.clickable === false || !problem.path}
            title={`${problem.path}:${problem.line}:${problem.column}`}
          >
            <span className="ws-problem-message">{problem.message}</span>
            <span className="ws-problem-location">{problem.file}:{problem.line}:{problem.column} · {problem.source}{problem.code ? ` ${problem.code}` : ''}</span>
          </button>
        ))}
      </div>
      {output && <details className="ws-problems-output"><summary>Task output</summary><pre>{output}</pre></details>}
    </div>
  );
}

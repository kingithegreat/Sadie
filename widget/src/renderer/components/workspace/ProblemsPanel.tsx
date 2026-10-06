import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [longRunning, setLongRunning] = useState(false);
  const taskId = useRef<string | null>(null);
  const api = window.electron as any;

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
  useEffect(() => {
    let alive = true;
    taskId.current = null; setRunning(false); setOutput(''); setProblems([]);
    const update = (task: any) => {
      if (!alive || task.projectDir !== root) return;
      taskId.current = task.taskId; setRunning(task.running); setSelected(task.scriptName);
      setOutput(task.outputExcerpt || ''); setProblems(task.problems || []);
      if (task.result?.error && !task.result.cancelled) setError(task.result.error);
    };
    const off = api?.onWorkspaceTaskEvent?.(update);
    void api?.workspaceTaskStatus?.({ projectDir: root }).then((res: any) => { if (res?.task) update(res.task); });
    return () => { alive = false; off?.(); };
  }, [api, root]);

  const run = async () => {
    if (!selected || running) return;
    setRunning(true);
    setError('');
    setOutput('');
    const submittedId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    taskId.current = submittedId;
    try {
      const result = await api.workspaceTaskRun?.({ projectDir: root, scriptName: selected, taskId: taskId.current, longRunning });
      if (taskId.current !== submittedId) return;
      if (!result) { setError('Package tasks are unavailable.'); return; }
      if (result.cancelled) { onStatus?.('Task cancelled.'); return; }
      setProblems(result.problems || []);
      setOutput(result.outputExcerpt || '');
      if (!result.success && result.error) setError(result.error);
      const code = result.exitCode == null ? '' : ` (exit ${result.exitCode})`;
      onStatus?.(`${selected}: ${result.problems?.length || 0} problem${result.problems?.length === 1 ? '' : 's'}${code}`);
    } catch {
      if (taskId.current === submittedId) setError('Could not run the package task. Refresh the scripts and try again.');
    } finally {
      if (taskId.current === submittedId) setRunning(false);
    }
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
        {running && <button type="button" onClick={() => { void api?.workspaceTaskStop?.({ taskId: taskId.current }).then((res: any) => { if (!res?.success) setError(res?.error || 'Could not stop this task.'); else onStatus?.('Stopping task…'); }); }}>Stop</button>}
      </div>
      <label><input type="checkbox" checked={longRunning} disabled={running} onChange={e => setLongRunning(e.target.checked)} />Watch or dev server (runs until Stop)</label>
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
      {output && <details className="ws-problems-output" open={running}><summary>Task output{running ? ' (live)' : ''}</summary><pre aria-label="Task output">{output}</pre></details>}
    </div>
  );
}

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
  const [cleanupPending, setCleanupPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [output, setOutput] = useState('');
  const [longRunning, setLongRunning] = useState(false);
  const taskId = useRef<string | null>(null);
  const lifecycle = useRef(0);
  const api = window.electron as any;
  useEffect(() => { lifecycle.current++; return () => { lifecycle.current++; taskId.current = null; }; }, [root]);

  const refresh = useCallback(async () => {
    const generation = lifecycle.current;
    try {
    const result = await api.workspaceTaskList?.({ projectDir: root });
    if (generation !== lifecycle.current) return;
    if (!result?.success) {
      setTasks([]);
      setSelected('');
      setError(result?.error || 'Could not load package scripts.');
      return;
    }
    setError('');
    setTasks(result.tasks || []);
    setSelected(current => result.tasks?.some((task: WorkspacePackageTask) => task.name === current) ? current : (result.tasks?.[0]?.name || ''));
    } catch { if (generation === lifecycle.current) setError('Could not load package scripts. Select Refresh to try again.'); }
  }, [api, root]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    let alive = true;
    taskId.current = null; setRunning(false); setCleanupPending(false); setStopping(false); setOutput(''); setProblems([]);
    const update = (task: any) => {
      if (!alive || task.projectDir !== root || (taskId.current && taskId.current !== task.taskId)) return;
      taskId.current = task.taskId; setRunning(task.running); setSelected(task.scriptName);
      setCleanupPending(task.cleanupPending === true || task.result?.cleanupPending === true);
      setOutput(task.outputExcerpt || ''); setProblems(task.problems || []);
      if (task.result?.error && (!task.result.cancelled || task.cleanupPending)) setError(task.result.error);
    };
    const off = api?.onWorkspaceTaskEvent?.(update);
    void Promise.resolve(api?.workspaceTaskStatus?.({ projectDir: root })).then((res: any) => { if (res?.task) update(res.task); }).catch(() => { if (alive) setError('Could not restore the task status. Refresh or try again.'); });
    return () => { alive = false; off?.(); };
  }, [api, root]);

  const run = async () => {
    if (!selected || running || cleanupPending || stopping) return;
    setRunning(true);
    setError('');
    setOutput('');
    const submittedId = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    taskId.current = submittedId;
    try {
      const result = await api.workspaceTaskRun?.({ projectDir: root, scriptName: selected, taskId: taskId.current, longRunning });
      if (taskId.current !== submittedId) return;
      if (!result) { setError('Package tasks are unavailable.'); return; }
      setCleanupPending(result.cleanupPending === true);
      if (result.cleanupPending) setError(result.error || 'Owned background programs remain. Select Stop to clean them up.');
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
  const stop = async () => {
    const submittedId = taskId.current;
    if (!submittedId || stopping) return;
    setStopping(true);
    try {
      const res = await api?.workspaceTaskStop?.({ taskId: submittedId });
      if (taskId.current !== submittedId) return;
      if (!res?.success) setError(res?.error || 'Could not stop this task.');
      else { setCleanupPending(false); setError(''); onStatus?.('Task cleanup confirmed.'); }
    } catch { if (taskId.current === submittedId) setError('Could not stop this task. Try Stop again.'); }
    finally { if (taskId.current === submittedId) setStopping(false); }
  };

  return (
    <div className="ws-problems">
      <div className="ws-problems-controls">
        <select aria-label="Package script" value={selected} onChange={event => setSelected(event.target.value)} disabled={running || cleanupPending || stopping || !tasks.length}>
          {!tasks.length && <option value="">No package scripts</option>}
          {tasks.map(task => <option key={task.name} value={task.name}>{task.name}</option>)}
        </select>
        <button type="button" onClick={() => void run()} disabled={!selected || running || cleanupPending || stopping}>{running ? 'Running…' : 'Run'}</button>
        <button type="button" onClick={() => void refresh()} disabled={running} aria-label="Refresh package scripts">Refresh</button>
        {(running || cleanupPending) && <button type="button" disabled={stopping} onClick={() => { void stop(); }}>Stop</button>}
      </div>
      <label><input type="checkbox" checked={longRunning} disabled={running || cleanupPending || stopping} onChange={e => setLongRunning(e.target.checked)} />Watch or dev server (runs until Stop)</label>
      {cleanupPending && <div role="status">Owned background programs require cleanup. Stop remains available for retry.</div>}
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

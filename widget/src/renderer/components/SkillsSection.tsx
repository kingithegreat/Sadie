/**
 * SkillsSection — the visible surface for skills.
 *
 * Skills are markdown files in a folder. Without this list, that folder is
 * invisible: the feature works but nobody knows it exists, which is exactly how
 * several capabilities in this app ended up shipped-but-unused. This does the
 * minimum that makes it real — show what loaded, show where it lives, and open
 * the folder so editing one is a click away rather than a path to memorise.
 */

import { useCallback, useEffect, useState } from 'react';

interface SkillRow {
  name: string;
  description: string;
  whenToUse: string | null;
  tools: string[] | null;
  path: string;
}

export default function SkillsSection() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [dir, setDir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const api = (window as any).electron;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api?.skillsList?.();
      if (res?.success) {
        setSkills(res.skills || []);
        setDir(res.dir || '');
        setError(null);
      } else {
        setError(res?.error || 'Could not read skills.');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not read skills.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title sp-section-title">Skills</h3>

      <p className="settings-hint">
        A skill is a saved recipe HomeBot follows for a task. Each one is a
        markdown file you can edit — no rebuild needed. Add a folder with a
        SKILL.md inside it and press Refresh.
      </p>

      {loading && <p className="settings-hint">Loading…</p>}
      {error && <p className="settings-error">{error}</p>}

      {!loading && !error && skills.length === 0 && (
        <p className="settings-hint">
          No skills installed yet. Open the folder to add one.
        </p>
      )}

      {skills.length > 0 && (
        <ul className="skills-list">
          {skills.map(s => (
            <li key={s.path} className="skills-item">
              <div className="skills-item-name">{s.name}</div>
              <div className="skills-item-desc">{s.description}</div>
              {s.tools && s.tools.length > 0 && (
                <div className="skills-item-tools">Uses: {s.tools.join(', ')}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="settings-row-buttons">
        <button className="button" onClick={() => void refresh()}>Refresh</button>
        <button className="button" onClick={() => void api?.skillsOpenFolder?.()}>
          Open skills folder
        </button>
      </div>

      {dir && <p className="settings-hint settings-path">{dir}</p>}
    </div>
  );
}

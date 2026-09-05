/**
 * ancient-pathways.ts — Bridge to the Ancient Pathways video essay & animation engine.
 *
 * Connects HomeBot's Media Studio to the standalone Python production pipeline
 * at `Ancient Pathways/`. Drives staged episode renders (script -> voice ->
 * shots -> keyframes -> anim -> render), monitors the `workspace/render.lock`
 * mutex to protect against concurrent execution, streams real-time stage
 * progress, and maps final 1080p MP4 deliverables directly into HomeBot's
 * Media Studio review player.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';

export interface AncientPathwaysEpisode {
  id: string;
  code: string;
  season: number;
  title: string;
  era: string;
  mainCharacter: string;
  sceneCount: number;
  thumbnail?: string;
  emoji: string;
  summary: string;
}

/**
 * Maps technical pipeline stages to friendly, zero-jargon plain English.
 */
export function humanizeStage(stageName: string, status?: string): string {
  const map: Record<string, string> = {
    script: 'Writing story & scenes',
    voice: 'Recording character voices',
    shots: 'Setting up historical backgrounds',
    keyframes: 'Posing characters & expressions',
    anim: 'Animating characters & mouth sync',
    render: 'Creating final 1080p video with music',
    doctor: 'Checking video & sound quality',
  };

  const friendly = map[stageName.toLowerCase()] || `Working on ${stageName}`;
  if (status && ['done', 'ok'].includes(status.toLowerCase())) {
    return `Completed: ${friendly}`;
  }
  return friendly;
}

/**
 * The 9 canonical production episodes across Season 1 and Season 2.
 * Mirrors `pipeline/episodes/__init__.py` in Ancient Pathways.
 */
export const ANCIENT_PATHWAYS_EPISODES: AncientPathwaysEpisode[] = [
  {
    id: 'egypt',
    code: 'EP01',
    season: 1,
    title: 'Ancient Egypt: The Secret of the Pyramid Builders',
    era: '2500 BCE (Old Kingdom Egypt)',
    mainCharacter: 'Master Architect Imhotep',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_01_Thumbnail.png',
    emoji: '🏺',
    summary: 'How Imhotep engineered the first stone pyramid in history.',
  },
  {
    id: 'greece',
    code: 'EP02',
    season: 1,
    title: 'Ancient Greece: Socrates & The Birth of Democracy',
    era: '430 BCE (Classical Athens)',
    mainCharacter: 'Philosopher Socrates',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_02_Thumbnail.png',
    emoji: '🏛️',
    summary: 'Socrates challenges Athenian thinkers at the dawn of democracy.',
  },
  {
    id: 'rome',
    code: 'EP03',
    season: 1,
    title: "The Roman Empire: Colosseum Engineering & Caesar's Concrete",
    era: '80 CE (Flavian Rome)',
    mainCharacter: 'Master Engineer Vitruvius',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_03_Thumbnail.png',
    emoji: '⚔️',
    summary: 'How revolutionary Roman concrete and aqueducts built an empire.',
  },
  {
    id: 'japan',
    code: 'EP04',
    season: 1,
    title: 'Feudal Japan: Master Swordsmiths & The Samurai Code',
    era: '1300 CE (Kamakura Japan)',
    mainCharacter: 'Master Swordsmith Masamune',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_04_Thumbnail.png',
    emoji: '🏯',
    summary: 'Master swordsmith Masamune crafts katana under the Bushido code.',
  },
  {
    id: 'maya',
    code: 'EP05',
    season: 1,
    title: 'The Ancient Maya: Solar Pyramids & Rainforest Astronomy',
    era: '900 CE (Terminal Classic Maya)',
    mainCharacter: 'High Astronomer-Priest Kukulkan',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_05_Thumbnail.png',
    emoji: '🗿',
    summary: 'Rainforest astronomers map the cosmos above massive step pyramids.',
  },
  {
    id: 'babylon',
    code: 'EP06',
    season: 2,
    title: "Babylon: The Ishtar Gate & the World's Oldest Law",
    era: '575 BCE (Neo-Babylonian Empire)',
    mainCharacter: 'King Nebuchadnezzar II',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_06_Thumbnail.png',
    emoji: '🦁',
    summary: 'The brilliant glazed blue Ishtar Gate and the earliest written law.',
  },
  {
    id: 'vikings',
    code: 'EP07',
    season: 2,
    title: 'Viking Scandinavia: Longships, Sunstones & Bog Iron',
    era: '1000 CE (Late Norse Age)',
    mainCharacter: 'Leif Erikson',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_07_Thumbnail.png',
    emoji: '⛵',
    summary: 'Navigating wild stormy seas with sunstones to reach new worlds.',
  },
  {
    id: 'china',
    code: 'EP08',
    season: 2,
    title: 'Ancient China: The Great Wall & the Terracotta Army',
    era: '215 BCE (Qin Dynasty)',
    mainCharacter: 'General Meng Tian',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_08_Thumbnail.png',
    emoji: '🐉',
    summary: 'Defending the realm along the massive Great Wall of China.',
  },
  {
    id: 'indus',
    code: 'EP09',
    season: 2,
    title: 'The Indus Valley: The First Cities With Plumbing',
    era: '2300 BCE (Mature Harappan Period)',
    mainCharacter: 'Dhara, city planner of Mohenjo-daro',
    sceneCount: 14,
    thumbnail: 'Ancient_Pathways_Episode_09_Thumbnail.png',
    emoji: '🌊',
    summary: 'The world’s first planned modern cities with running water systems.',
  },
];

/**
 * Resolves the location of the Ancient Pathways repository.
 * Searches:
 *  1. ANCIENT_PATHWAYS_DIR env var
 *  2. ~/Desktop/Ancient Pathways
 *  3. Adjacent sibling folder to HomeBot
 */
export function resolveAncientPathwaysDir(): string | null {
  const candidates: string[] = [];

  if (process.env.ANCIENT_PATHWAYS_DIR) {
    candidates.push(process.env.ANCIENT_PATHWAYS_DIR);
  }

  try {
    const desktopPath = path.join(os.homedir(), 'Desktop', 'Ancient Pathways');
    candidates.push(desktopPath);
  } catch {
    /* homedir lookup failed */
  }

  try {
    candidates.push(path.resolve(process.cwd(), '..', 'Ancient Pathways'));
    candidates.push(path.resolve(app.getAppPath(), '..', '..', 'Ancient Pathways'));
  } catch {
    /* app path lookup failed */
  }

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'run_pipeline.py'))) {
        return path.resolve(dir);
      }
    } catch {
      /* continue looking */
    }
  }

  return null;
}

export interface RenderLockStatus {
  locked: boolean;
  pid?: number;
  ageSec?: number;
  message?: string;
}

/**
 * Checks `workspace/render.lock` inside the Ancient Pathways workspace.
 * Mirrors `acquire_lock()` from `scripts/produce_any.py` and `run_pipeline.py`.
 */
export function checkRenderLock(ancientPathwaysDir: string): RenderLockStatus {
  const lockFile = path.join(ancientPathwaysDir, 'workspace', 'render.lock');
  if (!fs.existsSync(lockFile)) {
    return { locked: false };
  }

  try {
    const raw = fs.readFileSync(lockFile, 'utf8');
    const data = JSON.parse(raw);
    const pid = typeof data?.pid === 'number' ? data.pid : undefined;
    const ts = typeof data?.ts === 'number' ? data.ts : 0;
    const nowSec = Date.now() / 1000;
    const ageSec = Math.max(0, Math.round(nowSec - ts));

    // If lock is older than 6 hours, it's considered stale upstream
    if (ageSec > 6 * 3600) {
      return { locked: false, message: 'Stale lock (>6h old)' };
    }

    return {
      locked: true,
      pid,
      ageSec,
      message: `Another render is active (PID ${pid ?? 'unknown'}, running for ${Math.round(ageSec / 60)}m)`,
    };
  } catch {
    return { locked: false, message: 'Unreadable lock file' };
  }
}

/**
 * Locates the finished 1080p deliverable for an episode.
 */
export function findEpisodeDeliverable(ancientPathwaysDir: string, episodeId: string): string | null {
  const deliverablesDir = path.join(ancientPathwaysDir, 'workspace', 'deliverables');
  if (!fs.existsSync(deliverablesDir)) return null;

  const ep = ANCIENT_PATHWAYS_EPISODES.find(e => e.id.toLowerCase() === episodeId.toLowerCase());
  const cap = episodeId.charAt(0).toUpperCase() + episodeId.slice(1).toLowerCase();

  const candidates = [
    path.join(deliverablesDir, `Ancient_Pathways_${cap}_1080p.mp4`),
    path.join(deliverablesDir, `Ancient_Pathways_Episode_${cap}_1080p.mp4`),
    ep ? path.join(deliverablesDir, `Ancient_Pathways_Episode_${ep.code}_${cap}_1080p.mp4`) : null,
    ep ? path.join(deliverablesDir, `Ancient_Pathways_Episode_${ep.code}_1080p.mp4`) : null,
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // General glob search fallback for any 1080p mp4 matching episode name
  try {
    const files = fs.readdirSync(deliverablesDir);
    const needle = episodeId.toLowerCase();
    const match = files.find(f => {
      const lower = f.toLowerCase();
      return lower.includes(needle) && lower.includes('1080p') && lower.endsWith('.mp4');
    });
    if (match) {
      return path.join(deliverablesDir, match);
    }
  } catch {
    /* readdir failed */
  }

  return null;
}

export interface DoctorCheckResult {
  episodeId: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  failed: number;
}

export interface ReachabilityFinding {
  symbol: string;
  definedIn: string;
  callers: number;
  issue: string;
}

function scanReachability(apDir: string): ReachabilityFinding[] {
  const findings: ReachabilityFinding[] = [];
  const pyFiles: string[] = [];
  const collect = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (entry !== 'node_modules' && entry !== '__pycache__' && entry !== '.git') {
          collect(full);
        }
      } else if (entry.endsWith('.py')) {
        pyFiles.push(full);
      }
    }
  };

  for (const sub of ['pipeline', 'scripts', 'src']) {
    collect(path.join(apDir, sub));
  }

  if (pyFiles.length === 0) return findings;

  for (const file of pyFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const defMatch = line.match(/^\s*def\s+(\w+)\s*\(/);
      if (!defMatch) continue;
      const fnName = defMatch[1];
      if (fnName.startsWith('_')) continue;

      let callers = 0;
      for (const other of pyFiles) {
        if (other === file) continue;
        const otherContent = fs.readFileSync(other, 'utf8');
        if (new RegExp(`\\b${fnName}\\s*\\(`).test(otherContent)) {
          callers++;
        }
      }

      if (callers === 0) {
        findings.push({
          symbol: fnName,
          definedIn: path.relative(apDir, file),
          callers: 0,
          issue: `def ${fnName}() defined but called from no other module in pipeline/`,
        });
      }
    }
  }

  return findings;
}

export { scanReachability };

export async function runDoctorChecks(episodeId: string, dir?: string): Promise<DoctorCheckResult> {
  const apDir = dir || resolveAncientPathwaysDir();
  if (!apDir || !fs.existsSync(apDir)) {
    return { episodeId, checks: [], failed: 0 };
  }

  const doctorPath = path.join(apDir, 'scripts', 'doctor.py');
  if (!fs.existsSync(doctorPath)) {
    return { episodeId, checks: [], failed: 0 };
  }

  const child = spawn('python', [doctorPath, '--episode', episodeId], {
    cwd: apDir,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  });

  let stdout = '';
  let stderr = '';

  return new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('close', () => {
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/\[(ok|FAIL)\]\s+(\d+\.?\d*)\s+(\S+)\s+(.+)/i);
        if (match) {
          const isOk = match[1].toUpperCase() === 'OK';
          const idNum = parseFloat(match[2]);
          const name = match[3];
          const detail = match[4].trim();
          checks.push({ name, ok: isOk, detail, id: idNum } as any);
        }
      }

      const reachability = scanReachability(apDir);
      if (reachability.length > 0) {
        for (const f of reachability) {
          checks.push({
            name: `reachability:${f.symbol}`,
            ok: false,
            detail: `${f.issue} (defined in ${f.definedIn}, ${f.callers} cross-module callers found)`,
          });
        }
      }

      const failed = checks.filter((c) => !c.ok).length;
      resolve({ episodeId, checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })), failed });
    });

    child.on('error', () => {
      resolve({ episodeId, checks: [], failed: 0 });
    });
  });
}

export interface RunEpisodeOptions {
  episodeId: string;
  dir?: string;
  onProgress?: (progress: { stage: string; note: string }) => void;
}

export interface RunEpisodeResult {
  ok: boolean;
  renderPath?: string;
  durationSeconds?: number;
  error?: string;
  log?: string;
}

/**
 * Runs the staged production pipeline for an episode by spawning
 * `python run_pipeline.py --episode <id>`.
 */
export function runEpisodePipeline(options: RunEpisodeOptions): Promise<RunEpisodeResult> {
  return new Promise((resolve) => {
    const dir = options.dir || resolveAncientPathwaysDir();
    if (!dir || !fs.existsSync(dir)) {
      resolve({
        ok: false,
        error: 'Ancient Pathways directory not found. Please ensure it is installed at Desktop/Ancient Pathways.',
      });
      return;
    }

    // Check lock first
    const lock = checkRenderLock(dir);
    if (lock.locked) {
      resolve({
        ok: false,
        error: `Render in progress: ${lock.message}. Please wait for it to complete.`,
      });
      return;
    }

    const args = ['run_pipeline.py', '--episode', options.episodeId];

    const child = spawn('python', args, {
      cwd: dir,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;

      // Extract stage indicators, e.g. "[OK] script", "[--] voice", "Stage: anim"
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.includes('ANCIENT PATHWAYS - stage') || trimmed.startsWith('===')) continue;

        const stageMatch = trimmed.match(/\[(OK|--|\.\.|!!)\]\s+([a-z_]+)\s+([a-z]+)/i);
        if (stageMatch) {
          const stageName = stageMatch[2];
          const stageStatus = stageMatch[3];
          options.onProgress?.({
            stage: stageName,
            note: humanizeStage(stageName, stageStatus),
          });
        } else if (trimmed.length > 5 && trimmed.length < 80) {
          options.onProgress?.({
            stage: 'running',
            note: trimmed,
          });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `Failed to spawn Python: ${err.message}`,
        log: stderr,
      });
    });

    child.on('close', (code) => {
      if (code === 2 || stdout.includes('REFUSING: another render holds workspace/render.lock')) {
        resolve({
          ok: false,
          error: 'Render refused: Another process is currently rendering. Wait for it to finish and try again.',
          log: stdout,
        });
        return;
      }

      if (code !== 0) {
        const errExcerpt = stderr.trim().split('\n').slice(-4).join(' ') ||
          stdout.trim().split('\n').slice(-4).join(' ');
        resolve({
          ok: false,
          error: `Pipeline exited with code ${code}: ${errExcerpt || 'Check logs'}`,
          log: `${stdout}\n${stderr}`,
        });
        return;
      }

      const deliverable = findEpisodeDeliverable(dir, options.episodeId);
      if (!deliverable) {
        resolve({
          ok: false,
          error: `Pipeline succeeded, but no 1080p MP4 deliverable was found for '${options.episodeId}'.`,
          log: stdout,
        });
        return;
      }

      resolve({
        ok: true,
        renderPath: deliverable,
        log: stdout,
      });
    });
  });
}

export interface ShowrunnerOptions {
  prompt: string;
  duration: number;
  characters: string;
  name: string;
  dir?: string;
  onProgress?: (progress: { stage: string; note: string }) => void;
}

export interface ShowrunnerResult {
  ok: boolean;
  outputPath?: string;
  durationSeconds?: number;
  error?: string;
  log?: string;
}

export function runShowrunner(options: ShowrunnerOptions): Promise<ShowrunnerResult> {
  return new Promise((resolve) => {
    const dir = options.dir || resolveAncientPathwaysDir();
    if (!dir || !fs.existsSync(dir)) {
      resolve({
        ok: false,
        error: 'Ancient Pathways directory not found. Please ensure it is installed at Desktop/Ancient Pathways.',
      });
      return;
    }

    const lock = checkRenderLock(dir);
    if (lock.locked) {
      resolve({
        ok: false,
        error: `Render in progress: ${lock.message}. Please wait for it to complete.`,
      });
      return;
    }

    const showrunner = path.join(dir, 'scripts', 'run_showrunner.py');
    if (!fs.existsSync(showrunner)) {
      resolve({
        ok: false,
        error: 'Showrunner script not found. Ensure your Ancient Pathways repo is up to date.',
      });
      return;
    }

    const args = [
      showrunner,
      '--prompt', options.prompt,
      '--duration', String(options.duration),
      '--characters', options.characters,
      '--name', options.name,
    ];

    const child = spawn('python', args, {
      cwd: dir,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;

      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.length > 120) continue;

        const stageMatch = trimmed.match(/\[(OK|--|\.\.|!!)\]\s+([a-z_]+)\s+([a-z]+)/i);
        if (stageMatch) {
          options.onProgress?.({
            stage: stageMatch[2],
            note: humanizeStage(stageMatch[2], stageMatch[3]),
          });
        } else {
          options.onProgress?.({ stage: 'running', note: trimmed });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        error: `Failed to spawn Python: ${err.message}`,
        log: stderr,
      });
    });

    child.on('close', (code) => {
      if (code === 2 || stdout.includes('REFUSING: another render holds workspace/render.lock')) {
        resolve({
          ok: false,
          error: 'Render refused: Another process is currently rendering. Wait for it to finish and try again.',
          log: stdout,
        });
        return;
      }

      if (code !== 0) {
        const errExcerpt = stderr.trim().split('\n').slice(-4).join(' ') ||
          stdout.trim().split('\n').slice(-4).join(' ');
        resolve({
          ok: false,
          error: `Showrunner exited with code ${code}: ${errExcerpt || 'Check logs'}`,
          log: `${stdout}\n${stderr}`,
        });
        return;
      }

      const outputPath = path.join(dir, 'workspace', 'productions', options.name, 'scene_01', 'scene_master_1080p.mp4');
      if (!fs.existsSync(outputPath)) {
        resolve({
          ok: false,
          error: `Showrunner succeeded, but no output was found at workspace/productions/${options.name}/scene_01/scene_master_1080p.mp4.`,
          log: stdout,
        });
        return;
      }

      resolve({
        ok: true,
        outputPath,
        log: stdout,
      });
    });
  });
}

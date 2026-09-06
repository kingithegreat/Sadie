import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectGenre,
  extractTitleAndLogline,
  segmentNarrativeBeats,
  directScript,
  directScriptToStoryboard,
} from '../movie/script-director';

describe('Script-to-Storyboard Director Engine', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-director-test-'));
    process.env.HOMEBOT_MOVIE_PROJECTS_DIR = tmpRoot;
  });

  afterEach(() => {
    delete process.env.HOMEBOT_MOVIE_PROJECTS_DIR;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('Genre Detection', () => {
    test('detects historical_epic for ancient Egyptian keywords', () => {
      const genre = detectGenre('Imhotep approaches the great pyramid temple in the golden sands of Giza.');
      expect(genre).toBe('historical_epic');
    });

    test('detects cyberpunk_scifi for cyberpunk neon keywords', () => {
      const genre = detectGenre('A cyborg hacker plugs into the neon terminal under the acid rain.');
      expect(genre).toBe('cyberpunk_scifi');
    });

    test('detects noir_thriller for detective mystery keywords', () => {
      const genre = detectGenre('The detective tipped his fedora in the dark alley amidst the smoke and murder.');
      expect(genre).toBe('noir_thriller');
    });

    test('detects documentary_nature for wildlife keywords', () => {
      const genre = detectGenre('A snow leopard stalks across the mountain tundra hunting its prey in the wild.');
      expect(genre).toBe('documentary_nature');
    });

    test('detects fantasy_myth for dragon wizard keywords', () => {
      const genre = detectGenre('The ancient wizard cast an enchanted spell as the dragon circled the mythical realm.');
      expect(genre).toBe('fantasy_myth');
    });

    test('detects action_cinematic for explosion chase keywords', () => {
      const genre = detectGenre('The operative triggered the explosion during the high-speed car chase and gunfire.');
      expect(genre).toBe('action_cinematic');
    });

    test('respects explicit genre override', () => {
      const genre = detectGenre('A tiger in the jungle', 'cyberpunk_scifi');
      expect(genre).toBe('cyberpunk_scifi');
    });
  });

  describe('Title & Slug Extraction', () => {
    test('extracts explicit Title header', () => {
      const text = 'Title: The Golden Obelisk\nA story about ancient builders.';
      const res = extractTitleAndLogline(text);
      expect(res.title).toBe('The Golden Obelisk');
    });

    test('extracts screenplay slugline', () => {
      const text = 'EXT. GIZA PLATEAU - DUSK\nThe sands swirl around the monument.';
      const res = extractTitleAndLogline(text);
      expect(res.title).toContain('GIZA PLATEAU');
    });

    test('respects provided custom title', () => {
      const res = extractTitleAndLogline('Random text without header', 'Custom Movie Title');
      expect(res.title).toBe('Custom Movie Title');
    });
  });

  describe('Narrative Beat Segmentation', () => {
    test('parses numbered list into beats', () => {
      const text = '1. First beat\n2. Second beat\n3. Third beat\n4. Fourth beat';
      const beats = segmentNarrativeBeats(text, 4);
      expect(beats).toHaveLength(4);
      expect(beats[0]).toContain('First beat');
      expect(beats[3]).toContain('Fourth beat');
    });

    test('segments screenplay shots', () => {
      const text = 'Shot 1: Wide desert vista\nShot 2: Medium builder at work\nShot 3: Close up chisel striking stone';
      const beats = segmentNarrativeBeats(text, 3);
      expect(beats).toHaveLength(3);
      expect(beats[0]).toContain('Wide desert vista');
    });

    test('expands short one-line prompt into dramatic arc', () => {
      const text = 'A lone explorer finds an alien beacon on Mars.';
      const beats = segmentNarrativeBeats(text, 4);
      expect(beats).toHaveLength(4);
      expect(beats[0]).toContain('Establishing the environment');
      expect(beats[3]).toContain('The climactic discovery');
    });
  });

  describe('Director Breakdown Sequence', () => {
    test('creates calibrated camera sequence with framing, lens, movement, and dialogue', () => {
      const script = `EXT. KARNAK TEMPLE - DUSK
IMHOTEP: The sacred geometry will anchor the dynasty.
Imhotep unrolls the papyrus blueprint under torchlight.
The stone masons raise the massive granite pillar.
The golden capstone reflects the dying Egyptian sun.`;

      const directed = directScript({
        script,
        genre: 'historical_epic',
        shotCount: 4,
      });

      expect(directed.shots).toHaveLength(4);
      expect(directed.genre).toBe('historical_epic');

      // Shot 1: Wide establishing
      expect(directed.shots[0].framing).toBe('wide');
      expect(directed.shots[0].lens).toBe('24mm');
      expect(directed.shots[0].movement).toBe('slow push in');
      expect(directed.shots[0].prompt).toContain('Panavision');
      expect(directed.shots[0].narration).toContain('The sacred geometry will anchor the dynasty');
      expect(directed.shots[0].characters).toContain('IMHOTEP');

      // Shot 2: Medium action
      expect(directed.shots[1].framing).toBe('medium');
      expect(directed.shots[1].lens).toBe('35mm');

      // Pacing
      expect(directed.totalDurationSec).toBeGreaterThan(15);
    });
  });

  describe('directScriptToStoryboard (Disk & Pipeline Integration)', () => {
    test('creates full movie project on disk with scenes and shot manifests', async () => {
      const script = `A cyberpunk runner navigates the neon rain of Sector 7.
She spots the hidden megacorp surveillance drone.
She fires an EMP pulse disabling the drone.
She retrieves the encrypted datacore from the chassis.`;

      const res = await directScriptToStoryboard({
        script,
        title: 'Sector 7 Data Run',
        genre: 'cyberpunk_scifi',
        shotCount: 4,
      });

      expect(res.ok).toBe(true);
      expect(res.projectId).toBeDefined();
      expect(res.shots).toHaveLength(4);

      const projectDir = res.projectDir!;
      expect(fs.existsSync(projectDir)).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'project.json'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'scenes', 'scene_01', 'manifest.json'))).toBe(true);

      // Verify shot files
      const shot01 = path.join(projectDir, 'scenes', 'scene_01', 'shot_001');
      expect(fs.existsSync(shot01)).toBe(true);
      expect(fs.existsSync(path.join(shot01, 'script.txt'))).toBe(true);
      expect(fs.existsSync(path.join(shot01, 'prompt.json'))).toBe(true);

      const promptData = JSON.parse(fs.readFileSync(path.join(shot01, 'prompt.json'), 'utf-8'));
      expect(promptData.framing).toBe('wide');
      expect(promptData.lens).toBe('24mm');
      expect(promptData.genre).toBe('cyberpunk_scifi');
    });

    test('returns error when script is empty', async () => {
      const res = await directScriptToStoryboard({ script: '   ' });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('required');
    });
  });
});

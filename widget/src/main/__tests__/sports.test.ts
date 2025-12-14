import os from 'os';
import path from 'path';
import fs from 'fs';

import { sportsReportHandler } from '../tools/sports';
import * as nba from '../tools/nba';
import * as config from '../config-manager';

describe('generate_sports_report tool', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
    // Point HOME/USERPROFILE to temporary directory so we don't touch real Desktop
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;

    // Ensure Desktop exists
    const desktop = path.join(tmpHome, 'Desktop');
    fs.mkdirSync(desktop, { recursive: true });

    // Allow write_file permission during tests
    jest.spyOn(config, 'assertPermission').mockImplementation((name: string) => true as any);
  });

  afterEach(() => {
    // Cleanup
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { }
    jest.restoreAllMocks();
  });

  test('creates directory and writes a txt report', async () => {
    // Mock NBA response with a single event
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [ { name: 'Lakers vs Nuggets', competitions: [ { competitors: [ { team: { displayName: 'Lakers', abbreviation: 'LAL' }, score: '112' }, { team: { displayName: 'Nuggets', abbreviation: 'DEN' }, score: '107' } ] } ] } ] } } as any);

    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestNBA', format: 'txt' } as any, {} as any);
    expect(resp.success).toBe(true);
    const dir = resp.result.path as string;
    const reportPath = path.join(dir, 'report.txt');
    expect(fs.existsSync(reportPath)).toBe(true);
    const contents = fs.readFileSync(reportPath, 'utf-8');
    expect(contents).toMatch(/Lakers/);
    expect(contents).toMatch(/Nuggets/);
  });
});

import os from 'os';
import path from 'path';
import * as fs from 'fs';

import { sportsReportHandler, sportsReportDef } from '../tools/sports';
import * as nba from '../tools/nba';
import * as config from '../config-manager';

const SINGLE_EVENT = {
  name: 'Lakers vs Nuggets',
  competitions: [{ competitors: [
    { team: { displayName: 'Lakers', abbreviation: 'LAL' }, score: '112' },
    { team: { displayName: 'Nuggets', abbreviation: 'DEN' }, score: '107' },
  ]}]
};

describe('generate_sports_report tool', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    const desktop = path.join(tmpHome, 'Desktop');
    fs.mkdirSync(desktop, { recursive: true });
    jest.spyOn(config, 'assertPermission').mockImplementation((_name: string) => true as any);
  });

  afterEach(() => {
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { }
    jest.restoreAllMocks();
  });

  // ── definition shape ───────────────────────────────────────────────────────

  test('sportsReportDef.name is generate_sports_report', () => {
    expect(sportsReportDef.name).toBe('generate_sports_report');
  });

  test('sportsReportDef requires league parameter', () => {
    expect(sportsReportDef.parameters.required).toContain('league');
  });

  test('sportsReportDef.requiredPermissions includes write_file', () => {
    expect(sportsReportDef.requiredPermissions).toContain('write_file');
  });

  // ── unsupported league ────────────────────────────────────────────────────

  test('returns error for unsupported league', async () => {
    const resp = await sportsReportHandler({ league: 'soccer' } as any, {} as any);
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/unsupported league/i);
  });

  // ── permission denied ─────────────────────────────────────────────────────

  test('returns permission denied error when write_file not allowed', async () => {
    jest.spyOn(config, 'assertPermission').mockImplementation(() => false as any);
    const resp = await sportsReportHandler({ league: 'nba' } as any, {} as any);
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/permission denied/i);
  });

  test('overrideAllowed context bypasses permission check', async () => {
    jest.spyOn(config, 'assertPermission').mockImplementation(() => false as any);
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [SINGLE_EVENT] } } as any);
    const resp = await sportsReportHandler(
      { league: 'nba', date: '2025-12-14', directory: 'Desktop/P', format: 'txt' } as any,
      { overrideAllowed: ['write_file'] } as any
    );
    expect(resp.success).toBe(true);
  });

  // ── NBA fetch error ───────────────────────────────────────────────────────

  test('returns error when nbaQueryHandler fails', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: false, error: 'API down' } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/X', format: 'txt' } as any, {} as any);
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('API down');
  });

  // ── txt format ────────────────────────────────────────────────────────────

  test('creates directory and writes a txt report', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [SINGLE_EVENT] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestNBA', format: 'txt' } as any, {} as any);
    expect(resp.success).toBe(true);
    const dir = resp.result.path as string;
    const reportPath = path.join(dir, 'report.txt');
    expect(fs.existsSync(reportPath)).toBe(true);
    const contents = fs.readFileSync(reportPath, 'utf-8');
    expect(contents).toMatch(/Lakers/);
    expect(contents).toMatch(/Nuggets/);
  });

  test('txt report includes summary by default', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [SINGLE_EVENT] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestNBASummary', format: 'txt', includeSummary: true } as any, {} as any);
    expect(resp.success).toBe(true);
    const contents = fs.readFileSync(path.join(resp.result.path, 'report.txt'), 'utf-8');
    expect(contents).toMatch(/Summary/);
  });

  test('txt report omits summary when includeSummary=false', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [SINGLE_EVENT] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestNBANoSum', format: 'txt', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const contents = fs.readFileSync(path.join(resp.result.path, 'report.txt'), 'utf-8');
    expect(contents).not.toMatch(/Summary/);
  });

  test('txt report works with empty events list', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestEmpty', format: 'txt', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const contents = fs.readFileSync(path.join(resp.result.path, 'report.txt'), 'utf-8');
    expect(contents).toContain('Games:');
  });

  // ── html format ───────────────────────────────────────────────────────────

  test('creates HTML report when format is html', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [SINGLE_EVENT] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestHTMLNBA', format: 'html' } as any, {} as any);
    expect(resp.success).toBe(true);
    const dir = resp.result.path as string;
    const reportPath = path.join(dir, 'report.html');
    expect(fs.existsSync(reportPath)).toBe(true);
    const contents = fs.readFileSync(reportPath, 'utf-8');
    expect(contents).toContain('<!doctype html>');
    expect(contents).toContain('Lakers');
    expect(contents).toContain('Nuggets');
  });

  test('html report includes summary section when includeSummary=true', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [SINGLE_EVENT] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestHTMLSum', format: 'html', includeSummary: true } as any, {} as any);
    expect(resp.success).toBe(true);
    const contents = fs.readFileSync(path.join(resp.result.path, 'report.html'), 'utf-8');
    expect(contents).toContain('Summary');
  });

  test('html report omits summary when includeSummary=false', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [SINGLE_EVENT] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/TestHTMLNoSum', format: 'html', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const contents = fs.readFileSync(path.join(resp.result.path, 'report.html'), 'utf-8');
    expect(contents).not.toContain('Summary');
  });

  test('html is default format when format is omitted', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', directory: 'Desktop/TestHTMLDefault' } as any, {} as any);
    expect(resp.success).toBe(true);
    expect(fs.existsSync(path.join(resp.result.path, 'report.html'))).toBe(true);
  });

  // ── result shape ──────────────────────────────────────────────────────────

  test('result includes path and files array', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', directory: 'Desktop/TestShape', format: 'html' } as any, {} as any);
    expect(resp.success).toBe(true);
    expect(resp.result).toHaveProperty('path');
    expect(Array.isArray(resp.result.files)).toBe(true);
    expect(resp.result.files.length).toBeGreaterThan(0);
  });

  // ── name/score fallback chains (txt format) ───────────────────────────────

  test('uses shortName when event name is absent — txt', async () => {
    const evt = { shortName: 'LAL vs BOS', competitions: [{ competitors: [
      { team: { abbreviation: 'LAL' }, score: '100' },
      { team: { abbreviation: 'BOS' }, score: '98'  },
    ] }] };
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [evt] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/SnTxt', format: 'txt', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const txt = fs.readFileSync(path.join(resp.result.path, 'report.txt'), 'utf-8');
    expect(txt).toContain('LAL vs BOS');
  });

  test('derives name from competitions when name and shortName are absent — txt', async () => {
    const evt = { competitions: [{ competitors: [
      { team: { displayName: 'Bulls' }, score: '90' },
      { team: { displayName: 'Heat'  }, score: '88' },
    ] }] };
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [evt] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/CompTxt', format: 'txt', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const txt = fs.readFileSync(path.join(resp.result.path, 'report.txt'), 'utf-8');
    expect(txt).toMatch(/Bulls.*Heat|Heat.*Bulls/i);
  });

  test('falls back to "Game" when event has no name, shortName, or competitions — txt', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [{}] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/GameTxt', format: 'txt', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const txt = fs.readFileSync(path.join(resp.result.path, 'report.txt'), 'utf-8');
    expect(txt).toContain('Game');
  });

  test('score is empty when event has no competitions — txt', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [{ name: 'No-Score Game' }] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/NoScoreTxt', format: 'txt', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const txt = fs.readFileSync(path.join(resp.result.path, 'report.txt'), 'utf-8');
    expect(txt).toContain('No-Score Game');
  });

  // ── name/score fallback chains (html format) ──────────────────────────────

  test('uses shortName when event name is absent — html', async () => {
    const evt = { shortName: 'GSW vs MEM', competitions: [{ competitors: [
      { team: { displayName: 'Warriors', abbreviation: 'GSW' }, score: '105' },
      { team: { displayName: 'Grizzlies', abbreviation: 'MEM' }, score: '102' },
    ] }] };
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [evt] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/SnHtml', format: 'html', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const html = fs.readFileSync(path.join(resp.result.path, 'report.html'), 'utf-8');
    expect(html).toContain('GSW vs MEM');
  });

  test('falls back to "Game" when event has no name, shortName, or competitions — html', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [{}] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/GameHtml', format: 'html', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const html = fs.readFileSync(path.join(resp.result.path, 'report.html'), 'utf-8');
    expect(html).toContain('>Game<');
  });

  test('score is empty when event has no competitions — html', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockResolvedValue({ success: true, result: { events: [{ name: 'No-Score HTML' }] } } as any);
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/NoScoreHtml', format: 'html', includeSummary: false } as any, {} as any);
    expect(resp.success).toBe(true);
    const html = fs.readFileSync(path.join(resp.result.path, 'report.html'), 'utf-8');
    expect(html).toContain('No-Score HTML');
    expect(html).toContain('<td></td>');
  });

  // ── top-level catch ───────────────────────────────────────────────────────

  test('top-level catch returns structured error on unexpected exception', async () => {
    jest.spyOn(nba, 'nbaQueryHandler').mockRejectedValue(new Error('critical failure'));
    const resp = await sportsReportHandler({ league: 'nba', date: '2025-12-14', directory: 'Desktop/Catch', format: 'txt' } as any, {} as any);
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/Sports report generation failed/);
    expect(resp.error).toMatch(/critical failure/);
  });
});

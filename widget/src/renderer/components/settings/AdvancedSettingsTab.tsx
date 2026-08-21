/**
 * Everything granular: automations, API keys, Mixture of Agents, MCP servers, scheduling, licensing and diagnostics.
 *
 * Moved verbatim out of SettingsPanel.tsx; the controls and their bindings are
 * unchanged. State comes from useSettingsCtx().
 */

import { useSettingsCtx } from './SettingsContext';
import type { PerfStatSummary } from '../../../shared/types';
import Tooltip from '../Tooltip';
import { buildSparkline } from '../../../shared/sparkline';
import { buildPerfAdvice } from '../../../shared/perf-advice';

export default function AdvancedSettingsTab() {
  const {
    ollamaModels,
    localSettings,
    setLocalSettings,
    openSections,
    toggleSection,
    perfStats,
    perfHistory,
    perfLoading,
    loadPerfStats,
    n8nTesting,
    setN8nTesting,
    n8nTestResult,
    setN8nTestResult,
    sysCheck,
    sysCheckLoading,
    sysCheckError,
    runSystemCheck,
    reportCopied,
    copySupportReport,
    gpuInfo,
    handleDetectGpu,
    handleManualVram,
    applyRecommendation,
    licenseStatus,
    licenseKeyInput,
    setLicenseKeyInput,
    licenseBusy,
    licenseMessage,
    handleActivateLicense,
    handleDeactivateLicense,
    onClose,
  } = useSettingsCtx();

  return (
    <>
        {/* -- Automations (n8n) -- */}
        <button type="button" className={`sp-section-toggle${openSections.n8n ? ' open' : ''}`} onClick={() => toggleSection('n8n')}>
          <span className="sp-section-arrow">{openSections.n8n ? '▾' : '▸'}</span> Automations
        </button>
        {openSections.n8n && <>
        <div className="setting-group">
          <label className="setting-label">n8n URL</label>
          <input
            type="text"
            className="setting-input"
            value={localSettings.n8nUrl}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                n8nUrl: e.target.value
              })
            }
            placeholder="http://localhost:5678"
          />
          <small className="setting-hint">URL of your local n8n instance for workflow automation. Requires Docker Desktop running n8n.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">n8n API key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.n8nApiKey || ''}
            onChange={(e) =>
              setLocalSettings({
                ...localSettings,
                n8nApiKey: e.target.value
              })
            }
            placeholder="n8n_api_..."
            autoComplete="off"
          />
          <small className="setting-hint">
            Create one in n8n under Settings → API. With a key set, HomeBot manages workflows through n8n&apos;s
            authenticated API (no Docker access or container restarts needed). Stored encrypted.
          </small>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="sp-btn"
              disabled={n8nTesting}
              onClick={async () => {
                setN8nTesting(true);
                setN8nTestResult(null);
                try {
                  const res = await (window as any).electron?.testN8nConnection?.({
                    baseUrl: localSettings.n8nUrl,
                    apiKey: localSettings.n8nApiKey || '',
                  });
                  if (!res) setN8nTestResult('Test unavailable');
                  else if (!res.reachable) setN8nTestResult(`✗ ${res.error || 'n8n not reachable'}`);
                  else if (res.authenticated === true) setN8nTestResult('✓ Connected and authenticated');
                  else if (res.authenticated === null) setN8nTestResult('✓ n8n reachable (no API key set — using Docker fallback)');
                  else setN8nTestResult(`✗ ${res.error || 'API key rejected'}`);
                } catch (e: any) {
                  setN8nTestResult(`✗ ${e?.message || 'Test failed'}`);
                } finally {
                  setN8nTesting(false);
                }
              }}
            >
              {n8nTesting ? 'Testing…' : 'Test connection'}
            </button>
            {n8nTestResult && (
              <small className="setting-hint" style={{ margin: 0 }} data-testid="n8n-test-result">{n8nTestResult}</small>
            )}
          </div>
        </div>
        </>}

        {/* ── API Keys ── */}
        <button type="button" className={`sp-section-toggle${openSections.api_keys ? ' open' : ''}`} onClick={() => toggleSection('api_keys')}>
          <span className="sp-section-arrow">{openSections.api_keys ? '▾' : '▸'}</span> API Keys &amp; Cloud LLM
        </button>
        {openSections.api_keys && <>
        {/* Custom LLM API Section - Simplified */}




        {/* ── Mixture of Agents (MoA) ─────────────────────────── */}
        <div className="setting-group">
          <label className="setting-label">{'🧠'} Mixture of Agents (MoA)</label>
          <small className="setting-hint sp-hint-mb">
            Route complex queries to multiple specialist models and aggregate the best answer.
            Simple queries always use the fast single-model path.
          </small>
          {/* GPU VRAM detection / manual input — always visible */}
          <div style={{ background: 'var(--input-bg, #1a1a2e)', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <button type="button" className="model-card" style={{ padding: '6px 14px', flex: '0 0 auto' }}
                onClick={handleDetectGpu} disabled={gpuInfo.detecting}>
                {gpuInfo.detecting ? 'Detecting...' : `${'🔍'} Detect my GPU`}
              </button>
              <span style={{ fontSize: '12px', opacity: 0.7 }}>or enter VRAM manually:</span>
              <input type="range" min={2} max={48} step={1}
                value={gpuInfo.manualVram ?? gpuInfo.vramGB ?? 4}
                onChange={(e) => handleManualVram(parseInt(e.target.value, 10))}
                style={{ flex: 1 }} />
              <span style={{ fontWeight: 600, minWidth: '50px', textAlign: 'right' }}>
                {gpuInfo.manualVram ?? gpuInfo.vramGB ?? '?'} GB
              </span>
            </div>
            {gpuInfo.gpuName && (
              <small className="setting-hint" style={{ display: 'block', marginBottom: '4px' }}>
                {'🎮'} Detected: <strong>{gpuInfo.gpuName}</strong> ({gpuInfo.vramGB} GB VRAM)
              </small>
            )}
            {gpuInfo.recommendation?.mode === 'single' && (
              <div style={{ background: 'var(--bg-secondary, #16213e)', borderRadius: '6px', padding: '10px', marginTop: '6px' }}>
                <small style={{ color: 'var(--accent-color, #00d4ff)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  {'🚀'} Best setup for your GPU
                </small>
                <small className="setting-hint" style={{ display: 'block', marginBottom: '6px' }}>
                  {gpuInfo.recommendation.reason}
                  {' '}Drag files into the chat to index them with RAG for smarter answers.
                </small>
                <button type="button" className="model-card active" style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={applyRecommendation}>
                  Apply &mdash; use {gpuInfo.recommendation.model} + RAG
                </button>
              </div>
            )}
            {gpuInfo.recommendation?.mode === 'moa' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <small className="setting-hint" style={{ color: 'var(--accent-color, #00d4ff)' }}>
                  {'✨'} Recommended: <strong>{gpuInfo.recommendation.reason}</strong>
                </small>
                <button type="button" className="model-card active" style={{ padding: '4px 12px', fontSize: '12px' }}
                  onClick={applyRecommendation}>
                  Apply
                </button>
              </div>
            )}
            {gpuInfo.vramGB !== null && !gpuInfo.recommendation && (
              <small className="setting-hint" style={{ color: 'var(--warning-color, #f59e0b)' }}>
                {'⚠️'} {gpuInfo.vramGB} GB may not be enough for local models.
              </small>
            )}
          </div>

          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.moaEnabled || false}
              onChange={(e) =>
                setLocalSettings({
                  ...localSettings,
                  moaEnabled: e.target.checked
                })
              }
            />
            <span>Enable Mixture of Agents</span>
            {gpuInfo.recommendation?.mode === 'single' && (
              <small style={{ marginLeft: '8px', color: 'var(--warning-color, #f59e0b)', fontSize: '11px' }}>
                (not recommended for {gpuInfo.vramGB ?? '<8'} GB VRAM)
              </small>
            )}
          </label>

          {localSettings.moaEnabled && (
            <>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <button type="button" className={`model-card ${gpuInfo.recommendation?.preset === 'balanced' ? 'active' : ''}`} style={{ flex: '1 1 auto', minWidth: '120px', padding: '8px 12px' }}
                  title="A good all-rounder — reasoning, coding and general questions"
                  onClick={() => setLocalSettings({ ...localSettings, moaProposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'], moaAggregator: 'gemma4:e4b' })}>
                  <div className="model-card-label">{'⚖️'} Balanced</div>
                  <p className="model-card-desc">16+ GB GPUs</p>
                </button>
                <button type="button" className={`model-card ${gpuInfo.recommendation?.preset === 'codeHeavy' ? 'active' : ''}`} style={{ flex: '1 1 auto', minWidth: '120px', padding: '8px 12px' }}
                  title="Tuned for writing and fixing code"
                  onClick={() => setLocalSettings({ ...localSettings, moaProposers: ['qwen2.5-coder:7b', 'qwen2.5:7b'], moaAggregator: 'gemma4:e4b' })}>
                  <div className="model-card-label">{'💻'} Code-focused</div>
                  <p className="model-card-desc">16+ GB GPUs</p>
                </button>
                <button type="button" className={`model-card ${gpuInfo.recommendation?.preset === 'lightweight' ? 'active' : ''}`} style={{ flex: '1 1 auto', minWidth: '120px', padding: '8px 12px' }}
                  title="The lightest option — smaller models, easier on your graphics card"
                  onClick={() => setLocalSettings({ ...localSettings, moaProposers: ['qwen2.5:7b', 'qwen2.5-coder:7b'], moaAggregator: 'qwen2.5:7b' })}>
                  <div className="model-card-label">{'🪶'} Lightweight</div>
                  <p className="model-card-desc">10+ GB GPUs</p>
                </button>
              </div>

              <label className="setting-sub-label sp-sub-label">Proposer Models (select 2+)</label>
              <small className="setting-hint sp-hint-mb">
                These models generate independent answers in parallel. Pick diverse models for best results.
                Use the presets above or make your own selection.
              </small>
              <div className="model-grid">
                {ollamaModels
                  .filter(m => m.id !== 'llava:latest')
                  .map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-card ${(localSettings.moaProposers || []).includes(model.id) ? 'active' : ''}`}
                      onClick={() => {
                        const current = localSettings.moaProposers || [];
                        setLocalSettings({
                          ...localSettings,
                          moaProposers: current.includes(model.id)
                            ? current.filter((m: string) => m !== model.id)
                            : [...current, model.id]
                        });
                      }}
                    >
                      <div className="model-card-label">{model.name}</div>
                      <p className="model-card-desc">{model.description}</p>
                    </button>
                  ))}
              </div>

              <label className="setting-sub-label sp-sub-label">Aggregator Model</label>
              <small className="setting-hint sp-hint-mb">
                This model synthesises the proposer outputs into a single high-quality answer.
                Should be your most capable model.
              </small>
              <div className="model-grid">
                {ollamaModels
                  .filter(m => m.id !== 'llava:latest')
                  .map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`model-card ${localSettings.moaAggregator === model.id ? 'active' : ''}`}
                      onClick={() =>
                        setLocalSettings({
                          ...localSettings,
                          moaAggregator: model.id
                        })
                      }
                    >
                      <div className="model-card-label">{model.name}</div>
                      <p className="model-card-desc">{model.description}</p>
                    </button>
                  ))}
              </div>

              {(localSettings.moaProposers || []).length < 2 && (
                <small className="setting-hint" style={{ color: 'var(--warning-color, #f59e0b)' }}>
                  {'⚠️'} Select at least 2 proposer models for MoA to activate.
                </small>
              )}
            </>
          )}
        </div>

        <div className="setting-group">
          <label className="setting-label">{'\u{1F511}'} LLM API Keys (optional)</label>
          <small className="setting-hint sp-hint-mb">
            Save your API keys here. They will auto-fill when you select the provider above.
          </small>
          <label className="setting-sub-label sp-sub-label">Anthropic API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.anthropicApiKey || ''}
            placeholder="sk-ant-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, anthropicApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For Claude models. Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer noopener">console.anthropic.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">OpenAI API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.openaiApiKey || ''}
            placeholder="sk-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, openaiApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For GPT models and DALL-E 3 image generation. Get a key at <a href="https://platform.openai.com" target="_blank" rel="noreferrer noopener">platform.openai.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">Google Gemini API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.geminiApiKey || ''}
            placeholder="AIza..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, geminiApiKey: e.target.value })
            }
          />
          <small className="setting-hint">For Gemini models. Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">aistudio.google.com</a></small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🎨 Image Generation</label>
          <small className="setting-hint sp-hint-mb">
            Images are generated via Stable Horde (free community-powered AI). Register at <a href="https://stablehorde.net" target="_blank" rel="noreferrer noopener">stablehorde.net</a> for a free API key and faster generation.
          </small>
          <label className="setting-sub-label sp-sub-label">Stable Horde API Key</label>
          <input
            type="password"
            className="setting-input"
            value={(localSettings as any).stableHordeApiKey || ''}
            placeholder="Anonymous (slow) — paste your free key for faster results"
            onChange={(e) =>
              setLocalSettings({ ...localSettings, stableHordeApiKey: e.target.value } as any)
            }
          />
          <small className="setting-hint">Without a key, generation uses the anonymous queue (~60-120 s). A free registered key drops this to ~10-20 s.</small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🎬 Media Studio</label>
          <small className="setting-hint sp-hint-mb">
            HomeBot never uploads a video anywhere. This only controls whether a video is
            allowed to move into the Scheduled and Published stages, which is how you record
            that you have posted one yourself.
          </small>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={!!localSettings.mediaPublishingEnabled}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, mediaPublishingEnabled: e.target.checked })
              }
            />
            <span>Allow videos to reach Scheduled and Published</span>
          </label>
          <small className="setting-hint">
            Off by default. While it is off, moving a video into either stage is refused.
          </small>

          {/* Background music, from a folder rather than a service: no account,
              no rate limit, no licence question, and it works offline. */}
          <label className="setting-label" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              data-testid="media-music-enabled"
              checked={!!localSettings.mediaMusicEnabled}
              // Nothing to play without a folder, and a toggle that looks on
              // while doing nothing is worse than one that is plainly off.
              disabled={!localSettings.mediaMusicFolder?.trim()}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, mediaMusicEnabled: e.target.checked })
              }
            />
            <span>Play background music under the narration</span>
          </label>
          <input
            type="text"
            className="setting-input"
            data-testid="media-music-folder"
            value={localSettings.mediaMusicFolder || ''}
            onChange={(e) =>
              setLocalSettings({ ...localSettings, mediaMusicFolder: e.target.value })
            }
            placeholder="Paste the folder holding your music, e.g. C:\Users\you\Music\HomeBot"
          />
          <small className="setting-hint">
            Your own tracks, your own licence — HomeBot ships none and downloads none. Drop
            mp3, m4a, wav, ogg or flac files into a folder and paste the path here. One track
            is picked per video and quietened automatically whenever the narration is speaking.
            The same video always gets the same track.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">🔒 Privacy</label>
          <label className="setting-label">
            <input
              type="checkbox"
              checked={localSettings.saveConversationHistory !== false}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, saveConversationHistory: e.target.checked })
              }
            />
            <span>Save my conversations to this PC</span>
          </label>
          <small className="setting-hint">
            On by default, so you can reopen past chats. Turn it off and new conversations stay
            in the window only — nothing further is written to disk. Chats already saved are
            left alone; delete those from the conversation list.
          </small>
        </div>

        <div className="setting-group">
          <label className="setting-label">�🔍 Search API Keys (optional)</label>
          <small className="setting-hint sp-hint-mb">
            Add API keys for higher-quality web search results. Falls back to DuckDuckGo scraping if no keys are set.
          </small>
          <label className="setting-sub-label sp-sub-label">Tavily API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.tavilyApiKey || ''}
            placeholder="tvly-..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, tavilyApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Primary search — AI-optimized results. Get a key at <a href="https://tavily.com" target="_blank" rel="noreferrer noopener">tavily.com</a></small>

          <label className="setting-sub-label sp-sub-label-mt8">Serper.dev API Key</label>
          <input
            type="password"
            className="setting-input"
            value={localSettings.serperApiKey || ''}
            placeholder="Enter Serper.dev key..."
            onChange={(e) =>
              setLocalSettings({ ...localSettings, serperApiKey: e.target.value })
            }
          />
          <small className="setting-hint">Secondary search — Google results via API. Get a key at <a href="https://serper.dev" target="_blank" rel="noreferrer noopener">serper.dev</a></small>
        </div>
        </>}


        {/* HomeBot Pro license */}
        <button type="button" className={`sp-section-toggle${openSections.license ? ' open' : ''}`} onClick={() => toggleSection('license')}>
          <span className="sp-section-arrow">{openSections.license ? '▾' : '▸'}</span> HomeBot Pro
        </button>
        {openSections.license && <>
          <div className="setting-group">
            <label className="setting-label">
              {licenseStatus?.tier === 'pro' ? '⭐ Pro' : 'Free'}
              <small className="setting-hint" style={{ display: 'block', marginTop: 2 }}>
                {licenseStatus?.tier === 'pro'
                  ? 'Pro unlocks the Automation Center (scheduled jobs) and local image generation.'
                  : 'Unlock the Automation Center (scheduled jobs) and local image generation with HomeBot Pro.'}
              </small>
            </label>

            {licenseStatus?.tier === 'pro' ? (
              <>
                {licenseStatus.expiresAt && (
                  <small className="setting-hint" style={{ display: 'block', marginBottom: 8 }}>
                    Renews/expires {new Date(licenseStatus.expiresAt).toLocaleDateString()}
                  </small>
                )}
                <button
                  type="button"
                  className="button button-cancel"
                  disabled={licenseBusy}
                  onClick={() => { void handleDeactivateLicense(); }}
                >
                  Deactivate on this device
                </button>
              </>
            ) : (
              <div className="sp-form-col">
                <input
                  className="setting-input"
                  placeholder="Enter your license key"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  disabled={licenseBusy}
                />
                <div className="sp-mcp-actions">
                  <button
                    type="button"
                    className="button sp-license-activate-btn sp-btn-save-sm"
                    disabled={licenseBusy || !licenseKeyInput.trim()}
                    onClick={() => { void handleActivateLicense(); }}
                  >
                    {licenseBusy ? 'Activating…' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    className="button button-cancel sp-btn-save-sm"
                    onClick={() => window.electron?.openExternalUrl?.(licenseStatus?.upgradeUrl || 'homebot://upgrade')}
                  >
                    Get a license
                  </button>
                </div>
              </div>
            )}
            {licenseMessage && (
              <small className="setting-hint" style={{ display: 'block', marginTop: 8 }}>{licenseMessage}</small>
            )}
          </div>
        </>}


        {/* Diagnostics & Performance */}
        <button type="button" className={`sp-section-toggle${openSections.diagnostics ? ' open' : ''}`} onClick={() => toggleSection('diagnostics')}>
          <span className="sp-section-arrow">{openSections.diagnostics ? '\u25be' : '\u25b8'}</span> Diagnostics &amp; Performance
        </button>
        {openSections.diagnostics && <>
          <div className="setting-group">
            <label className="setting-label">⚡ Performance metrics</label>
            <small className="setting-hint">Baseline timings collected locally on this device. Startup = app launch → ready; First-token (TTFT) = chat request → first streamed token.</small>
            {(() => {
              const hasData = !!perfStats && (perfStats.startup.count > 0 || perfStats.firstToken.count > 0);
              if (perfLoading && !perfStats) {
                return <div className="perf-empty">Loading metrics…</div>;
              }
              if (!hasData) {
                return <div className="perf-empty">No performance samples yet. Use HomeBot for a bit — startup and chat timings will appear here.</div>;
              }
              const Sparkline = ({ series }: { series: number[] }) => {
                const geo = buildSparkline(series, { width: 120, height: 26, padding: 3 });
                if (!geo.hasData) return null;
                return (
                  <svg
                    className="perf-sparkline"
                    width={geo.width}
                    height={geo.height}
                    viewBox={`0 0 ${geo.width} ${geo.height}`}
                    role="img"
                    aria-label={`Trend of last ${series.length} samples — min ${geo.min} ms, max ${geo.max} ms, latest ${geo.last} ms`}
                    preserveAspectRatio="none"
                  >
                    <path d={geo.areaPath} fill="currentColor" fillOpacity={0.12} stroke="none" />
                    <path d={geo.linePath} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                    {geo.points.length > 0 && (
                      <circle cx={geo.points[geo.points.length - 1].x} cy={geo.points[geo.points.length - 1].y} r={2} fill="currentColor" />
                    )}
                  </svg>
                );
              };
              const Row = ({ title, stat, series }: { title: string; stat: PerfStatSummary; series: number[] }) => (
                <div className="perf-row">
                  <div className="perf-row-title">{title}</div>
                  {stat.count > 0 ? (
                    <div className="perf-badges">
                      <span className="perf-badge perf-badge-p50" title="The typical result — half of runs were faster">p50 {stat.p50_ms} ms</span>
                      <span className="perf-badge perf-badge-p95" title="A slow run — only 1 in 20 was slower than this">p95 {stat.p95_ms} ms</span>
                      <span className="perf-badge-meta">avg {stat.avg_ms} · min {stat.min_ms} · max {stat.max_ms} · n={stat.count}</span>
                    </div>
                  ) : (
                    <div className="perf-badges"><span className="perf-badge-meta">no samples</span></div>
                  )}
                  {series.length > 1 && (
                    <div className="perf-trend" title={`Last ${series.length} samples (oldest → newest)`}>
                      <Sparkline series={series} />
                      <span className="perf-trend-label">last {series.length} · latest {series[series.length - 1]} ms</span>
                    </div>
                  )}
                </div>
              );
              const startupSeries = perfHistory?.startup ?? [];
              const firstTokenSeries = perfHistory?.firstToken ?? [];
              const advice = buildPerfAdvice(perfStats);
              const overallLabel = advice.overall === 'good' ? 'Good' : advice.overall === 'fair' ? 'A bit slow' : 'Slow';
              const healthColor = advice.overall === 'good' ? '#3fb950' : advice.overall === 'fair' ? '#d29922' : '#f85149';
              return (
                <div className="perf-metrics">
                  {advice.overall !== 'unknown' && (
                    <div
                      className={`perf-health perf-health-${advice.overall}`}
                      title="How healthy HomeBot is, based on how long it takes to start and to begin replying"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0 8px', fontSize: 13, fontWeight: 600 }}
                    >
                      <span
                        className="perf-health-dot"
                        aria-hidden="true"
                        style={{ width: 9, height: 9, borderRadius: '50%', background: healthColor, display: 'inline-block', flex: '0 0 auto' }}
                      />
                      <span className="perf-health-label">Performance health: {overallLabel}</span>
                    </div>
                  )}
                  {advice.hints.length > 0 && (
                    <ul className="perf-health-hints" style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 12, opacity: 0.85, lineHeight: 1.45 }}>
                      {advice.hints.map((h, i) => (<li key={i}>{h}</li>))}
                    </ul>
                  )}
                  <Row title="Startup" stat={perfStats!.startup} series={startupSeries} />
                  <Row title="How long until the reply starts appearing" stat={perfStats!.firstToken} series={firstTokenSeries} />
                </div>
              );
            })()}
            <button type="button" className="button button-cancel" style={{ marginTop: 8 }} onClick={() => { void loadPerfStats(); }} disabled={perfLoading}>
              {perfLoading ? 'Refreshing\u2026' : 'Refresh'}
            </button>
          </div>

          <div className="setting-group">
            <label className="setting-label">\ud83d\ude80 First-time setup</label>
            <small className="setting-hint">
              Choose again where HomeBot's thinking happens \u2014 on this PC or online \u2014 or
              finish a setup you skipped. Nothing you have already configured is lost.
            </small>
            {/* "Skip setup" on the welcome screen used to be a one-way door:
                someone who skipped before understanding the choice had no way
                back to it, ever. This is the way back. */}
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('homebot:reopen-first-run'));
                onClose?.();
              }}
            >
              Run first-time setup again
            </button>
          </div>
          <div className="setting-group">
            <label className="setting-label">\ud83e\ude7a System check</label>
            <small className="setting-hint">Re-run the first-run environment checks on demand: disk space, Ollama / n8n / Qdrant reachability, write permissions, and detected GPU.</small>
            {sysCheckError && <div className="perf-empty">{sysCheckError}</div>}
            {sysCheck && (() => {
              const dotColor = (ok: boolean | null) => ok === null ? '#8b949e' : ok ? '#3fb950' : '#f85149';
              const Item = ({ label, ok, detail }: { label: string; ok: boolean | null; detail?: string }) => (
                <div className="syscheck-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '2px 0' }}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: dotColor(ok), display: 'inline-block' }} />
                  <span style={{ fontWeight: 600 }}>{label}</span>
                  {detail && <span style={{ opacity: 0.8 }}>\u2014 {detail}</span>}
                </div>
              );
              const svc = (s: { reachable: boolean; latencyMs: number | null }) =>
                s.reachable ? `online${s.latencyMs != null ? ` (${s.latencyMs} ms)` : ''}` : 'offline';
              return (
                <div className="syscheck-results" style={{ marginTop: 6 }}>
                  <Item label="Disk space" ok={sysCheck.disk.ok} detail={sysCheck.disk.freeGB != null ? `${sysCheck.disk.freeGB.toFixed(1)} GB free${sysCheck.disk.warning ? ` \u2014 ${sysCheck.disk.warning}` : ''}` : 'unknown'} />
                  <Item label="Ollama" ok={sysCheck.ollama.reachable} detail={svc(sysCheck.ollama)} />
                  <Item label="n8n" ok={sysCheck.n8n.reachable} detail={svc(sysCheck.n8n)} />
                  <Item label="Qdrant" ok={sysCheck.qdrant.reachable} detail={svc(sysCheck.qdrant)} />
                  <Item label="Write permissions" ok={sysCheck.permissions.canWrite} detail={sysCheck.permissions.canWrite ? 'OK' : 'cannot write to userData'} />
                  <Item label="GPU" ok={sysCheck.hardware.vramGB != null ? true : null} detail={sysCheck.hardware.vramGB != null ? `${sysCheck.hardware.gpuName ?? 'GPU'} \u00b7 ${sysCheck.hardware.vramGB} GB${sysCheck.hardware.profile ? ` \u00b7 ${sysCheck.hardware.profile}` : ''}` : 'not detected'} />
                  <small className="setting-hint" style={{ display: 'block', marginTop: 4 }}>Last run: {new Date(sysCheck.timestamp).toLocaleTimeString()}</small>
                </div>
              );
            })()}
            <button type="button" className="button button-cancel" style={{ marginTop: 8 }} onClick={() => { void runSystemCheck(); }} disabled={sysCheckLoading}>
              {sysCheckLoading ? 'Checking\u2026' : (sysCheck ? 'Re-run system check' : 'Run system check')}
            </button>
            <Tooltip content="Copy a summary of how HomeBot is running, to paste into a support message">
              <button type="button" className="button button-cancel" style={{ marginTop: 8, marginLeft: 8 }} onClick={() => { void copySupportReport(); }}>
                {reportCopied ? '\u2713 Copied' : '\ud83d\udccb Copy support report'}
              </button>
            </Tooltip>
          </div>
        </>}
    </>
  );
}

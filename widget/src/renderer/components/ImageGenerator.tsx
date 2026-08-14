import React, { useState, useEffect } from 'react';

/**
 * One plain sentence about a finished image.
 *
 * `metadata` is `{ prompt, width, height, steps, seed, model }`, where `model`
 * is really the backend that produced it. Whether it was made on this PC is the
 * one fact a privacy-minded person actually wants back, so it leads.
 */
function describeImage(m: { width?: number; height?: number; model?: string } | null): string {
  if (!m) return '';
  const source = String(m.model || '').toLowerCase();
  const onThisPc = /sd-?cpp|automatic|comfy|local/.test(source);
  const where = source
    ? onThisPc
      ? 'Made on this PC — it never left your computer.'
      : 'Made online.'
    : 'Done.';
  const size = m.width && m.height ? ` ${m.width} × ${m.height} pixels.` : '';
  return `${where}${size}`;
}
import { isGateBlocked } from '../../shared/upgrade';
import type { UpgradePrompt } from '../../shared/types';
import UpgradeModal from './UpgradeModal';

interface SDCppStatus {
  ready: boolean;
  hasBinary: boolean;
  hasModel: boolean;
  dir: string;
  modelsDir: string;
}

const ImageGenerator: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('realistic');
  const [resolution, setResolution] = useState('512x512');
  const [backend, setBackend] = useState('hybrid');
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<any>(null);
  const [statusBanner, setStatusBanner] = useState<{ level: 'green'|'yellow'|'red'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sdCppStatus, setSdCppStatus] = useState<SDCppStatus | null>(null);
  const [setupInfo, setSetupInfo] = useState<string[] | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);

  useEffect(() => {
    (window as any).electron?.sdCppStatus?.().then((s: SDCppStatus) => setSdCppStatus(s));
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);
    setGeneratedImage(null);
    setMetadata(null);
    setStatusBanner(null);

    try {
      const payload = {
        prompt: prompt.trim(),
        style,
        resolution,
        backend
      };

      const result = await (window as any).electron?.executeImageGenerate?.({ action: 'generate', payload });

      if (!result) {
        setError('No response from image generator');
        return;
      }

      if (isGateBlocked(result)) {
        setUpgradePrompt(result.upgrade);
        return;
      }

      if (result.status === 'success' && result.image) {
        setGeneratedImage(`data:image/png;base64,${result.image}`);
        setMetadata(result.metadata || {});
        setStatusBanner({ level: 'green', text: `Generated via ${result.source || 'unknown'}` });
      } else {
        setError(result.error?.message || 'Image generation failed');
        setStatusBanner({ level: 'red', text: 'Failed' });
      }
    } catch (err) {
      setError('Error generating image');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSDCpp = async () => {
    const result = await (window as any).electron?.sdCppSetup?.();
    if (result?.success) {
      setSetupInfo(null);
      setSdCppStatus({ ready: true, hasBinary: true, hasModel: true, dir: result.dir || '', modelsDir: result.modelsDir || '' });
    } else if (result?.instructions) {
      setSetupInfo(result.instructions);
    }
  };

  const refreshStatus = async () => {
    const s = await (window as any).electron?.sdCppStatus?.();
    setSdCppStatus(s);
    if (s?.ready) setSetupInfo(null);
  };

  return (
    <div className="image-generator">
      <header className="image-header">
        <h1>Image Generation <span className="sp-pro-badge" title="Requires HomeBot Pro">⭐ PRO</span></h1>
        <p>Create images with AI</p>
      </header>

      <div className="image-form">
        <div className="form-group">
          <label htmlFor="prompt">Prompt:</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image you want to generate..."
            rows={3}
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="style">Style:</label>
            <select id="style" value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="realistic">Realistic</option>
              <option value="artistic">Artistic</option>
              <option value="cartoon">Cartoon</option>
              <option value="anime">Anime</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="resolution">Size:</label>
            {/* The pixel dimensions stay as the value — they are what the
                backend needs — but the label says what the choice means to
                someone who does not think in pixels. */}
            <select id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              <option value="256x256">Small — fastest</option>
              <option value="512x512">Medium — recommended</option>
              <option value="1024x1024">Large — slowest, most detail</option>
            </select>
          </div>

          <div className="form-group">
            {/* Was "Backend:" with "Hybrid (local first) / Local only / Cloud
                only (free)". Three words a non-technical person does not have,
                for a choice that is really about privacy vs. needing internet. */}
            <label htmlFor="backend">Where to make it:</label>
            <select id="backend" value={backend} onChange={(e) => { setBackend(e.target.value); setSetupInfo(null); }}>
              <option value="hybrid">Best available</option>
              <option value="local">Only on this PC — private</option>
              <option value="cloud">Online — free, no account</option>
            </select>
          </div>
        </div>

        {backend === 'local' && sdCppStatus && !sdCppStatus.ready && (
          <div className="sd-cpp-setup">
            {/* "Missing: sd.exe" and "Missing: model file" name two files the
                reader has never heard of and cannot act on. What they need is
                what it costs them and what to do — and, since this route is a
                manual download, the fact that there is a free alternative that
                works right now. */}
            <div className="setup-status">
              <span className="status-dot red" />
              <span>Making images on this PC needs a one-time setup</span>
              <span className="setup-detail">
                It is free, but it means downloading two files by hand. You can
                use “Online — free, no account” instead and start straight away.
              </span>
            </div>
            <div className="setup-actions">
              <button type="button" className="setup-btn" onClick={handleSetupSDCpp}>
                Show me how
              </button>
              <button type="button" className="setup-btn secondary" onClick={refreshStatus}>
                I've done it — check again
              </button>
            </div>
            {setupInfo && (
              <div className="setup-instructions">
                <strong>What to do:</strong>
                <ol>
                  {setupInfo.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
                <p className="setup-note">
                  Once both files are in place, choose “I've done it — check again”.
                </p>
              </div>
            )}
          </div>
        )}

        {backend === 'local' && sdCppStatus?.ready && (
          <div className="sd-cpp-setup">
            <div className="setup-status">
              <span className="status-dot green" />
              <span>Ready — images will be made on this PC and never leave it</span>
            </div>
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="generate-btn"
        >
          {loading ? 'Generating...' : 'Generate Image'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {statusBanner && (
        <div className={`status-banner ${statusBanner.level}`}>{statusBanner.text}</div>
      )}

      {generatedImage && (
        <div className="image-display">
          <img src={generatedImage} alt="Generated" className="img-gen-result" />
          <div className="image-actions">
            <button type="button" onClick={() => setGeneratedImage(null)} aria-label="Clear image">Clear</button>
            <a href={generatedImage} download={`homebot-image-${Date.now()}.png`} className="btn-download">Download</a>
          </div>
          {/* Was a raw `JSON.stringify(metadata, null, 2)` dumped into a <pre>.
              Nobody outside this repo can read that, and it was the only thing
              shown about a finished image. The facts a person actually wants —
              where it was made and how big it is — are now a sentence, and the
              JSON is still one click away for when something needs debugging. */}
          {metadata && (
            <div className="image-metadata">
              <p className="image-made-summary">{describeImage(metadata)}</p>
              <details>
                <summary>Technical details</summary>
                <pre>{JSON.stringify(metadata, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      )}
      <UpgradeModal prompt={upgradePrompt} onClose={() => setUpgradePrompt(null)} />
    </div>
  );
};

export default ImageGenerator;

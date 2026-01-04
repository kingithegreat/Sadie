import React, { useState } from 'react';

interface ImageGeneratorProps {}

const ImageGenerator: React.FC<ImageGeneratorProps> = () => {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('realistic');
  const [resolution, setResolution] = useState('512x512');
  const [backend, setBackend] = useState('stability');
  const [loading, setLoading] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);
    setGeneratedImage(null);

    try {
      // Call the n8n workflow
      const result = await window.electron.callTool({
        tool: 'image_generate',
        parameters: {
          prompt: prompt.trim(),
          style,
          resolution,
          backend
        }
      });

      if (result.success && result.data?.image_base64) {
        setGeneratedImage(`data:image/png;base64,${result.data.image_base64}`);
      } else {
        setError(result.error || 'Failed to generate image');
      }
    } catch (err) {
      setError('Error generating image');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="image-generator">
      <header className="image-header">
        <h1>🎨 Image Generation</h1>
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
            <label htmlFor="resolution">Resolution:</label>
            <select id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              <option value="256x256">256x256</option>
              <option value="512x512">512x512</option>
              <option value="1024x1024">1024x1024</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="backend">Backend:</label>
            <select id="backend" value={backend} onChange={(e) => setBackend(e.target.value)}>
              <option value="stability">Stability AI</option>
              <option value="local">Local (SD)</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading || !prompt.trim()}
          className="generate-btn"
        >
          {loading ? 'Generating...' : 'Generate Image'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {generatedImage && (
        <div className="image-display">
          <img src={generatedImage} alt="Generated" />
          <button onClick={() => setGeneratedImage(null)}>Clear</button>
        </div>
      )}
    </div>
  );
};

export default ImageGenerator;
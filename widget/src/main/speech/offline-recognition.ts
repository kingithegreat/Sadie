/**
 * HomeBot Offline Speech Recognition
 * 
 * Uses @huggingface/transformers (the official successor to @xenova/transformers,
 * same maintainer/project, renamed on npm in the v3 release - same pipeline() API,
 * same env object, same Tensor output shape) to run Whisper locally for offline
 * speech-to-text. The model runs entirely in JavaScript - no native dependencies needed.
 */

import { BrowserWindow } from 'electron';

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export interface ModelStatus {
  ready: boolean;
  loading: boolean;
  progress?: number;
  modelName?: string;
  error?: string;
}

class OfflineSpeechRecognition {
  private status: ModelStatus = { ready: false, loading: false };

  getStatus(): ModelStatus {
    return { ...this.status };
  }

  /**
   * Initialize the model in the renderer process
   * This will download the model on first use (~75MB for tiny.en)
   */
  async initializeInRenderer(window: BrowserWindow): Promise<boolean> {
    if (this.status.ready) return true;
    if (this.status.loading) return false;

    this.status.loading = true;

    try {
      // Run initialization in renderer process where @huggingface/transformers works best
      const result = await window.webContents.executeJavaScript(`
        (async function() {
          try {
            // Check if already initialized
            if (window.homebotWhisperPipeline) {
              return { success: true, message: 'Already initialized' };
            }

            console.log('[HomeBot] Loading Whisper model for offline speech recognition...');
            
            // Dynamic import of transformers
            const { pipeline } = await import('@huggingface/transformers');
            
            // Create speech recognition pipeline
            // This will download the model on first use
            window.homebotWhisperPipeline = await pipeline(
              'automatic-speech-recognition',
              'Xenova/whisper-tiny.en',
              { 
                progress_callback: (progress) => {
                  if (progress.status === 'progress') {
                    window.homebotWhisperProgress = Math.round(progress.progress);
                    console.log('[HomeBot] Model loading:', Math.round(progress.progress) + '%');
                  }
                }
              }
            );
            
            console.log('[HomeBot] Whisper model loaded successfully');
            return { success: true, message: 'Model loaded' };
          } catch (err) {
            console.error('[HomeBot] Failed to load Whisper model:', err);
            return { success: false, error: err.message };
          }
        })()
      `);

      if (result.success) {
        this.status.ready = true;
        this.status.loading = false;
        console.log('[HomeBot Speech] Offline recognition ready');
        return true;
      } else {
        this.status.loading = false;
        this.status.error = result.error;
        return false;
      }
    } catch (err: any) {
      this.status.loading = false;
      this.status.error = err.message;
      console.error('[HomeBot Speech] Init error:', err);
      return false;
    }
  }

  /**
   * Transcribe audio data
   * @param audioData - Base64 encoded audio or audio URL
   */
  async transcribe(window: BrowserWindow, audioData: string): Promise<TranscriptionResult> {
    if (!this.status.ready) {
      await this.initializeInRenderer(window);
    }

    const result = await window.webContents.executeJavaScript(`
      (async function() {
        try {
          if (!window.homebotWhisperPipeline) {
            return { success: false, error: 'Model not loaded' };
          }

          const audioInput = ${JSON.stringify(audioData)};
          
          // Transcribe
          const output = await window.homebotWhisperPipeline(audioInput, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: false
          });
          
          return { success: true, text: output.text || '' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      })()
    `);

    if (result.success) {
      return { text: result.text.trim() };
    } else {
      throw new Error(result.error || 'Transcription failed');
    }
  }
}

// Singleton instance
let instance: OfflineSpeechRecognition | null = null;

export function getOfflineSpeechRecognition(): OfflineSpeechRecognition {
  if (!instance) {
    instance = new OfflineSpeechRecognition();
  }
  return instance;
}

export { OfflineSpeechRecognition };

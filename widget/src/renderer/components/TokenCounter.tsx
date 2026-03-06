import React, { useMemo } from 'react';
import type { ChatMessage } from '../types';

interface TokenCounterProps {
  messages: ChatMessage[];
  model: string;
}

// Approximate context windows for known Ollama models
const MODEL_CONTEXT: Record<string, number> = {
  'qwen2.5:7b': 32768,
  'qwen2.5:3b': 32768,
  'qwen2.5:14b': 32768,
  'qwen2.5:32b': 32768,
  'qwen2.5-coder:3b': 32768,
  'qwen2.5-coder:7b': 32768,
  'qwen2.5-coder:14b': 32768,
  'deepseek-coder-v2:latest': 65536,   // DeepSeek Coder V2: 64k native
  'llama3.2:3b': 131072,               // Llama 3.2: 128k native
  'llama3.2:1b': 131072,
  'llama3.1:8b': 131072,               // Llama 3.1: 128k native
  'llama3.1:70b': 131072,
  'llama3:latest': 8192,               // Original Llama 3: 8k
  'mistral:latest': 32768,             // Mistral 7B v0.3: 32k ✓
  'mistral-nemo:latest': 131072,       // Mistral Nemo: 128k
  'mixtral:latest': 32768,
  'dolphin-llama3:8b': 8192,
  'phi3:mini': 131072,                 // Phi-3 Mini: 128k native
  'phi3:medium': 131072,               // Phi-3 Medium: 128k native
  'phi3.5:latest': 131072,             // Phi-3.5: 128k native
  'gemma:2b': 8192,
  'gemma:7b': 8192,
  'gemma2:latest': 8192,               // Gemma 2: 8k Ollama default
  'gemma2:2b': 8192,
  'llava:latest': 8192,                // LLaVA: 8k in Ollama
  'llava:7b': 8192,
  'llava:13b': 8192,
  'bakllava:latest': 8192,
  'moondream:latest': 2048,
  'codellama:latest': 16384,
};

function getContextLimit(model: string): number {
  if (MODEL_CONTEXT[model]) return MODEL_CONTEXT[model];
  // Fuzzy match: check if any key is a prefix of the model name
  for (const key of Object.keys(MODEL_CONTEXT)) {
    if (model.startsWith(key.split(':')[0])) return MODEL_CONTEXT[key];
  }
  return 8192; // safe default
}

const TokenCounter: React.FC<TokenCounterProps> = ({ messages, model }) => {
  const { estTokens, remaining, limit, pct } = useMemo(() => {
    const tokens = messages
      .filter(m => m.role !== 'system')
      .reduce((sum, m) => sum + Math.ceil((m.content?.length || 0) / 4), 0);
    const ctx = getContextLimit(model);
    const used = Math.min(tokens, ctx);
    return {
      estTokens: used,
      remaining: Math.max(0, ctx - used),
      limit: ctx,
      pct: Math.min(tokens / ctx, 1),
    };
  }, [messages, model]);

  // Color reflects how much is LEFT: green = plenty, amber = getting tight, red = critical
  const color = pct < 0.6 ? '#34c759' : pct < 0.85 ? '#ff9f0a' : '#ff3b30';
  // Bar fills left-to-right as tokens are consumed
  const pctDisplay = Math.round(pct * 100);

  const fmtNum = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div
      className="token-counter"
      title={`~${remaining.toLocaleString()} tokens remaining of ${limit.toLocaleString()} (used ~${estTokens.toLocaleString()}, estimated via chars ÷ 4)`}
      style={{ '--token-color': color, '--token-bar-width': `${pctDisplay}%` } as React.CSSProperties}
    >
      {/* Depletion bar: fills as context fills up */}
      <div className="token-bar-track">
        <div className="token-bar-fill" />
      </div>
      <span className="token-remaining">
        ~{fmtNum(remaining)}
      </span>
      <span className="token-label">left</span>
    </div>
  );
};

export default TokenCounter;

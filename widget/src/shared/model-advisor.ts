export type TaskIntent = 'chat' | 'coding' | 'tool-use' | 'vision' | 'document' | 'reasoning';

export interface RecommendModelOptions {
  message: string;
  installedModels: string[];
  chatModel?: string;
  codeModel?: string;
  visionModel?: string;
  hasImages?: boolean;
  hasDocuments?: boolean;
}

export interface ModelRecommendation {
  task: TaskIntent;
  recommendedModel: string;
  currentModel: string;
  reason: string;
}

const CODING_QUERY_PATTERN = /\b(write\s+(code|a\s+script|a\s+function|a\s+program)|create\s+(a\s+script|a\s+function|a\s+class|a\s+program)|generate\s+code|fix\s+(this\s+)?code|debug|refactor|optimise|optimize|implement|explain\s+this\s+code|review.*code|code.*review|algorithm|regex|(?:write|run)\s+(?:a\s+)?(?:sql|query)|script|bash|python|javascript|typescript|html|css|java(?!script)|c\+\+|golang|rust|react|\bcode\b)\b/i;
const FILESYSTEM_ACTION_PATTERN = /\b(read|write|create|delete|remove|rename|move|copy|open|save|edit|update|list)\s+(?:a\s+)?(file|folder|directory|repo|repository|project)\b/i;
const TERMINAL_ACTION_PATTERN = /\b(run|execute|launch|start|stop|restart|kill)\b.*\b(command|terminal|shell|script|npm|pnpm|yarn|pip|cargo|docker|pytest|jest|build|test|lint|git)\b/i;
const LIVE_DATA_PATTERN = /\b(weather|forecast|temperature|rain|snow|wind|humidity|news|headline|score|scores|game|games|match|matches|nba|basketball|football|soccer|baseball|stock|price|prices|traffic|flight|flights|latest|current|today|tonight|right now)\b/i;
const WEB_ACTION_PATTERN = /\b(search|look up|browse|google|web|website|url|headline|news|find online|check online)\b/i;
const ORGANIZER_ACTION_PATTERN = /\b(email|mail|calendar|schedule|meeting|appointment|reminder|notify|notification|clipboard|contact|contacts|process|task manager|cpu|memory usage|ram usage)\b/i;
const REASONING_PATTERN = /\b(compare|trade-?off|tradeoffs|plan|design|architecture|evaluate|analysis|analyze|reason|think through|pros and cons)\b/i;

function normalizeInstalledModels(models: string[]): Map<string, string> {
  return new Map(models.map((model) => [normalizeModelId(model), model]));
}

function pickInstalledModel(preferences: string[], installedModels: string[]): string | null {
  const installed = normalizeInstalledModels(installedModels);
  for (const preference of preferences) {
    if (!preference) continue;
    const match = installed.get(normalizeModelId(preference));
    if (match) return match;
  }
  return null;
}

function currentModelForTask(task: TaskIntent, options: RecommendModelOptions): string {
  if (task === 'vision') return options.visionModel || options.chatModel || '';
  if (task === 'coding') return options.codeModel || options.chatModel || '';
  return options.chatModel || '';
}

export function normalizeModelId(id: string): string {
  return (id || '')
    .toLowerCase()
    .replace(/:latest\b/g, '')
    .replace(/[^a-z0-9.+-]/g, '');
}

export function classifyTaskIntent(message: string, options?: { hasImages?: boolean; hasDocuments?: boolean }): TaskIntent {
  if (options?.hasImages) return 'vision';
  if (FILESYSTEM_ACTION_PATTERN.test(message) || TERMINAL_ACTION_PATTERN.test(message) || WEB_ACTION_PATTERN.test(message) || ORGANIZER_ACTION_PATTERN.test(message) || LIVE_DATA_PATTERN.test(message)) {
    return 'tool-use';
  }
  if (CODING_QUERY_PATTERN.test(message)) return 'coding';
  if (options?.hasDocuments) return 'document';
  if (REASONING_PATTERN.test(message)) return 'reasoning';
  return 'chat';
}

export function shouldOfferToolsForMessage(message: string, options?: { hasImages?: boolean; hasDocuments?: boolean }): boolean {
  if (options?.hasImages) return false;

  const hasExplicitAction = FILESYSTEM_ACTION_PATTERN.test(message)
    || TERMINAL_ACTION_PATTERN.test(message)
    || ORGANIZER_ACTION_PATTERN.test(message)
    || (WEB_ACTION_PATTERN.test(message) && LIVE_DATA_PATTERN.test(message));

  if (hasExplicitAction) return true;
  if (LIVE_DATA_PATTERN.test(message) && !CODING_QUERY_PATTERN.test(message)) return true;
  if (options?.hasDocuments) return FILESYSTEM_ACTION_PATTERN.test(message) || WEB_ACTION_PATTERN.test(message);
  if (CODING_QUERY_PATTERN.test(message)) return FILESYSTEM_ACTION_PATTERN.test(message) || TERMINAL_ACTION_PATTERN.test(message);
  return false;
}

export function recommendLocalModelForTask(options: RecommendModelOptions): ModelRecommendation | null {
  const task = classifyTaskIntent(options.message, {
    hasImages: options.hasImages,
    hasDocuments: options.hasDocuments,
  });
  const currentModel = currentModelForTask(task, options);

  const preferredModels = task === 'vision'
    ? [options.visionModel || '', 'llava', 'moondream']
    : task === 'coding'
      ? [options.codeModel || '', 'qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'qwen2.5-coder:3b', 'qwen2.5:14b', 'qwen2.5:7b']
      : task === 'tool-use'
        ? ['qwen2.5:14b', 'qwen2.5:7b', 'qwen2.5:3b', 'phi4-mini', 'qwen2.5-coder:7b']
        : task === 'reasoning'
          ? ['qwen2.5:14b', 'qwen2.5:7b', 'phi4-mini', 'gemma4:e4b', 'gemma4:e2b', 'llama3.1:8b']
          : ['qwen2.5:14b', 'qwen2.5:7b', 'phi4-mini', 'gemma4:e4b', 'gemma4:e2b', options.chatModel || ''];

  const recommendedModel = pickInstalledModel(preferredModels, options.installedModels);
  if (!recommendedModel || normalizeModelId(recommendedModel) === normalizeModelId(currentModel)) {
    return null;
  }

  const reason = task === 'coding'
    ? 'Coder-tuned Qwen variants handle code generation, edits, and tool-heavy dev tasks more reliably.'
    : task === 'tool-use'
      ? 'Qwen 2.5 is the strongest local tool-calling family in this setup.'
      : task === 'vision'
        ? 'A vision model will handle image inputs more reliably than the general chat model.'
        : task === 'reasoning'
          ? 'This task benefits from the stronger general reasoning model you already have installed.'
          : 'Your stronger general chat model should handle this request more reliably.';

  return {
    task,
    recommendedModel,
    currentModel,
    reason,
  };
}
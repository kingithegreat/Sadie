/** Approved composition adapter: Studio keeps its engines and existing file formats. */
import type { TrustedModuleDefinitionV1 } from '../host';
import type { ToolDefinition, ToolHandler } from '../../tools/types';
import { mediaToolDefs, mediaToolHandlers } from '../../tools/media';
import { narrateClipToolDefs, narrateClipToolHandlers } from '../../tools/narrate-clip';
import { characterSpriteToolDefs, characterSpriteToolHandlers } from '../../tools/character-sprites';
import { movieToolDefs, movieToolHandlers } from '../../tools/media-movie';
import { videoToolDefs, videoToolHandlers } from '../../tools/media-video';
import { storyboardToolDefs, storyboardToolHandlers } from '../../tools/media-storyboard';

export const STUDIO_MODULE_ID = 'homebot.production-studio';

const groups: Array<[ToolDefinition[], Record<string, ToolHandler>]> = [
  [mediaToolDefs, mediaToolHandlers], [narrateClipToolDefs, narrateClipToolHandlers],
  [characterSpriteToolDefs, characterSpriteToolHandlers], [movieToolDefs, movieToolHandlers],
  [videoToolDefs, videoToolHandlers], [storyboardToolDefs, storyboardToolHandlers],
];
const tools = groups.flatMap(([definitions, handlers]) => definitions.map(definition => ({ definition, handler: handlers[definition.name] })));

export const bundledStudioModule: TrustedModuleDefinitionV1 = {
  manifest: {
    schemaVersion: 1, id: STUDIO_MODULE_ID, publisher: 'HomeBot', version: '1.0.0',
    hostApi: { min: '1.0.0', maxExclusive: '2.0.0' },
    display: { name: 'Production Studio', description: 'Plan, create, edit and review your videos.' },
    platforms: ['win32', 'darwin', 'linux'], dependencies: [],
    optionalIntegrations: ['n8n', 'ancient-pathways', 'colab', 'comfyui'],
    contributions: { commands: tools.map(({ definition }) => `${STUDIO_MODULE_ID}.${definition.name}`), views: [], settings: [], providers: [] },
    permissions: [...new Set(tools.flatMap(({ definition }) => [definition.name, ...(definition.requiredPermissions || [])]))],
    // No new paid gate: existing issued rights and media access are unchanged.
    grants: [], resources: { gpu: 'optional' }, dataSchemaVersion: 1,
  },
  activate(context) {
    for (const { definition, handler } of tools) {
      if (!handler) throw new Error(`Studio handler missing: ${definition.name}`);
      context.registerTool(`${STUDIO_MODULE_ID}.${definition.name}`, definition, handler);
    }
  },
};

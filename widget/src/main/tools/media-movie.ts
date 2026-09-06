/**
 * media-movie.ts — Autonomous Movie Engine production orchestrator tool.
 *
 * Drives MovieProjectRunner from the HomeBot chat and agentic loops to produce
 * character-consistent movies at $0.00 spend using the 5-provider GenerationRouter.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ToolDefinition, ToolHandler, ToolResult } from './types';
import { MovieProjectRunner } from '../movie/project-runner';

export const mediaProduceMovieDef: ToolDefinition = {
  name: 'media_produce_movie',
  description:
    'Produce or resume a multi-shot movie project using the GenerationRouter and free providers ' +
    '(Ancient Pathways 2D animation, Colab T4 worker, Pollinations, Imagen 3, Local SD 1.5). ' +
    'Executes planned shots, preserves character consistency, logs routing decisions to decision.json ' +
    'and router-decisions.jsonl, and returns a detailed execution report.',
  category: 'media',
  parameters: {
    type: 'object',
    properties: {
      projectDir: {
        type: 'string',
        description: 'Absolute path to the movie project directory containing project.json.',
      },
      freeOnly: {
        type: 'boolean',
        description: 'Enforce hard $0.00 spend invariant (defaults to true). Rejects paid providers.',
      },
      allowDeferred: {
        type: 'boolean',
        description: 'Allow deferring shots to asynchronous workers like Google Colab T4 (defaults to false).',
      },
      allowWatermark: {
        type: 'boolean',
        description: 'Allow watermarked outputs if no clean free provider is available (defaults to false).',
      },
    },
    required: ['projectDir'],
  },
};

export const mediaProduceMovieHandler: ToolHandler = async (
  args: Record<string, any>,
): Promise<ToolResult> => {
  const projectDir = args.projectDir;
  if (!projectDir || typeof projectDir !== 'string') {
    return {
      success: false,
      error: 'projectDir must be a non-empty string path.',
    };
  }

  const resolved = path.resolve(projectDir);
  if (!fs.existsSync(resolved)) {
    return {
      success: false,
      error: `Project directory does not exist: ${resolved}`,
    };
  }

  const projectJsonPath = path.join(resolved, 'project.json');
  if (!fs.existsSync(projectJsonPath)) {
    return {
      success: false,
      error: `No project.json found in ${resolved}. Ensure the movie project is initialized first.`,
    };
  }

  try {
    const report = await MovieProjectRunner.runProject(resolved, {
      freeOnly: args.freeOnly !== false,
      allowDeferred: Boolean(args.allowDeferred),
      allowWatermark: Boolean(args.allowWatermark),
    });

    const lines = [
      `Movie Project "${report.projectId}" Generation Report:`,
      `  Total shots: ${report.totalShots}`,
      `  Completed: ${report.completedShots}`,
      `  Deferred: ${report.deferredShots}`,
      `  Skipped (cached): ${report.skippedShots}`,
      `  Failed: ${report.failedShots}`,
      '',
      'Shot details:',
      ...report.results.map((r) => {
        const detail = r.files ? ` -> ${r.files.map((f: string) => path.basename(f)).join(', ')}` : (r.error ? ` (Error: ${r.error})` : '');
        return `  - [${r.status}] ${r.sceneId}/${r.shotId} via ${r.provider}${detail}`;
      }),
    ];

    return {
      success: report.failedShots === 0,
      result: {
        report,
        summary: lines.join('\n'),
      },
      error: report.failedShots > 0 ? `${report.failedShots} shot(s) failed during production.` : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Movie generation failed: ${err?.message || String(err)}`,
    };
  }
};

export const movieToolDefs: ToolDefinition[] = [mediaProduceMovieDef];
export const movieToolHandlers: Record<string, ToolHandler> = {
  media_produce_movie: mediaProduceMovieHandler,
};

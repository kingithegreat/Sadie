/**
 * SADIE Memory Tools
 * 
 * Provides long-term memory using Qdrant vector database.
 * Stores and retrieves memories semantically.
 */

import { ToolDefinition, ToolHandler, ToolResult } from './types';
import axios from 'axios';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const COLLECTION_NAME = 'sadie_memories';
const EMBEDDING_MODEL = 'nomic-embed-text';

// ============= HELPER FUNCTIONS =============

// Get embedding from Ollama
async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await axios.post(`${OLLAMA_URL}/api/embeddings`, {
      model: EMBEDDING_MODEL,
      prompt: text
    });
    return response.data.embedding;
  } catch (error: any) {
    console.error('Failed to get embedding:', error.message);
    throw new Error(`Embedding failed: ${error.message}`);
  }
}

// Ensure collection exists
async function ensureCollection(): Promise<void> {
  try {
    // Check if collection exists
    const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
    if (response.status === 200) return;
  } catch (error: any) {
    if (error.response?.status === 404) {
      // Create collection with 768 dimensions (nomic-embed-text)
      await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
        vectors: {
          size: 768,
          distance: 'Cosine'
        }
      });
      console.log('[Memory] Created Qdrant collection:', COLLECTION_NAME);
    } else {
      throw error;
    }
  }
}

// ============= TOOL DEFINITIONS =============

export const rememberDef: ToolDefinition = {
  name: 'remember',
  description: 'Store important information in long-term memory. Use this to remember facts, preferences, or context about the user that should persist across conversations.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember (e.g., "User prefers dark mode", "User\'s name is John")'
      },
      category: {
        type: 'string',
        description: 'Category for the memory (e.g., "preference", "fact", "context", "task")',
        default: 'general'
      }
    },
    required: ['content']
  }
};

export const recallDef: ToolDefinition = {
  name: 'recall',
  description: 'Search long-term memory for relevant information. Use this to recall facts, preferences, or context about the user.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to search for in memory (e.g., "user preferences", "what is user\'s name")'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 5)',
        default: 5
      }
    },
    required: ['query']
  }
};

export const forgetDef: ToolDefinition = {
  name: 'forget',
  description: 'Remove a specific memory from long-term storage. Use when asked to forget something.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      memoryId: {
        type: 'string',
        description: 'The ID of the memory to forget'
      }
    },
    required: ['memoryId']
  }
};

export const listMemoriesDef: ToolDefinition = {
  name: 'list_memories',
  description: 'List all stored memories, optionally filtered by category.',
  category: 'memory',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Filter by category (optional)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 20)',
        default: 20
      }
    },
    required: []
  }
};

// ============= TOOL HANDLERS =============

export const rememberHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const content = args.content;
    if (!content || typeof content !== 'string') {
      return { success: false, error: 'Content is required' };
    }

    const category = args.category || 'general';
    
    // Ensure collection exists
    await ensureCollection();
    
    // Get embedding for the content
    const embedding = await getEmbedding(content);
    
    // Generate unique ID
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    
    // Store in Qdrant
    await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
      points: [{
        id: id,
        vector: embedding,
        payload: {
          content: content,
          category: category,
          createdAt: new Date().toISOString()
        }
      }]
    });

    return {
      success: true,
      result: {
        message: `Remembered: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
        memoryId: id,
        category: category
      }
    };
  } catch (err: any) {
    console.error('Remember error:', err.message);
    return { success: false, error: `Failed to remember: ${err.message}` };
  }
};

export const recallHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const query = args.query;
    if (!query || typeof query !== 'string') {
      return { success: false, error: 'Query is required' };
    }

    const limit = Math.min(args.limit || 5, 20);
    
    // Ensure collection exists
    await ensureCollection();
    
    // Get embedding for the query
    const embedding = await getEmbedding(query);
    
    // Search in Qdrant
    const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
      vector: embedding,
      limit: limit,
      with_payload: true,
      score_threshold: 0.5  // Only return reasonably relevant results
    });

    const memories = response.data.result.map((hit: any) => ({
      id: hit.id,
      content: hit.payload.content,
      category: hit.payload.category,
      createdAt: hit.payload.createdAt,
      relevance: Math.round(hit.score * 100) + '%'
    }));

    if (memories.length === 0) {
      return {
        success: true,
        result: {
          message: 'No relevant memories found.',
          memories: []
        }
      };
    }

    return {
      success: true,
      result: {
        message: `Found ${memories.length} relevant memories`,
        memories: memories
      }
    };
  } catch (err: any) {
    console.error('Recall error:', err.message);
    return { success: false, error: `Failed to recall: ${err.message}` };
  }
};

export const forgetHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const memoryId = args.memoryId;
    if (!memoryId) {
      return { success: false, error: 'Memory ID is required' };
    }

    // Delete from Qdrant
    await axios.post(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
      points: [memoryId]
    });

    return {
      success: true,
      result: {
        message: `Memory ${memoryId} has been forgotten.`
      }
    };
  } catch (err: any) {
    console.error('Forget error:', err.message);
    return { success: false, error: `Failed to forget: ${err.message}` };
  }
};

export const listMemoriesHandler: ToolHandler = async (args): Promise<ToolResult> => {
  try {
    const category = args.category;
    const limit = Math.min(args.limit || 20, 100);
    
    // Ensure collection exists
    await ensureCollection();
    
    // Build filter if category specified
    const filter = category ? {
      must: [{
        key: 'category',
        match: { value: category }
      }]
    } : undefined;
    
    // Scroll through all points
    const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`, {
      limit: limit,
      with_payload: true,
      filter: filter
    });

    const memories = response.data.result.points.map((point: any) => ({
      id: point.id,
      content: point.payload.content,
      category: point.payload.category,
      createdAt: point.payload.createdAt
    }));

    return {
      success: true,
      result: {
        count: memories.length,
        memories: memories
      }
    };
  } catch (err: any) {
    console.error('List memories error:', err.message);
    return { success: false, error: `Failed to list memories: ${err.message}` };
  }
};

// Export all definitions and handlers
export const memoryToolDefs = [
  rememberDef,
  recallDef,
  forgetDef,
  listMemoriesDef
];

export const memoryToolHandlers: Record<string, ToolHandler> = {
  'remember': rememberHandler,
  'recall': recallHandler,
  'forget': forgetHandler,
  'list_memories': listMemoriesHandler
};

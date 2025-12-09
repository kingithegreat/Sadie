/**
 * SADIE Document Tools
 * 
 * Tools for parsing and processing uploaded documents (PDF, Word, text files).
 */

import { ToolDefinition, ToolHandler, ToolResult, ToolContext } from './types';
import * as fs from 'fs';
import * as path from 'path';

// Lazy load document parsers
let pdfParse: any = null;
let mammoth: typeof import('mammoth') | null = null;

async function getPdfParser() {
  if (!pdfParse) {
    const mod = await import('pdf-parse');
    pdfParse = mod.default || mod;
  }
  return pdfParse;
}

async function getMammoth() {
  if (!mammoth) {
    mammoth = await import('mammoth');
  }
  return mammoth;
}

/**
 * Document attachment stored in memory for the current session
 */
interface ParsedDocument {
  id: string;
  filename: string;
  mimeType: string;
  text: string;
  wordCount: number;
  pageCount?: number;
  parsedAt: string;
}

// In-memory store for parsed documents (cleared on restart)
const parsedDocuments = new Map<string, ParsedDocument>();

/**
 * Parse document content from base64 data
 */
async function parseDocumentContent(
  data: string,
  mimeType: string,
  filename: string
): Promise<{ text: string; pageCount?: number }> {
  // Decode base64 to buffer
  const buffer = Buffer.from(data, 'base64');
  
  const ext = path.extname(filename).toLowerCase();
  
  // PDF parsing
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const pdf = await getPdfParser();
    const result = await pdf(buffer);
    return {
      text: result.text,
      pageCount: result.numpages
    };
  }
  
  // Word document parsing (.docx)
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) {
    const mammothLib = await getMammoth();
    const result = await mammothLib.extractRawText({ buffer });
    return { text: result.value };
  }
  
  // Legacy Word document (.doc) - mammoth doesn't support .doc well
  if (mimeType === 'application/msword' || ext === '.doc') {
    // Try mammoth anyway, but warn user
    try {
      const mammothLib = await getMammoth();
      const result = await mammothLib.extractRawText({ buffer });
      if (result.value.trim()) {
        return { text: result.value };
      }
    } catch {
      // Fall through to error
    }
    throw new Error('Legacy .doc files are not fully supported. Please convert to .docx format.');
  }
  
  // Plain text files
  if (
    mimeType.startsWith('text/') ||
    ['.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml', '.log', '.ini', '.conf'].includes(ext)
  ) {
    return { text: buffer.toString('utf-8') };
  }
  
  // Code files
  if (
    ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', 
     '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.sql',
     '.sh', '.bash', '.ps1', '.bat', '.cmd'].includes(ext)
  ) {
    return { text: buffer.toString('utf-8') };
  }
  
  throw new Error(`Unsupported file type: ${mimeType || ext}`);
}

// Tool definitions
export const documentToolDefs: ToolDefinition[] = [
  {
    name: 'parse_document',
    description: 'Parse and extract text content from an uploaded document. Supports PDF, Word (.docx), and text files. Returns the extracted text content for analysis.',
    category: 'document',
    parameters: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'The ID of the uploaded document to parse'
        },
        filename: {
          type: 'string',
          description: 'Original filename of the document (used for type detection)'
        },
        data: {
          type: 'string',
          description: 'Base64-encoded document content'
        },
        mime_type: {
          type: 'string',
          description: 'MIME type of the document (e.g., application/pdf)'
        }
      },
      required: ['document_id', 'data']
    },
    requiresConfirmation: false
  },
  {
    name: 'get_document_content',
    description: 'Retrieve the text content of a previously parsed document by its ID. Use this to access document content that was uploaded earlier in the conversation.',
    category: 'document',
    parameters: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'The ID of the parsed document to retrieve'
        }
      },
      required: ['document_id']
    },
    requiresConfirmation: false
  },
  {
    name: 'list_documents',
    description: 'List all documents that have been uploaded and parsed in the current session. Returns document IDs, filenames, and metadata.',
    category: 'document',
    parameters: {
      type: 'object',
      properties: {},
      required: []
    },
    requiresConfirmation: false
  },
  {
    name: 'search_document',
    description: 'Search for specific text or patterns within a parsed document. Returns matching sections with context.',
    category: 'document',
    parameters: {
      type: 'object',
      properties: {
        document_id: {
          type: 'string',
          description: 'The ID of the document to search'
        },
        query: {
          type: 'string',
          description: 'The text or pattern to search for'
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Whether the search should be case-sensitive (default: false)'
        },
        context_lines: {
          type: 'number',
          description: 'Number of lines of context to include around matches (default: 2)'
        }
      },
      required: ['document_id', 'query']
    },
    requiresConfirmation: false
  }
];

// Tool handlers
export const documentToolHandlers: Record<string, ToolHandler> = {
  parse_document: async (args: Record<string, any>, _context: ToolContext): Promise<ToolResult> => {
    try {
      const { document_id, filename = 'document', data, mime_type = '' } = args;
      
      if (!document_id || !data) {
        return {
          success: false,
          error: 'document_id and data are required'
        };
      }
      
      // Check if already parsed
      if (parsedDocuments.has(document_id)) {
        const existing = parsedDocuments.get(document_id)!;
        return {
          success: true,
          result: {
            document_id: existing.id,
            filename: existing.filename,
            word_count: existing.wordCount,
            page_count: existing.pageCount,
            preview: existing.text.substring(0, 500) + (existing.text.length > 500 ? '...' : ''),
            message: 'Document already parsed. Use get_document_content to retrieve full text.'
          }
        };
      }
      
      // Parse the document
      const { text, pageCount } = await parseDocumentContent(data, mime_type, filename);
      
      // Count words
      const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
      
      // Store parsed document
      const doc: ParsedDocument = {
        id: document_id,
        filename,
        mimeType: mime_type,
        text,
        wordCount,
        pageCount,
        parsedAt: new Date().toISOString()
      };
      
      parsedDocuments.set(document_id, doc);
      
      return {
        success: true,
        result: {
          document_id,
          filename,
          word_count: wordCount,
          page_count: pageCount,
          preview: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
          message: 'Document parsed successfully. Use get_document_content for full text or search_document to find specific content.'
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to parse document: ${err.message}`
      };
    }
  },
  
  get_document_content: async (args: Record<string, any>, _context: ToolContext): Promise<ToolResult> => {
    try {
      const { document_id } = args;
      
      if (!document_id) {
        return {
          success: false,
          error: 'document_id is required'
        };
      }
      
      const doc = parsedDocuments.get(document_id);
      
      if (!doc) {
        return {
          success: false,
          error: `Document not found: ${document_id}. It may not have been parsed yet or the session was restarted.`
        };
      }
      
      return {
        success: true,
        result: {
          document_id: doc.id,
          filename: doc.filename,
          word_count: doc.wordCount,
          page_count: doc.pageCount,
          content: doc.text
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to retrieve document: ${err.message}`
      };
    }
  },
  
  list_documents: async (_args: Record<string, any>, _context: ToolContext): Promise<ToolResult> => {
    try {
      const documents = Array.from(parsedDocuments.values()).map(doc => ({
        document_id: doc.id,
        filename: doc.filename,
        mime_type: doc.mimeType,
        word_count: doc.wordCount,
        page_count: doc.pageCount,
        parsed_at: doc.parsedAt
      }));
      
      return {
        success: true,
        result: {
          count: documents.length,
          documents
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to list documents: ${err.message}`
      };
    }
  },
  
  search_document: async (args: Record<string, any>, _context: ToolContext): Promise<ToolResult> => {
    try {
      const { document_id, query, case_sensitive = false, context_lines = 2 } = args;
      
      if (!document_id || !query) {
        return {
          success: false,
          error: 'document_id and query are required'
        };
      }
      
      const doc = parsedDocuments.get(document_id);
      
      if (!doc) {
        return {
          success: false,
          error: `Document not found: ${document_id}`
        };
      }
      
      // Split into lines for context
      const lines = doc.text.split('\n');
      const searchQuery = case_sensitive ? query : query.toLowerCase();
      const matches: { line_number: number; context: string }[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = case_sensitive ? lines[i] : lines[i].toLowerCase();
        
        if (line.includes(searchQuery)) {
          // Get context lines
          const start = Math.max(0, i - context_lines);
          const end = Math.min(lines.length - 1, i + context_lines);
          const contextLines = lines.slice(start, end + 1);
          
          matches.push({
            line_number: i + 1, // 1-indexed
            context: contextLines.join('\n')
          });
        }
      }
      
      return {
        success: true,
        result: {
          document_id,
          query,
          match_count: matches.length,
          matches: matches.slice(0, 20) // Limit to 20 matches
        }
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Failed to search document: ${err.message}`
      };
    }
  }
};

/**
 * Store a document directly (used when document is received via IPC)
 */
export function storeDocument(id: string, filename: string, mimeType: string, text: string): void {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  
  parsedDocuments.set(id, {
    id,
    filename,
    mimeType,
    text,
    wordCount,
    parsedAt: new Date().toISOString()
  });
}

/**
 * Get a stored document
 */
export function getDocument(id: string): ParsedDocument | undefined {
  return parsedDocuments.get(id);
}

/**
 * Clear all stored documents
 */
export function clearDocuments(): void {
  parsedDocuments.clear();
}

import { documentToolHandlers } from '../tools/documents';
import { preProcessIntent, analyzeAndRouteMessage } from '../routing/pre-processor';

jest.mock('../tools/documents', () => ({
  documentToolHandlers: {
    parse_document: jest.fn(),
    get_document_content: jest.fn()
  }
}));

describe('Document routing integration', () => {
  beforeEach(() => jest.resetAllMocks());

  test('pre-processor ignores document payloads and routing stays on LLM', async () => {
    const mockText = 'This document mentions results and scores but should not trigger nba query.';
    (documentToolHandlers.get_document_content as any).mockResolvedValue({ success: true, result: { content: mockText } });

    // Manually construct a parsed document payload
    const parsedBlock = `=== Document: test.txt ===\n${mockText}\n=== End of test.txt ===`;

    // Now ensure preProcessor does NOT trigger NBA tools for the included content
    const combinedMessage = parsedBlock + '\n\n' + 'report this doc';
    const pre = await preProcessIntent(combinedMessage);
    expect(pre).toBeNull();

    const routing = await analyzeAndRouteMessage(combinedMessage);
    expect(routing.type).toBe('llm');
  });

  test('end-to-end processIncomingRequest with document content returns LLM summary (reflection)', async () => {
    // Mock document content
    const mockText = 'This document explains A* Search and Genetic Algorithms. Key point: A* optimal, GA flexible.';
    (documentToolHandlers.parse_document as any).mockResolvedValue({ success: true, result: { document_id: 'doc-1' } });
    (documentToolHandlers.get_document_content as any).mockResolvedValue({ success: true, result: { content: mockText } });

    // Prepare request similar to streaming pipeline (documents attached)
    const req = {
      user_id: 't',
      conversation_id: 'conv-doc',
      message: 'report this doc',
      documents: [{ id: 'doc-1', filename: 'test.docx', size: mockText.length, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: Buffer.from('dummy').toString('base64') }]
    } as any;

    // Force reflection result (simulate LLM summarization)
    (global as any).__SADIE_TEST_REFLECTION = { outcome: 'accept', confidence: 0.95, final_message: 'Summary: A* is optimal; GA is flexible but heuristic.' };

    const res = await require('../message-router').processIncomingRequest(req, 'http://unused');
    expect(res.success).toBe(true);
    expect(res.data.assistant.content).toContain('Summary');
    expect(res.data.reflection.confidence).toBeCloseTo(0.95);
  });
});
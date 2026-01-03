const fs = require('fs');
const path = require('path');
(async () => {
  try {
    const mr = require('../dist/main').processIncomingRequest || require('../src/main/message-router').processIncomingRequest;
    const samplePath = path.join(__dirname, 'sample-doc.txt');
    const text = fs.existsSync(samplePath) ? fs.readFileSync(samplePath, 'utf-8') : 'This is a sample document about A* Search and Genetic Algorithms. It compares their strengths and weaknesses.';
    const base64 = Buffer.from(text, 'utf-8').toString('base64');
    const req = {
      user_id: 'test-user',
      conversation_id: 'conv-test-1',
      message: '[POLICY:FORCE_DOCUMENT]\nreport this doc',
      documents: [{ id: 'doc-1', filename: 'COMP.7212 - Project (Part 1 - Report).docx', mimeType: 'text/plain', size: Buffer.byteLength(text, 'utf-8'), data: base64 }]
    };
    console.log('Invoking processIncomingRequest with request:', { user_id: req.user_id, conversation_id: req.conversation_id, message: req.message, documents: req.documents.map(d => ({filename:d.filename,size:d.size})) });
    const r = await mr(req, 'http://localhost:5678');
    console.log('ProcessIncomingRequest result:', JSON.stringify(r, null, 2));
  } catch (err) {
    console.error('Error running document test:', err);
    process.exit(1);
  }
})();
const path = require('path');
const axios = require(path.resolve(__dirname, '..', 'widget', 'node_modules', 'axios'));
const { Readable } = require('stream');
const main = require(path.resolve(__dirname, '..', 'widget', 'dist', 'main', 'index.js'));

async function testSportsQuery() {
  console.log('\n=== Sports Query Test ===');

  // Mock axios.post to respond to reflection with accept
  axios.post = async (url, payload) => {
    // reflection call will include messages array with system prompt
    if (payload && payload.messages && payload.messages.some(m => typeof m.content === 'string' && m.content.includes('Return ONLY a single JSON object'))) {
      return { data: { assistant: JSON.stringify({ outcome: 'accept', final_message: 'Lakers vs Warriors on 2024-03-15' }) } };
    }
    // default
    return { data: { data: { assistant: { role: 'assistant', content: '' } } } };
  };

  const res = await main.processIncomingRequest({ user_id: 'tester', message: "What's the Lakers next game?", conversation_id: 'conv' }, 'http://unused');
  console.log('Result:', JSON.stringify(res, null, 2));
}

async function testBasicChat() {
  console.log('\n=== Basic Chat Test ===');
  axios.post = async (url, payload) => {
    // simple LLM reply
    return { data: { data: { assistant: { role: 'assistant', content: 'Hello there! How can I help?' } } } };
  };

  const res = await main.processIncomingRequest({ user_id: 'tester', message: 'hello', conversation_id: 'conv' }, 'http://unused');
  console.log('Result:', JSON.stringify(res, null, 2));
}

async function testStreamingJoke() {
  console.log('\n=== Streaming Joke Test ===');

  // create a readable stream that emits JSON lines
  const jokeChunks = ["Why did the chicken cross the road? ", "To get to the other side!\n"];
  axios.post = async (url, payload) => {
    const stream = new Readable({ read() {} });
    // emit two content messages as lines
    setTimeout(() => stream.push(JSON.stringify({ message: { content: jokeChunks[0] } }) + '\n'), 10);
    setTimeout(() => stream.push(JSON.stringify({ message: { content: jokeChunks[1] } }) + '\n'), 50);
    setTimeout(() => stream.push(JSON.stringify({ done: true }) + '\n'), 100);
    setTimeout(() => stream.push(null), 150);
    return { data: stream };
  };

  let acc = '';
  const onChunk = (txt) => { acc += txt; console.log('[chunk]', txt); };
  const onToolCall = () => {};
  const onToolResult = () => {};
  const onEnd = () => { console.log('[end] Final:', acc); };
  const onError = (err) => { console.error('[error]', err); };

  const handler = await main.streamFromOllamaWithTools('tell me a short joke', undefined, 'conv', onChunk, onToolCall, onToolResult, onEnd, onError);

  // wait for completion
  await new Promise(r => setTimeout(r, 300));
}

async function testCancelLongStory() {
  console.log('\n=== Cancel Long Story Test ===');

  // Create a stream that emits many chunks
  axios.post = async (url, payload) => {
    const stream = new Readable({ read() {} });
    let i = 0;
    const iv = setInterval(() => {
      i += 1;
      stream.push(JSON.stringify({ message: { content: `Chunk ${i} ` } }) + '\n');
      if (i >= 100) {
        clearInterval(iv);
        stream.push(JSON.stringify({ done: true }) + '\n');
        stream.push(null);
      }
    }, 20);
    return { data: stream };
  };

  const chunks = [];
  const onChunk = (txt) => { chunks.push(txt); console.log('[chunk]', txt); };
  const onToolCall = () => {};
  const onToolResult = () => {};
  const onEnd = () => { console.log('[end] chunks received:', chunks.length); };
  const onError = (err) => { console.error('[error]', err); };

  const handler = await main.streamFromOllamaWithTools('write me a very long story', undefined, 'conv', onChunk, onToolCall, onToolResult, onEnd, onError);

  // Cancel after 200ms
  setTimeout(() => {
    console.log('Requesting cancel...');
    handler.cancel();
  }, 200);

  // wait for cancellation to take effect
  await new Promise(r => setTimeout(r, 500));
}

async function runAll() {
  await testSportsQuery();
  await testBasicChat();
  await testStreamingJoke();
  await testCancelLongStory();
  console.log('\nManual dev tests completed');
}

runAll().catch(e => { console.error('Error in manual tests', e); process.exit(1); });

/* Ensure all tests bypass API key + use local upstream */
process.env.PROXY_REQUIRE_API_KEY = 'false';
process.env.PROXY_API_KEYS = '';
process.env.PROXY_ADMIN_KEY = 'test-admin';
process.env.OPENAI_API_KEY = 'test';
process.env.OLLAMA_API_KEY = 'test';

// ensure jest does not leave any global sockets open from undici or other libs
// (no-op placeholder, but useful to centralize test config)

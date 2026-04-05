# Custom LLM API Support

SADIE now supports bringing your own LLM API from providers like OpenAI, Anthropic, OpenRouter, or any custom API endpoint.

## Supported Providers

### OpenAI Compatible
- **OpenAI** (GPT-4, GPT-3.5-turbo, etc.)
- **Azure OpenAI**
- **LocalAI**
- **LM Studio**
- **text-generation-webui** (with OpenAI extension)
- **vLLM** (with OpenAI-compatible endpoint)
- Any other OpenAI-compatible API

### Anthropic
- **Claude Opus 4**
- **Claude Sonnet 4**
- **Claude 3.5 Haiku**
- **Claude 3.5 Sonnet**

### OpenRouter
- Access to 100+ models through a single API
- Includes models from OpenAI, Anthropic, Google, Meta, and more

### Custom
- Any REST API that returns streaming responses
- Configurable for proprietary or self-hosted models

## Configuration

1. Open SADIE Settings
2. Navigate to "Custom LLM API" section
3. Click "Configure" to expand options
4. Fill in the following fields:

### Required Fields

| Field | Description | Example |
|-------|-------------|---------|
| **API Name** | Friendly name for your API | "My OpenAI" |
| **Provider** | API format/authentication style | OpenAI Compatible |
| **API Base URL** | Full base URL of the API | `https://api.openai.com/v1` |
| **Model Name** | Model identifier | `gpt-4` |
| **API Key** | Authentication key | `sk-...` |

### Provider-Specific Examples

#### OpenAI
```
Provider: OpenAI Compatible
API Base URL: https://api.openai.com/v1
Model: gpt-4
API Key: sk-proj-xxxxxxxxxxxxx
```

#### Anthropic Claude
```
Provider: Anthropic (Claude)
API Base URL: https://api.anthropic.com/v1
Model: claude-3-5-sonnet-20241022
API Key: sk-ant-xxxxxxxxxxxxx
```

#### OpenRouter
```
Provider: OpenRouter
API Base URL: https://openrouter.ai/api/v1
Model: anthropic/claude-3.5-sonnet
API Key: sk-or-xxxxxxxxxxxxx
```

#### LocalAI (Self-Hosted)
```
Provider: OpenAI Compatible
API Base URL: http://localhost:8080/v1
Model: llama-3-8b
API Key: (leave empty if no auth)
```

#### LM Studio
```
Provider: OpenAI Compatible
API Base URL: http://localhost:1234/v1
Model: local-model
API Key: (not required)
```

## Usage

1. Enable "Use custom LLM API instead of Ollama" checkbox
2. Save settings
3. Start chatting - SADIE will now use your configured API

## Features & Limitations

### What Works
- ✅ Text-based conversations
- ✅ Conversation history maintained
- ✅ System prompts preserved
- ✅ Streaming responses
- ✅ API key stored locally (never sent to SADIE servers)

### Current Limitations
- ⚠️ **Tool calling not yet supported** - Custom APIs cannot execute SADIE tools (file operations, web search, etc.)
- ⚠️ **Image attachments not supported** - Falls back to Ollama's vision model when images are attached
- ⚠️ **Document parsing falls back to Ollama** - Document summarization requires Ollama

> These limitations will be addressed in future releases as we implement OpenAI function calling and Anthropic tool use formats.

## Fallback Behavior

SADIE automatically falls back to Ollama in the following scenarios:
- Image attachments are present
- Custom LLM configuration is invalid or incomplete
- Custom API connection fails
- User disables custom LLM feature

## Security

- API keys are stored locally in your user settings file
- Keys are never transmitted to SADIE servers or third parties
- Keys are only sent to your configured API endpoint
- Stored at: `%APPDATA%\SADIE\config\user-settings.json` (Windows)

## Pricing Considerations

When using external APIs:
- **OpenAI**: Pay-per-token pricing ([see rates](https://openai.com/pricing))
- **Anthropic**: Pay-per-token pricing ([see rates](https://www.anthropic.com/pricing))
- **OpenRouter**: Varies by model ([see marketplace](https://openrouter.ai/models))
- **Self-hosted**: Free (but requires infrastructure)

> ⚠️ Monitor your API usage and set rate limits in your provider's dashboard to avoid unexpected charges.

## Troubleshooting

### "Invalid custom LLM config" error
- Verify all required fields are filled
- Check that API URL is complete and correct
- Ensure API key is valid and not expired

### No response or timeout
- Check your internet connection
- Verify the API endpoint is accessible
- Check provider status page for outages
- Review API rate limits

### "Falling back to Ollama" message
- Configuration validation failed
- Check Settings panel for error details
- Ensure API key has correct permissions

### Authentication errors
- Verify API key is correct and active
- Check if key has required scopes/permissions
- For OpenRouter, ensure sufficient credits

## Examples

### Using GPT-4 for complex reasoning
```
Provider: OpenAI Compatible
API URL: https://api.openai.com/v1
Model: gpt-4
```

### Using Claude for long context tasks
```
Provider: Anthropic
API URL: https://api.anthropic.com/v1
Model: claude-3-5-sonnet-20241022
```

### Cost-effective with OpenRouter
```
Provider: OpenRouter
API URL: https://openrouter.ai/api/v1
Model: meta-llama/llama-3-8b-instruct (much cheaper)
```

### Completely offline with LM Studio
```
Provider: OpenAI Compatible
API URL: http://localhost:1234/v1
Model: (whatever model loaded in LM Studio)
API Key: (not needed)
```

## Future Enhancements

Planned features for custom LLM support:
- [ ] Tool calling support (OpenAI function calling format)
- [ ] Anthropic tool use support
- [ ] Image attachment support for vision-capable models
- [ ] Multiple API configurations (quick switching)
- [ ] Usage tracking and cost estimation
- [ ] Custom system prompts per provider
- [ ] Provider-specific advanced settings (temperature, top_p, etc.)

## Support

For issues or questions:
1. Check Settings panel for validation errors
2. Review console logs (View → Toggle Developer Tools)
3. Open an issue on GitHub with your configuration (without API key)

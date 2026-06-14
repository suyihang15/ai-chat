// ===== API Client - Multi-Provider =====
// Streaming chat with DeepSeek / OpenAI / Anthropic / Google Gemini
// All clients expose the same interface: { chat(), testConnection() }

// ---- Message format converters ----

function messagesToAnthropic(messages) {
  // Anthropic: system at top level, messages array without system role
  let system = '';
  const converted = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n' : '') + m.content;
    } else {
      converted.push({ role: m.role, content: m.content });
    }
  }
  return { system: system || undefined, messages: converted };
}

function messagesToGemini(messages) {
  // Gemini: systemInstruction + contents[] with parts[]
  let systemInstruction;
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (!systemInstruction) systemInstruction = { parts: [] };
      systemInstruction.parts.push({ text: m.content });
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      });
    }
  }
  return { systemInstruction, contents };
}

// ---- Factory ----

function createAPIClient(config) {
  const { providerType, apiKey, baseURL, model, temperature, maxTokens } = config;

  if (!apiKey) throw new Error('请先配置 API Key');

  switch (providerType) {
    case 'anthropic':
      return createAnthropicClient({ apiKey, baseURL, model, temperature, maxTokens });
    case 'google':
      return createGoogleClient({ apiKey, baseURL, model, temperature, maxTokens });
    default:
      return createOpenAICompatibleClient({ apiKey, baseURL, model, temperature, maxTokens });
  }
}

// ---- OpenAI-Compatible (DeepSeek, OpenAI, Groq, Ollama, etc.) ----

function createOpenAICompatibleClient({ apiKey, baseURL, model, temperature, maxTokens }) {
  const endpoint = `${baseURL.replace(/\/$/, '')}/chat/completions`;

  return {
    type: 'openai',
    config: { apiKey, baseURL, model, temperature, maxTokens },

    async chat(messages, { onChunk, onComplete, signal } = {}) {
      const body = {
        model,
        messages,
        stream: true,
        temperature,
        max_tokens: maxTokens
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`API ${response.status}`);
        err.status = response.status;
        try {
          const parsed = JSON.parse(errText);
          err.message = parsed.error?.message || err.message;
        } catch (e) { /* keep default */ }
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let thinkingContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;

              const content = delta.content || '';
              const reasoning = delta.reasoning_content || '';

              if (reasoning) thinkingContent += reasoning;
              if (content) {
                fullContent += content;
                if (onChunk) onChunk(content, fullContent, thinkingContent);
              }
            } catch (e) { /* skip malformed */ }
          }

          if (signal?.aborted) { reader.cancel(); break; }
        }
      } catch (e) {
        if (e.name === 'AbortError') { /* cancelled */ }
        else throw e;
      }

      if (onComplete) onComplete({ content: fullContent, thinking: thinkingContent });
      return fullContent;
    },

    async testConnection() {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10
        })
      });
      if (!response.ok) {
        const err = new Error(`连接失败 (${response.status})`);
        err.status = response.status;
        throw err;
      }
      return true;
    }
  };
}

// ---- Anthropic Claude ----

function createAnthropicClient({ apiKey, baseURL, model, temperature, maxTokens }) {
  const endpoint = `${baseURL.replace(/\/$/, '')}/messages`;

  return {
    type: 'anthropic',
    config: { apiKey, baseURL, model, temperature, maxTokens },

    async chat(messages, { onChunk, onComplete, signal } = {}) {
      const { system, messages: antMessages } = messagesToAnthropic(messages);

      const body = {
        model,
        messages: antMessages,
        max_tokens: maxTokens,
        temperature,
        stream: true
      };
      if (system) body.system = system;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`API ${response.status}`);
        err.status = response.status;
        try {
          const parsed = JSON.parse(errText);
          err.message = parsed.error?.message || err.message;
        } catch (e) { /* keep default */ }
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let thinkingContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            // Anthropic SSE: "event: ...\ndata: {...}"
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);

            try {
              const parsed = JSON.parse(data);

              switch (parsed.type) {
                case 'content_block_delta': {
                  const delta = parsed.delta;
                  if (delta.type === 'text_delta') {
                    fullContent += delta.text;
                    if (onChunk) onChunk(delta.text, fullContent, thinkingContent);
                  } else if (delta.type === 'thinking_delta') {
                    thinkingContent += delta.thinking;
                  }
                  break;
                }
                case 'message_stop':
                  break; // stream ends
                default:
                  // message_start, content_block_start, content_block_stop, message_delta
                  break;
              }
            } catch (e) { /* skip malformed */ }
          }

          if (signal?.aborted) { reader.cancel(); break; }
        }
      } catch (e) {
        if (e.name === 'AbortError') { /* cancelled */ }
        else throw e;
      }

      if (onComplete) onComplete({ content: fullContent, thinking: thinkingContent });
      return fullContent;
    },

    async testConnection() {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10
        })
      });
      if (!response.ok) {
        const err = new Error(`连接失败 (${response.status})`);
        err.status = response.status;
        throw err;
      }
      return true;
    }
  };
}

// ---- Google Gemini ----

function createGoogleClient({ apiKey, baseURL, model, temperature, maxTokens }) {
  const endpoint = `${baseURL.replace(/\/$/, '')}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  return {
    type: 'google',
    config: { apiKey, baseURL, model, temperature, maxTokens },

    async chat(messages, { onChunk, onComplete, signal } = {}) {
      const { systemInstruction, contents } = messagesToGemini(messages);

      const body = {
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens
        }
      };
      if (systemInstruction) body.systemInstruction = systemInstruction;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(`API ${response.status}`);
        err.status = response.status;
        try {
          const parsed = JSON.parse(errText);
          err.message = parsed.error?.message || err.message;
        } catch (e) { /* keep default */ }
        throw err;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);

            try {
              const parsed = JSON.parse(data);
              const parts = parsed.candidates?.[0]?.content?.parts;
              if (!parts) continue;
              for (const part of parts) {
                if (part.text) {
                  fullContent += part.text;
                  if (onChunk) onChunk(part.text, fullContent, '');
                }
              }
            } catch (e) { /* skip malformed */ }
          }

          if (signal?.aborted) { reader.cancel(); break; }
        }
      } catch (e) {
        if (e.name === 'AbortError') { /* cancelled */ }
        else throw e;
      }

      if (onComplete) onComplete({ content: fullContent, thinking: '' });
      return fullContent;
    },

    async testConnection() {
      const testEndpoint = `${baseURL.replace(/\/$/, '')}/models/${model}:generateContent?key=${apiKey}`;
      // For test, we just try to generate a trivial response (non-streaming)
      const response = await fetch(testEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      });
      if (!response.ok) {
        const err = new Error(`连接失败 (${response.status})`);
        err.status = response.status;
        throw err;
      }
      return true;
    }
  };
}

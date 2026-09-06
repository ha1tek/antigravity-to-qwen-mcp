import { ServerConfig, ChatMessage } from '../types';

export class QwenAPIAdapter {
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  public isAvailable(): boolean {
    return !!this.config.apiKey || !!this.config.apiBaseUrl;
  }

  public async completeChat(
    messages: ChatMessage[],
    onChunk?: (chunk: string, fullText: string) => void
  ): Promise<string> {
    const url = `${this.config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const payload = {
      model: this.config.model || 'qwen-max',
      messages,
      stream: !!onChunk,
      temperature: 0.7
    };

    if (!onChunk) {
      // Non-streaming request
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error HTTP ${response.status}: ${errText}`);
      }

      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content || '';
      return content;
    }

    // Streaming request
    headers['Accept'] = 'text/event-stream';
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error HTTP ${response.status}: ${errText}`);
    }

    if (!response.body) {
      throw new Error('No response body for stream');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (trimmed === 'data: [DONE]') continue;

        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const delta = json.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              onChunk(delta, fullText);
            }
          } catch {
            // Ignore parse errors on individual stream chunks
          }
        }
      }
    }

    return fullText;
  }
}

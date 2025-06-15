import OpenAI from 'openai';
import { config } from '../config/environment';

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
    });
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: config.OPENAI_MODEL,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      throw error;
    }
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: config.OPENAI_MODEL,
        input: texts,
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      throw error;
    }
  }

  async extractKeywords(text: string): Promise<string[]> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Extract 3-5 key words or phrases from the text. Return only comma-separated keywords.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 50,
      });

      const keywords = response.choices[0].message.content?.split(',').map(k => k.trim()) || [];
      return keywords;
    } catch (error) {
      return [];
    }
  }

  async generateSummary(text: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Create a concise 1-2 sentence summary capturing the essence of the text. Be specific and informative.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 60,
      });

      return response.choices[0].message.content?.trim() || text.substring(0, 150) + '...';
    } catch (error) {
      // Fallback to truncation
      return text.length > 150 ? text.substring(0, 147) + '...' : text;
    }
  }


  async summarizeTexts(texts: string[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that creates concise summaries of multiple related texts.',
          },
          {
            role: 'user',
            content: `Please create a coherent summary of these ${texts.length} related memories:\n\n${texts.map((t, i) => `Memory ${i + 1}: ${t}`).join('\n\n')}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      });

      return response.choices[0].message.content || 'Summary generation failed';
    } catch (error) {
      return `Combined memories: ${texts.map(t => t.substring(0, 50)).join('; ')}...`;
    }
  }
}
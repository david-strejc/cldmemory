import OpenAI from 'openai';
import { config } from '../config/environment';

export class OpenAIService {
  private client: OpenAI;
  private embeddingModel: string;
  private chatModel: string;

  constructor() {
    // Zde budeme přidávat kontrolu, zda je OpenAI skutečně aktivní LLM.
    // Prozatím zajistíme, že model je vždy řetězec, i když je volitelný.
    // Konfigurace `environment.ts` již zajišťuje, že alespoň jeden LLM je nastaven.
    if (!config.OPENAI_API_KEY) {
        // Měli bychom to ošetřit elegantněji, ale prozatím
        // předpokládáme, že tento konstruktor bude volán pouze,
        // pokud je OpenAI API klíč k dispozici (což zajistíme v MemoryService).
        // Následující řádek je jen pro TypeScript, aby věděl, že OPENAI_API_KEY není undefined
        throw new Error("OpenAI API Key is missing. OpenAIService cannot be initialized.");
    }
    if (!config.OPENAI_MODEL) {
        // Podobně pro model.
         throw new Error("OpenAI Model is missing. OpenAIService cannot be initialized.");
    }

    this.client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
    });

    // Nastavení modelů z konfigurace
    this.embeddingModel = config.OPENAI_MODEL;
    // Můžeš použít stejný model pro chat, nebo si přidat OPENAI_CHAT_MODEL do .env a configu
    // Zde ponecháme pevně 'gpt-4o' pro chat, jak jsi to měl původně, pokud nechceš měnit chování.
    // Jinak bys použil config.OPENAI_MODEL nebo novou proměnnou config.OPENAI_CHAT_MODEL.
    this.chatModel = 'gpt-4o'; // Ponecháno jako ve tvém původním kódu
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel, // Používáme this.embeddingModel, což je string
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Error creating OpenAI embedding:', error);
      throw error; // Důležité je chybu dál propagovat, aby se zamezilo tichému selhání
    }
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.embeddingModel, // Používáme this.embeddingModel
        input: texts,
      });
      return response.data.map((item) => item.embedding);
    } catch (error) {
      console.error('Error creating OpenAI embeddings (batch):', error);
      throw error;
    }
  }

  async extractKeywords(text: string): Promise<string[]> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.chatModel, // Používáme this.chatModel
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

      const keywords = response.choices[0].message.content?.split(',').map(k => k.trim()).filter(Boolean) || [];
      return keywords;
    } catch (error) {
      console.error('Error extracting keywords with OpenAI:', error);
      return []; // Vracíme prázdné pole, aby se neblokoval proces
    }
  }

  async generateSummary(text: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.chatModel, // Používáme this.chatModel
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

      return response.choices[0].message.content?.trim() || (text.length > 150 ? text.substring(0, 147) + '...' : text);
    } catch (error) {
      console.error('Error generating summary with OpenAI:', error);
      // Fallback na zkrácený text
      return text.length > 150 ? text.substring(0, 147) + '...' : text;
    }
  }

  async summarizeTexts(texts: string[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.chatModel, // Používáme this.chatModel
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
      console.error('Error summarizing texts with OpenAI:', error);
      return `Combined memories: ${texts.map(t => t.substring(0, 50)).join('; ')}...`;
    }
  }
}

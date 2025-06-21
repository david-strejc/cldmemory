import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { config } from '../config/environment';

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private embeddingModel: string;
  private chatModel: string;

  constructor() {
    if (!config.GEMINI_API_KEY || !config.GEMINI_MODEL) {
      throw new Error("Gemini API key or model is not configured. Please check your .env file.");
    }
    this.genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    this.embeddingModel = 'embedding-001'; // Google Gemini pro embeddingy doporučuje 'embedding-001'
    this.chatModel = config.GEMINI_MODEL;
  }

  async createEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.embeddingModel });
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error('Error creating Gemini embedding:', error);
      throw error;
    }
  }

  async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.embeddingModel });
      const results = await model.batchEmbedContents({
        requests: texts.map(text => ({ content: { role: 'user', parts: [{ text }] } })),
      });
      return results.embeddings.map(e => e.values);
    } catch (error) {
      console.error('Error creating Gemini embeddings (batch):', error);
      throw error;
    }
  }

  async extractKeywords(text: string): Promise<string[]> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.chatModel });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `Extract 3-5 key words or phrases from the text. Return only comma-separated keywords.\n\nText: ${text}` }] }],
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
      });
      const response = result.response;
      const keywords = response.text()?.split(',').map(k => k.trim()).filter(Boolean) || [];
      return keywords;
    } catch (error) {
      console.error('Error extracting keywords with Gemini:', error);
      return [];
    }
  }

  async generateSummary(content: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.chatModel });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `Create a concise 1-2 sentence summary capturing the essence of the text. Be specific and informative.\n\nText: ${content}` }] }],
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
      });
      const response = result.response;
      return response.text()?.trim() || (content.length > 150 ? content.substring(0, 147) + '...' : content);
    } catch (error) {
      console.error('Error generating summary with Gemini:', error);
      return content.length > 150 ? content.substring(0, 147) + '...' : content;
    }
  }

  async summarizeTexts(texts: string[]): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: this.chatModel });
      const combinedText = texts.map((t, i) => `Memory ${i + 1}: ${t}`).join('\n\n');
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `You are a helpful assistant that creates concise summaries of multiple related texts.\n\nPlease create a coherent summary of these <span class="math-inline">\{texts\.length\} related memories\:\\n\\n</span>{combinedText}` }] }],
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
      });
      const response = result.response;
      return response.text() || 'Summary generation failed';
    } catch (error) {
      console.error('Error summarizing texts with Gemini:', error);
      return `Combined memories: ${texts.map(t => t.substring(0, 50)).join('; ')}...`;
    }
  }
}

import dotenv from 'dotenv';
import { z } from 'zod';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION_NAME: z.string(),

  // The project requires ONLY ONE to be configured for LLM operations to work.
  // OpenAI Support
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),

  // Anthropic Support
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),

  // Google Gemini Support
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),

  MCP_SERVER_NAME: z.string(),
  MCP_SERVER_PORT: z.string().transform(Number),
  SIMILARITY_THRESHOLD: z.string().transform(Number).default('0.7'),
  MEMORY_METADATA: z.string().optional(),
}).refine(data => {
  // At least one API key must be defined for LLM operations
  return data.OPENAI_API_KEY || data.ANTHROPIC_API_KEY || data.GEMINI_API_KEY;
}, {
  message: "At least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY must be provided.",
  path: ["LLM_API_KEY_MISSING"], // Custom path for error clarity
});

export const config = envSchema.parse(process.env);
export const DEFAULT_SIMILARITY_THRESHOLD = config.SIMILARITY_THRESHOLD || 0.3;

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION_NAME: z.string(),

  // Ponecháme jako stringy a probereme, jak se budou volit
  // Budou volitelné, pokud existuje ANTHROPIC_API_KEY nebo GEMINI_API_KEY
  OPENAI_API_KEY: z.string().optional(), // Nyní nepovinné
  OPENAI_MODEL: z.string().optional(), // Nyní nepovinné

  // Přidáváme podporu pro Anthropic, pokud ji budeš chtít použít
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),

  // --- NOVÉ: Přidáváme proměnné pro Google Gemini ---
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  // --------------------------------------------------

  MCP_SERVER_NAME: z.string(),
  MCP_SERVER_PORT: z.string().transform(Number),
  SIMILARITY_THRESHOLD: z.string().transform(Number).default('0.7'),
  MEMORY_METADATA: z.string().optional(),
}).refine(data => {
  // Alespoň jeden API klíč musí být definován pro LLM operace
  return data.OPENAI_API_KEY || data.ANTHROPIC_API_KEY || data.GEMINI_API_KEY;
}, {
  message: "At least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY must be provided.",
  path: ["LLM_API_KEY_MISSING"], // Custom path for error clarity
});


export const config = envSchema.parse(process.env);

// Dimenze vektoru se bude muset dynamicky měnit podle použitého modelu LLM
// Prozatím nastavíme na 1536 (OpenAI text-embedding-3-small)
// Budeme to muset upravit, až budeme mít flexibilnější výběr LLM
//export const VECTOR_DIMENSION = 1536; // Tato proměnná se nyní nastavuje dynamicky v MemoryService
export const DEFAULT_SIMILARITY_THRESHOLD = config.SIMILARITY_THRESHOLD || 0.3;

import { MemoryService } from '../services/memory';
import { QdrantService } from '../services/qdrant';
import { config } from '../config/environment'; // NOVINKA: Potřebujeme config pro určení dimenze
import { OpenAIService } from '../services/openai'; // Potřebujeme pro zjištění dimenze
import { GeminiService } from '../services/gemini'; // Potřebujeme pro zjištění dimenze

async function migrateSummaries() {
  console.log('Starting summary migration...');

  // NOVINKA: Určíme dimenzi vektoru na základě konfigurace v .env
  let vectorDimension: number;
  if (config.GEMINI_API_KEY && config.GEMINI_MODEL) {
    vectorDimension = 768; // Dimenze pro Gemini embedding-001
  } else if (config.OPENAI_API_KEY && config.OPENAI_MODEL) {
    vectorDimension = 1536; // Dimenze pro OpenAI text-embedding-3-small
  } else {
    // Toto by se nemělo stát, protože environment.ts již kontroluje existenci alespoň jednoho klíče
    console.error("Error: No valid LLM API key and model configured for migration script. Please set OPENAI_API_KEY/OPENAI_MODEL or GEMINI_API_KEY/GEMINI_MODEL in your .env file.");
    process.exit(1);
  }

  // NOVINKA: QdrantService teď dostává vectorDimension
  const qdrantService = new QdrantService(vectorDimension);

  // MemoryService si inicializuje LLMService uvnitř sebe, nemusíme jí předávat nic
  const memoryService = new MemoryService();

  await memoryService.initialize(); // Inicializace MemoryService také inicializuje QdrantService a vybere LLM
  
  try {
    // Get all memories using search with empty query
    const allMemories = await qdrantService.searchByFilters({
      must: []
    }, 1000); // Get up to 1000 memories
    
    console.log(`Found ${allMemories.length} memories to migrate`);
    
    let migrated = 0;
    for (const memory of allMemories) {
      if (!memory.summary || memory.summary === '') {
        // Generate summary for existing memory
        const summary = memory.content.length > 150 
          ? memory.content.substring(0, 147) + '...'
          : memory.content;
        
        // Update memory with summary
        await qdrantService.updateMemoryMetadata(memory.id, {
          summary: summary
        });
        
        migrated++;
        if (migrated % 10 === 0) {
          console.log(`Migrated ${migrated} memories...`);
        }
      }
    }
    
    console.log(`Migration complete! Added summaries to ${migrated} memories.`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

migrateSummaries();

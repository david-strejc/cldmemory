import { v4 as uuidv4 } from 'uuid';
import { Memory, MemoryType, MemorySearchParams, MemoryContext, CompactMemory, SystemMetadata, MemorySearchResult } from '../types/memory';
import { QdrantService } from './qdrant';

import { OpenAIService } from './openai';
import { GeminiService } from './gemini'; // NOVINKA: Import GeminiService

// Definujeme interface pro LLM službu
interface LLMService {
  createEmbedding(text: string): Promise<number[]>;
  createEmbeddings(texts: string[]): Promise<number[][]>; // Přidáno pro kompatibilitu
  extractKeywords(text: string): Promise<string[]>;
  generateSummary(content: string): Promise<string>;
  summarizeTexts(texts: string[]): Promise<string>;
}

import { ChunkingService, ChunkingOptions, TextChunk } from './chunking';
import { config } from '../config/environment';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

export class MemoryService {
  private qdrant: QdrantService;
  private llmService: LLMService; // Změna z 'openai' na obecný 'llmService'
  private chunking: ChunkingService;
  private vectorDimension: number; // NOVINKA: Proměnná pro dimenzi vektoru embeddingu

  constructor() {
    // Dynamický výběr LLM služby na základě konfigurace v .env
    if (config.GEMINI_API_KEY && config.GEMINI_MODEL) {
      this.llmService = new GeminiService();
      this.vectorDimension = 768; // Dimenze pro Gemini embedding-001
      console.log("Using Google Gemini for LLM operations.");
    } else if (config.OPENAI_API_KEY && config.OPENAI_MODEL) {
      this.llmService = new OpenAIService();
      this.vectorDimension = 1536; // Dimenze pro OpenAI text-embedding-3-small
      console.log("Using OpenAI for LLM operations.");
    } else {
      throw new Error("No valid LLM API key and model configured. Please set OPENAI_API_KEY/OPENAI_MODEL or GEMINI_API_KEY/GEMINI_MODEL in your .env file.");
    }
  
    // NOVINKA: Nyní inicializujeme ChunkingService s vybranou llmService
    this.chunking = new ChunkingService(this.llmService);
  
    // Nyní inicializujeme QdrantService s určenou dimenzí
    this.qdrant = new QdrantService(this.vectorDimension);
    }

  private getProjectInfo(): string {
    const hostname = os.hostname();
    const folder = process.cwd();
    return `${hostname}:${folder}`;
  }

  private parseMemoryMetadata(): Record<string, string> {
    const metadata: Record<string, string> = {};
    const metadataStr = config.MEMORY_METADATA;
    
    if (!metadataStr) return metadata;
    
    // Parse comma-separated key:value pairs
    const pairs = metadataStr.split(',');
    for (const pair of pairs) {
      const colonIndex = pair.indexOf(':');
      if (colonIndex > -1) {
        // Handle key:value format
        const key = pair.substring(0, colonIndex).trim();
        const value = pair.substring(colonIndex + 1).trim();
        if (key && value) {
          metadata[key] = value;
        }
      } else {
        // Handle single value without colon - use it as a 'user' key
        const value = pair.trim();
        if (value) {
          metadata['user'] = value;
        }
      }
    }
    
    return metadata;
  }

  private getSystemMetadata(): SystemMetadata {
    const hostname = os.hostname();
    const platform = os.platform();
    let username = 'unknown';

    try {
      // Get username based on platform
      if (platform === 'win32') {
        // Windows: use USERNAME or USERPROFILE environment variable
        username = process.env.USERNAME || process.env.USERPROFILE?.split('\\').pop() || 'unknown';
      } else {
        // Unix-like systems (Linux, macOS): use whoami command
        username = execSync('whoami', { encoding: 'utf8' }).trim();
      }
    } catch (error) {
      // Fallback to environment variable if command fails
      username = process.env.USER || process.env.USERNAME || 'unknown';
    }

    return {
      hostname,
      username,
      platform,
      timestamp: new Date()
    };
  }

  async initialize(): Promise<void> {
    await this.qdrant.initialize();
  }

  async createMemoryWithChunking(
    content: string,
    type: MemoryType,
    context?: Partial<MemoryContext>,
    importance?: number,
    chunkingOptions?: ChunkingOptions,
    summary?: string,
    emotionalValence?: number
  ): Promise<Memory[]> {
    // Use semantic chunking by default for long content
    const options: ChunkingOptions = chunkingOptions || {
      method: 'semantic',
      maxChunkSize: 1000, // tokens
      overlapSize: 100,   // tokens
      semanticThreshold: 0.75
    };
    
    // Check if content is long enough to warrant chunking
    const estimatedTokens = Math.ceil(content.length / 4);
    if (estimatedTokens <= (options.maxChunkSize || 1000)) {
      // Content is small enough, create single memory
      const memory = await this.createMemory(content, type, context, importance, summary, emotionalValence);
      return [memory];
    }
    
    // Chunk the content
    const chunks = await this.chunking.chunkText(content, options);
    const memories: Memory[] = [];
    
    // Create a parent memory for the full content
    const parentSummary = summary || `Chunked memory containing ${chunks.length} parts about: ${content.substring(0, 100)}...`;
    const parentMemory = await this.createMemory(
      `[Chunked Memory - ${chunks.length} parts] ${content.substring(0, 200)}...`,
      type,
      { ...context, isParentChunk: true, totalChunks: chunks.length },
      importance || 0.8, // Parent chunks are generally important
      parentSummary,
      emotionalValence
    );
    memories.push(parentMemory);
    
    // Create memories for each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkContext: MemoryContext = {
        ...context,
        chunkIndex: i,
        chunkOf: parentMemory.id,
        totalChunks: chunks.length,
        semanticDensity: chunk.metadata?.semanticDensity
      };
      
      // Adjust importance based on semantic density
      const chunkImportance = importance || this.calculateImportance(chunk.content, type);
      const adjustedImportance = Math.min(1, chunkImportance * (chunk.metadata?.semanticDensity || 1));
      
      const chunkMemory = await this.createMemory(
        chunk.content,
        type,
        chunkContext,
        adjustedImportance,
        undefined, // Let each chunk use default summary
        emotionalValence // Pass the same emotional valence to all chunks
      );
      
      // Link chunk to parent
      await this.connectMemories(parentMemory.id, chunkMemory.id, true);
      
      memories.push(chunkMemory);
    }
    
    // Link adjacent chunks
    for (let i = 1; i < memories.length - 1; i++) {
      await this.connectMemories(memories[i].id, memories[i + 1].id, true);
    }
    
    return memories;
  }

  async createMemory(
    content: string,
    type: MemoryType,
    context?: Partial<MemoryContext>,
    importance?: number,
    summary?: string,
    emotionalValence?: number
  ): Promise<Memory> {
    // Validate content
    if (!content || content.trim().length === 0) {
      throw new Error('Memory content cannot be empty');
    }
    
    // Validate importance
    if (importance !== undefined && (importance < 0 || importance > 1)) {
      throw new Error('Importance must be between 0 and 1');
    }
    
    // Validate emotional valence
    if (emotionalValence !== undefined && (emotionalValence < -1 || emotionalValence > 1)) {
      throw new Error('Emotional valence must be between -1 and 1');
    }
    
    // Generate summary if not provided
    const memorySummary = summary || await this.generateSummary(content);
    
    // Merge environment metadata with any existing metadata
    const envMetadata = this.parseMemoryMetadata();
    
    const memory: Memory = {
      id: uuidv4(),
      summary: memorySummary,
      content,
      type,
      timestamp: new Date(),
      importance: importance ?? this.calculateImportance(content, type),
      emotionalValence: emotionalValence ?? 0, // Default to neutral if not provided
      associations: [],
      context: {
        tags: await this.llmService.extractKeywords(content),
        ...context,
      },
      metadata: {
        ...envMetadata,
      },
      lastAccessed: new Date(),
      accessCount: 0,
      decay: 0,
      project: this.getProjectInfo(),
      system_metadata: this.getSystemMetadata(),
    };

    const embedding = await this.llmService.createEmbedding(this.prepareMemoryForEmbedding(memory));
    await this.qdrant.upsertMemory(memory, embedding);

    // Find and link associations
    await this.updateAssociations(memory);

    return memory;
  }

  async searchChunkedMemories(params: MemorySearchParams & { reconstructChunks?: boolean }): Promise<Memory[] | CompactMemory[]> {
    const memories = await this.searchMemories(params);
    
    if (!params.reconstructChunks || params.detailLevel === 'compact') {
      return memories;
    }
    
    // Find parent chunks and reconstruct full memories
    const reconstructed: Memory[] = [];
    const processedParents = new Set<string>();
    
    for (const memory of memories as Memory[]) {
      if (memory.context.isParentChunk && !processedParents.has(memory.id)) {
        // Get all chunks of this parent
        const chunks = await this.qdrant.searchByMetadata({
          chunkOf: memory.id
        });
        
        if (chunks.length > 0) {
          // Sort chunks by index
          chunks.sort((a, b) => (a.context.chunkIndex || 0) - (b.context.chunkIndex || 0));
          
          // Reconstruct full content
          const fullContent = chunks.map(c => c.content).join('\n\n');
          
          // Create reconstructed memory
          const reconstructedMemory: Memory = {
            ...memory,
            content: fullContent,
            metadata: {
              ...memory.metadata,
              reconstructed: true,
              chunkCount: chunks.length
            }
          };
          
          reconstructed.push(reconstructedMemory);
          processedParents.add(memory.id);
        } else {
          reconstructed.push(memory);
        }
      } else if (!memory.context.chunkOf) {
        // Regular non-chunked memory
        reconstructed.push(memory);
      }
      // Skip individual chunks if we're reconstructing
    }
    
    return reconstructed;
  }

  async searchMemories(params: MemorySearchParams): Promise<Memory[] | CompactMemory[]> {
    const filter: any = {
      must: [],
    };

    if (params.type) {
      filter.must.push({ key: 'type', match: { value: params.type } });
    }

    if (params.minImportance !== undefined) {
      filter.must.push({ key: 'importance', range: { gte: params.minImportance } });
    }

    if (params.emotionalRange) {
      filter.must.push({
        key: 'emotionalValence',
        range: { gte: params.emotionalRange.min, lte: params.emotionalRange.max },
      });
    }

    if (params.dateRange) {
      filter.must.push({
        key: 'timestamp',
        range: {
          gte: params.dateRange.start.toISOString(),
          lte: params.dateRange.end.toISOString(),
        },
      });
    }

    let memories: Memory[];
    
    // If query is empty and we have filters, use filter-only search
    if (!params.query || params.query.trim() === '') {
      if (filter.must.length > 0) {
        memories = await this.qdrant.searchByFilters(filter, params.limit || 10);
      } else {
        // No query and no filters - return empty results
        memories = [];
      }
    } else {
      // Query provided - use similarity search
      // Include metadata and project info in query embedding for better matching
      const envMetadata = this.parseMemoryMetadata();
      const metadataStr = Object.entries(envMetadata)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      const projectInfo = this.getProjectInfo();
      
      let enhancedQuery = params.query;
      if (metadataStr) {
        enhancedQuery += `\nMetadata: ${metadataStr}`;
      }
      enhancedQuery += `\nProject: ${projectInfo}`;
      
      const queryEmbedding = await this.llmService.createEmbedding(enhancedQuery);
      memories = await this.qdrant.searchSimilar(
        queryEmbedding,
        params.limit || 10,
        filter.must.length > 0 ? filter : undefined,
        params.similarityThreshold
      );
    }

    // Update access patterns
    for (const memory of memories) {
      await this.qdrant.updateMemoryMetadata(memory.id, {
        lastAccessed: new Date(),
        accessCount: memory.accessCount + 1,
      });
    }

    // Include associations if requested
    if (params.includeAssociations) {
      const allMemories = [...memories];
      const processedIds = new Set(memories.map(m => m.id));

      for (const memory of memories) {
        for (const assocId of memory.associations) {
          if (!processedIds.has(assocId)) {
            const associated = await this.qdrant.getMemory(assocId);
            if (associated) {
              allMemories.push(associated);
              processedIds.add(assocId);
            }
          }
        }
      }

      return allMemories;
    }

    // Convert to compact format if requested
    if (params.detailLevel === 'compact') {
      return this.toCompactMemories(memories);
    }

    return memories;
  }

  private toCompactMemories(memories: Memory[]): CompactMemory[] {
    return memories.map(memory => ({
      id: memory.id,
      summary: memory.summary, // Use summary instead of truncated content
      type: memory.type,
      timestamp: memory.timestamp,
      importance: memory.importance,
      emotionalValence: memory.emotionalValence,
      tags: memory.context.tags,
      project: memory.project
    }));
  }

  async searchMemoriesWithScores(params: MemorySearchParams): Promise<CompactMemory[]> {
    const filter: any = {
      must: [],
    };

    if (params.type) {
      filter.must.push({ key: 'type', match: { value: params.type } });
    }

    if (params.minImportance !== undefined) {
      filter.must.push({ key: 'importance', range: { gte: params.minImportance } });
    }

    let searchResults: MemorySearchResult[] = [];
    
    if (!params.query || params.query.trim() === '') {
      // No scores available for filter-only search
      return [];
    } else {
      // Query provided - use similarity search with scores
      const envMetadata = this.parseMemoryMetadata();
      const metadataStr = Object.entries(envMetadata)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      const projectInfo = this.getProjectInfo();
      
      let enhancedQuery = params.query;
      if (metadataStr) {
        enhancedQuery += `\nMetadata: ${metadataStr}`;
      }
      enhancedQuery += `\nProject: ${projectInfo}`;
      
      const queryEmbedding = await this.llmService.createEmbedding(enhancedQuery);
      searchResults = await this.qdrant.searchSimilarWithScores(
        queryEmbedding,
        params.limit || 10,
        filter.must.length > 0 ? filter : undefined,
        params.similarityThreshold
      );
    }

    // Update access patterns
    for (const result of searchResults) {
      await this.qdrant.updateMemoryMetadata(result.memory.id, {
        lastAccessed: new Date(),
        accessCount: result.memory.accessCount + 1,
      });
    }

    // Convert to compact format with scores
    return searchResults.map(result => ({
      id: result.memory.id,
      summary: result.memory.summary,
      type: result.memory.type,
      timestamp: result.memory.timestamp,
      importance: result.memory.importance,
      emotionalValence: result.memory.emotionalValence,
      tags: result.memory.context.tags,
      project: result.memory.project,
      relevanceScore: result.score
    }));
  }

  async getMemory(id: string): Promise<Memory | null> {
    const memory = await this.qdrant.getMemory(id);
    if (memory) {
      await this.qdrant.updateMemoryMetadata(id, {
        lastAccessed: new Date(),
        accessCount: memory.accessCount + 1,
      });
    }
    return memory;
  }

  async updateMemory(id: string, updates: Partial<Memory>): Promise<Memory | null> {
    // Validate ID format first
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return null; // Invalid ID format
    }
    
    const memory = await this.qdrant.getMemory(id);
    if (!memory) return null;

    // Validate updates
    if (updates.content !== undefined && updates.content.trim().length === 0) {
      throw new Error('Memory content cannot be empty');
    }
    
    if (updates.importance !== undefined && (updates.importance < 0 || updates.importance > 1)) {
      throw new Error('Importance must be between 0 and 1');
    }

    // Prevent setting context or metadata to null/undefined
    if (updates.context === null || updates.context === undefined) {
      delete updates.context;
    }
    if (updates.metadata === null || updates.metadata === undefined) {
      delete updates.metadata;
    }

    const updatedMemory = { ...memory, ...updates };
    
    if (updates.content) {
      const embedding = await this.llmService.createEmbedding(
        this.prepareMemoryForEmbedding(updatedMemory)
      );
      await this.qdrant.upsertMemory(updatedMemory, embedding);
    } else {
      await this.qdrant.updateMemoryMetadata(id, updates);
    }

    return updatedMemory;
  }

  async deleteMemory(id: string): Promise<void> {
    await this.qdrant.deleteMemory(id);
  }

  async deleteMemories(ids: string[]): Promise<{ deleted: number; failed: string[] }> {
    const failed: string[] = [];
    let deleted = 0;

    // Remove associations to memories being deleted
    for (const id of ids) {
      const memory = await this.getMemory(id);
      if (memory) {
        // Remove this memory from all associations
        for (const assocId of memory.associations) {
          await this.removeAssociation(assocId, id, false);
        }
      }
    }

    // Delete the memories
    try {
      await this.qdrant.deleteMemories(ids);
      deleted = ids.length;
    } catch (error) {
      // If bulk delete fails, try individual deletes
      for (const id of ids) {
        try {
          await this.qdrant.deleteMemory(id);
          deleted++;
        } catch (err) {
          failed.push(id);
        }
      }
    }

    return { deleted, failed };
  }

  async deleteAllMemories(): Promise<{ deleted: boolean }> {
    try {
      await this.qdrant.deleteAllMemories();
      return { deleted: true };
    } catch (error) {
      throw new Error(`Failed to delete all memories: ${error}`);
    }
  }

  async consolidateMemories(
    memoryIds: string[],
    strategy: 'merge_content' | 'summarize' | 'keep_most_important' | 'create_composite',
    keepOriginals: boolean = false
  ): Promise<Memory> {
    const memories = await Promise.all(memoryIds.map(id => this.getMemory(id)));
    const validMemories = memories.filter((m): m is Memory => m !== null);
    
    if (validMemories.length < 2) {
      throw new Error('Need at least 2 valid memories to consolidate');
    }

    let consolidatedContent: string;
    let consolidatedImportance: number;
    let consolidatedContext: MemoryContext = {};

    switch (strategy) {
      case 'merge_content':
        consolidatedContent = validMemories.map(m => m.content).join('\n\n---\n\n');
        consolidatedImportance = Math.max(...validMemories.map(m => m.importance));
        break;
      case 'summarize':
        consolidatedContent = await this.llmService.summarizeTexts(validMemories.map(m => m.content));
        consolidatedImportance = validMemories.reduce((sum, m) => sum + m.importance, 0) / validMemories.length;
        break;
      case 'keep_most_important':
        const mostImportant = validMemories.reduce((max, m) => m.importance > max.importance ? m : max);
        consolidatedContent = mostImportant.content;
        consolidatedImportance = mostImportant.importance;
        consolidatedContext = mostImportant.context;
        break;
      case 'create_composite':
        consolidatedContent = `Composite memory from ${validMemories.length} sources:\n\n` +
          validMemories.map(m => `- ${m.content.substring(0, 100)}...`).join('\n');
        consolidatedImportance = Math.max(...validMemories.map(m => m.importance));
        break;
    }

    // Merge all tags and contexts
    const allTags = new Set<string>();
    validMemories.forEach(m => {
      m.context.tags?.forEach(tag => allTags.add(tag));
    });
    consolidatedContext.tags = Array.from(allTags);

    // Create the consolidated memory
    const consolidated = await this.createMemory(
      consolidatedContent,
      MemoryType.SEMANTIC,
      consolidatedContext,
      consolidatedImportance
    );

    // Link to all original memories
    for (const originalId of memoryIds) {
      await this.connectMemories(consolidated.id, originalId, false);
    }

    // Delete originals if requested
    if (!keepOriginals) {
      for (const id of memoryIds) {
        await this.deleteMemory(id);
      }
    }

    return consolidated;
  }

  async connectMemories(
    sourceId: string,
    targetId: string,
    bidirectional: boolean = true
  ): Promise<void> {
    const source = await this.getMemory(sourceId);
    const target = await this.getMemory(targetId);

    if (!source || !target) {
      throw new Error('One or both memories not found');
    }

    // Add association to source
    if (!source.associations.includes(targetId)) {
      await this.qdrant.updateMemoryMetadata(sourceId, {
        associations: [...source.associations, targetId].slice(0, 10), // Keep max 10 associations
      });
    }

    // Add reverse association if bidirectional
    if (bidirectional && !target.associations.includes(sourceId)) {
      await this.qdrant.updateMemoryMetadata(targetId, {
        associations: [...target.associations, sourceId].slice(0, 10),
      });
    }
  }

  async removeAssociation(
    sourceId: string,
    targetId: string,
    bidirectional: boolean = true
  ): Promise<void> {
    const source = await this.getMemory(sourceId);
    if (source && source.associations.includes(targetId)) {
      await this.qdrant.updateMemoryMetadata(sourceId, {
        associations: source.associations.filter(id => id !== targetId),
      });
    }

    if (bidirectional) {
      const target = await this.getMemory(targetId);
      if (target && target.associations.includes(sourceId)) {
        await this.qdrant.updateMemoryMetadata(targetId, {
          associations: target.associations.filter(id => id !== sourceId),
        });
      }
    }
  }

  async findMemoryPaths(
    startId: string,
    endId: string,
    maxDepth: number = 5,
    includeContent: boolean = false
  ): Promise<any> {
    const visited = new Set<string>();
    const paths: string[][] = [];

    const dfs = async (currentId: string, targetId: string, path: string[], depth: number) => {
      if (depth > maxDepth) return;
      if (currentId === targetId) {
        paths.push([...path, currentId]);
        return;
      }

      visited.add(currentId);
      const memory = await this.getMemory(currentId);
      
      if (memory) {
        for (const assocId of memory.associations) {
          if (!visited.has(assocId)) {
            await dfs(assocId, targetId, [...path, currentId], depth + 1);
          }
        }
      }
      visited.delete(currentId);
    };

    await dfs(startId, endId, [], 0);

    if (includeContent) {
      const pathsWithContent = await Promise.all(
        paths.map(async path => {
          const memories = await Promise.all(
            path.map(id => this.getMemory(id))
          );
          return memories.filter((m): m is Memory => m !== null);
        })
      );
      return pathsWithContent;
    }

    return paths;
  }

  async getAssociationGraph(
    centerMemoryId?: string,
    depth: number = 2,
    minImportance?: number,
    includeContent: boolean = false
  ): Promise<any> {
    const nodes = new Map<string, any>();
    const edges = new Set<string>();

    const explore = async (memoryId: string, currentDepth: number) => {
      if (currentDepth > depth) return;
      if (nodes.has(memoryId)) return;

      const memory = await this.getMemory(memoryId);
      if (!memory) return;
      if (minImportance && memory.importance < minImportance) return;

      nodes.set(memoryId, {
        id: memory.id,
        content: includeContent ? memory.content : memory.content.substring(0, 50) + '...',
        type: memory.type,
        importance: memory.importance,
        emotionalValence: memory.emotionalValence,
        timestamp: memory.timestamp,
      });

      for (const assocId of memory.associations) {
        const edgeKey = [memoryId, assocId].sort().join('-');
        edges.add(edgeKey);
        await explore(assocId, currentDepth + 1);
      }
    };

    if (centerMemoryId) {
      await explore(centerMemoryId, 0);
    } else {
      // If no center, get a sample of important memories
      const importantMemories = await this.searchMemories({
        query: '',
        minImportance: 0.7,
        limit: 10,
      });
      
      for (const memory of importantMemories) {
        await explore(memory.id, 0);
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges).map(edge => {
        const [source, target] = edge.split('-');
        return { source, target };
      }),
      stats: {
        totalNodes: nodes.size,
        totalEdges: edges.size,
        averageConnections: edges.size / Math.max(nodes.size, 1),
      },
    };
  }

  private async generateSummary(content: string): Promise<string> {
    // Use OpenAI to generate proper summary
    return await this.llmService.generateSummary(content);
  }

  private prepareMemoryForEmbedding(memory: Memory): string {
    const contextStr = memory.context ? Object.entries(memory.context)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('; ') : '';
    
    const metadataStr = memory.metadata ? Object.entries(memory.metadata)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ') : '';

    let embeddingText = `${memory.content}\n\nType: ${memory.type}\nContext: ${contextStr}`;
    
    if (metadataStr) {
      embeddingText += `\nMetadata: ${metadataStr}`;
    }
    
    if (memory.project) {
      embeddingText += `\nProject: ${memory.project}`;
    }

    if (memory.system_metadata) {
      embeddingText += `\nSystem: ${memory.system_metadata.hostname}, User: ${memory.system_metadata.username}, Platform: ${memory.system_metadata.platform}`;
    }

    return embeddingText;
  }

  private calculateImportance(content: string, type: MemoryType): number {
    // Simple heuristic for importance
    let importance = 0.5;

    // Episodic memories are generally more important
    if (type === MemoryType.EPISODIC) importance += 0.2;
    
    // Emotional memories are important
    if (type === MemoryType.EMOTIONAL) importance += 0.15;
    
    // Longer content might be more detailed/important
    if (content.length > 200) importance += 0.1;
    
    // Cap at 1.0
    return Math.min(1.0, importance);
  }

  private async updateAssociations(memory: Memory): Promise<void> {
    // Find related memories
    const embedding = await this.llmService.createEmbedding(
      this.prepareMemoryForEmbedding(memory)
    );
    
    const similar = await this.qdrant.searchSimilar(embedding, 5);
    
    // Filter out self and add strong associations
    const associations = similar
      .filter(m => m.id !== memory.id)
      .slice(0, 3)
      .map(m => m.id);

    if (associations.length > 0) {
      await this.qdrant.updateMemoryMetadata(memory.id, { associations });
      
      // Bidirectional associations
      for (const assocId of associations) {
        const assocMemory = await this.qdrant.getMemory(assocId);
        if (assocMemory && !assocMemory.associations.includes(memory.id)) {
          await this.qdrant.updateMemoryMetadata(assocId, {
            associations: [...assocMemory.associations, memory.id].slice(0, 5),
          });
        }
      }
    }
  }
}

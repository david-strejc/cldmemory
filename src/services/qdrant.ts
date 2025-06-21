import { QdrantClient } from '@qdrant/js-client-rest';
import { config, DEFAULT_SIMILARITY_THRESHOLD } from '../config/environment';
import { Memory, MemorySearchResult } from '../types/memory';

export class QdrantService {
    private client: QdrantClient;
    private collectionName: string;
    private vectorDimension: number;
  
    constructor(vectorDimension: number) {
      // Parse the URL to extract protocol, host, and port
      const url = new URL(config.QDRANT_URL);
      const isHttps = url.protocol === 'https:';
      const defaultPort = isHttps ? 443 : 6333;
      const port = url.port ? parseInt(url.port) : defaultPort;
  
      this.client = new QdrantClient({
        host: url.hostname,
        port: port,
        https: isHttps,
        apiKey: config.QDRANT_API_KEY,
        checkCompatibility: false,
      });
      this.collectionName = config.QDRANT_COLLECTION_NAME;
      this.vectorDimension = vectorDimension;
    }

  async initialize(): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(
        (col) => col.name === this.collectionName
      );

      if (!exists) {
      	 await this.client.createCollection(this.collectionName, {
        	 vectors: {
            	 size: this.vectorDimension,
                 distance: 'Cosine',
             },
         });
      }
    } catch (error) {
      throw error;
    }
  }

  async upsertMemory(memory: Memory, embedding: number[]): Promise<void> {
    await this.client.upsert(this.collectionName, {
      points: [
        {
          id: memory.id,
          vector: embedding,
          payload: {
            ...memory,
            timestamp: memory.timestamp.toISOString(),
            lastAccessed: memory.lastAccessed.toISOString(),
          },
        },
      ],
    });
  }

  async searchSimilar(
    embedding: number[],
    limit: number = 10,
    filter?: any,
    threshold?: number
  ): Promise<Memory[]> {
    // Use provided threshold or fall back to config or default
    const similarityThreshold = threshold ?? config.SIMILARITY_THRESHOLD ?? DEFAULT_SIMILARITY_THRESHOLD;
    
    // Search with a higher limit to account for filtering
    const searchLimit = Math.min(limit * 3, 100); // Search up to 3x requested or max 100
    
    const results = await this.client.search(this.collectionName, {
      vector: embedding,
      limit: searchLimit,
      filter,
      with_payload: true,
      score_threshold: similarityThreshold,
    });

    // Filter by similarity score and limit results
    return results
      .filter(result => result.score >= similarityThreshold)
      .slice(0, limit)
      .map((result) => {
        if (!result.payload) return null;
        return {
          ...result.payload,
          timestamp: new Date(result.payload.timestamp as string),
          lastAccessed: new Date(result.payload.lastAccessed as string),
        };
      })
      .filter((m): m is Memory => m !== null);
  }

  async searchSimilarWithScores(
    embedding: number[],
    limit: number = 10,
    filter?: any,
    threshold?: number
  ): Promise<MemorySearchResult[]> {
    // Use provided threshold or fall back to config or default
    const similarityThreshold = threshold ?? config.SIMILARITY_THRESHOLD ?? DEFAULT_SIMILARITY_THRESHOLD;
    
    // Search with a higher limit to account for filtering
    const searchLimit = Math.min(limit * 3, 100); // Search up to 3x requested or max 100
    
    const results = await this.client.search(this.collectionName, {
      vector: embedding,
      limit: searchLimit,
      filter,
      with_payload: true,
      score_threshold: similarityThreshold,
    });

    // Filter by similarity score and limit results
    return results
      .filter(result => result.score >= similarityThreshold)
      .slice(0, limit)
      .map((result) => {
        if (!result.payload) return null;
        const memory: Memory = {
          ...result.payload,
          timestamp: new Date(result.payload.timestamp as string),
          lastAccessed: new Date(result.payload.lastAccessed as string),
        } as Memory;
        return {
          memory,
          score: result.score
        };
      })
      .filter((m): m is MemorySearchResult => m !== null);
  }

  async getMemory(id: string): Promise<Memory | null> {
    const results = await this.client.retrieve(this.collectionName, {
      ids: [id],
      with_payload: true,
    });

    if (results.length === 0) return null;

    const payload = results[0].payload;
    if (!payload) return null;
    
    return {
      ...payload,
      timestamp: new Date(payload.timestamp as string),
      lastAccessed: new Date(payload.lastAccessed as string),
    } as Memory;
  }

  async deleteMemory(id: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      points: [id],
    });
  }

  async deleteMemories(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    
    await this.client.delete(this.collectionName, {
      points: ids,
    });
  }

  async deleteAllMemories(): Promise<void> {
    // Delete all points from the collection
    await this.client.delete(this.collectionName, {
      filter: {},
    });
  }

  async updateMemoryMetadata(
    id: string,
    updates: Partial<Memory>
  ): Promise<void> {
    const memory = await this.getMemory(id);
    if (!memory) throw new Error(`Memory ${id} not found`);

    const updatedMemory = {
      ...memory,
      ...updates,
      lastAccessed: new Date(),
      accessCount: memory.accessCount + 1,
    };

    await this.client.setPayload(this.collectionName, {
      points: [id],
      payload: {
        ...updatedMemory,
        timestamp: updatedMemory.timestamp.toISOString(),
        lastAccessed: updatedMemory.lastAccessed.toISOString(),
      },
    });
  }

  async searchByMetadata(metadata: Record<string, any>): Promise<Memory[]> {
    const filter: any = {
      must: []
    };

    // Build filter conditions for each metadata field
    for (const [key, value] of Object.entries(metadata)) {
      filter.must.push({
        key: `context.${key}`,
        match: { value }
      });
    }

    const results = await this.client.scroll(this.collectionName, {
      filter,
      with_payload: true,
      limit: 100
    });

    return results.points
      .map((point) => {
        if (!point.payload) return null;
        return {
          ...point.payload,
          timestamp: new Date(point.payload.timestamp as string),
          lastAccessed: new Date(point.payload.lastAccessed as string),
        };
      })
      .filter((m): m is Memory => m !== null);
  }

  async searchByFilters(filter: any, limit: number = 100): Promise<Memory[]> {
    const results = await this.client.scroll(this.collectionName, {
      filter,
      with_payload: true,
      limit
    });

    return results.points
      .map((point) => {
        if (!point.payload) return null;
        return {
          ...point.payload,
          timestamp: new Date(point.payload.timestamp as string),
          lastAccessed: new Date(point.payload.lastAccessed as string),
        };
      })
      .filter((m): m is Memory => m !== null);
  }
}

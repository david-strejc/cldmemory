export interface Memory {
  id: string;
  summary: string; // Short 1-2 sentence summary for context-efficient retrieval
  content: string; // Full detailed content
  type: MemoryType;
  timestamp: Date;
  importance: number; // 0-1 scale
  emotionalValence: number; // -1 to 1 (negative to positive)
  associations: string[]; // IDs of related memories
  context: MemoryContext;
  metadata: Record<string, any>;
  lastAccessed: Date;
  accessCount: number;
  decay: number; // 0-1 scale, how much the memory has faded
  project?: string; // hostname + folder path
  system_metadata?: SystemMetadata; // System info: hostname, username, OS
}

export interface SystemMetadata {
  hostname: string;
  username: string;
  platform: string; // 'linux', 'darwin', 'win32', etc.
  timestamp: Date;
}

export enum MemoryType {
  EPISODIC = 'episodic', // Personal experiences
  SEMANTIC = 'semantic', // Facts and knowledge
  PROCEDURAL = 'procedural', // How to do things
  EMOTIONAL = 'emotional', // Emotional memories
  SENSORY = 'sensory', // Sensory impressions
  WORKING = 'working', // Short-term working memory
}

export interface MemoryContext {
  location?: string;
  people?: string[];
  mood?: string;
  activity?: string;
  tags?: string[];
  source?: string;
  // Chunking-related fields
  isParentChunk?: boolean;
  chunkIndex?: number;
  chunkOf?: string; // Parent memory ID
  totalChunks?: number;
  semanticDensity?: number;
}

export interface MemorySearchParams {
  query: string;
  type?: MemoryType;
  minImportance?: number;
  emotionalRange?: { min: number; max: number };
  dateRange?: { start: Date; end: Date };
  limit?: number;
  includeAssociations?: boolean;
  detailLevel?: 'compact' | 'full';
  similarityThreshold?: number;
}

export interface CompactMemory {
  id: string;
  summary: string; // Only summary in compact mode for context efficiency
  type: MemoryType;
  timestamp: Date;
  importance: number;
  emotionalValence: number;
  tags?: string[];
  project?: string; // hostname + folder path
  relevanceScore?: number; // Similarity score from vector search (0-1)
}

export interface MemorySearchResult {
  memory: Memory;
  score: number; // Relevance/similarity score
}

export interface MemoryCluster {
  id: string;
  theme: string;
  memories: string[]; // Memory IDs
  strength: number; // Connection strength
  keywords: string[];
}
interface LLMService {
  createEmbedding(text: string): Promise<number[]>;
  createEmbeddings(texts: string[]): Promise<number[][]>;
  extractKeywords(text: string): Promise<string[]>;
  generateSummary(content: string): Promise<string>;
  summarizeTexts(texts: string[]): Promise<string>;
}

export interface ChunkingOptions {
  method: 'semantic' | 'fixed' | 'sentence' | 'paragraph';
  maxChunkSize?: number; // in tokens
  overlapSize?: number; // in tokens
  semanticThreshold?: number; // 0-1, similarity threshold for semantic chunking
}

export interface TextChunk {
  content: string;
  startIndex: number;
  endIndex: number;
  embedding?: number[];
  metadata?: {
    sentenceCount?: number;
    avgSentenceLength?: number;
    semanticDensity?: number;
  };
}

export class ChunkingService {
  private llmService: LLMService; // Change from 'openai' to general 'llmService'

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  async chunkText(text: string, options: ChunkingOptions): Promise<TextChunk[]> {
    switch (options.method) {
      case 'semantic':
        return this.semanticChunk(text, options);
      case 'sentence':
        return this.sentenceChunk(text, options);
      case 'paragraph':
        return this.paragraphChunk(text, options);
      case 'fixed':
      default:
        return this.fixedChunk(text, options);
    }
  }

  private async semanticChunk(text: string, options: ChunkingOptions): Promise<TextChunk[]> {
    const sentences = this.splitIntoSentences(text);
    const chunks: TextChunk[] = [];
    
    if (sentences.length === 0) return chunks;
    
    // Create sentence groups with context (previous and next sentence)
    const sentenceGroups: string[] = [];
    const groupIndices: number[] = [];
    
    for (let i = 0; i < sentences.length; i++) {
      const prevSentence = i > 0 ? sentences[i - 1] : '';
      const currentSentence = sentences[i];
      const nextSentence = i < sentences.length - 1 ? sentences[i + 1] : '';
      
      sentenceGroups.push(`${prevSentence} ${currentSentence} ${nextSentence}`.trim());
      groupIndices.push(i);
    }
    
    // Generate embeddings for all sentence groups
    const embeddings = await this.llmService.createEmbeddings(sentenceGroups);
    
    // Build chunks based on semantic similarity
    let currentChunk: string[] = [sentences[0]];
    let chunkStartIndex = 0;
    let currentChunkEmbedding = embeddings[0];
    
    const threshold = options.semanticThreshold || 0.75;
    
    for (let i = 1; i < sentences.length; i++) {
      const similarity = this.cosineSimilarity(currentChunkEmbedding, embeddings[i]);
      
      // Check if we should continue the current chunk or start a new one
      const estimatedTokens = this.estimateTokens(currentChunk.join(' ') + ' ' + sentences[i]);
      
      if (similarity >= threshold && (!options.maxChunkSize || estimatedTokens <= options.maxChunkSize)) {
        // Add to current chunk
        currentChunk.push(sentences[i]);
        // Update chunk embedding (average of all sentence embeddings in chunk)
        currentChunkEmbedding = this.averageEmbeddings(
          embeddings.slice(chunkStartIndex, i + 1)
        ) || currentChunkEmbedding;
      } else {
        // Save current chunk and start new one
        const chunkContent = currentChunk.join(' ');
        const startIdx = text.indexOf(currentChunk[0]);
        const endIdx = startIdx + chunkContent.length;
        
        chunks.push({
          content: chunkContent,
          startIndex: startIdx,
          endIndex: endIdx,
          embedding: currentChunkEmbedding,
          metadata: {
            sentenceCount: currentChunk.length,
            avgSentenceLength: chunkContent.length / currentChunk.length,
            semanticDensity: this.calculateSemanticDensity(embeddings.slice(chunkStartIndex, i))
          }
        });
        
        // Start new chunk with overlap if specified
        if (options.overlapSize && options.overlapSize > 0) {
          const overlapSentences = Math.ceil(options.overlapSize / 50); // Estimate ~50 chars per sentence
          const startIdx = Math.max(0, i - overlapSentences);
          currentChunk = sentences.slice(startIdx, i + 1);
          chunkStartIndex = startIdx;
          currentChunkEmbedding = this.averageEmbeddings(embeddings.slice(startIdx, i + 1)) || embeddings[i];
        } else {
          currentChunk = [sentences[i]];
          chunkStartIndex = i;
          currentChunkEmbedding = embeddings[i];
        }
      }
    }
    
    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      const chunkContent = currentChunk.join(' ');
      const startIdx = text.indexOf(currentChunk[0]);
      const endIdx = startIdx + chunkContent.length;
      
      chunks.push({
        content: chunkContent,
        startIndex: startIdx,
        endIndex: endIdx,
        embedding: currentChunkEmbedding,
        metadata: {
          sentenceCount: currentChunk.length,
          avgSentenceLength: chunkContent.length / currentChunk.length,
          semanticDensity: this.calculateSemanticDensity(embeddings.slice(chunkStartIndex))
        }
      });
    }
    
    return chunks;
  }

  private sentenceChunk(text: string, options: ChunkingOptions): Promise<TextChunk[]> {
    const sentences = this.splitIntoSentences(text);
    const chunks: TextChunk[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let chunkStartIndex = 0;
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      const sentenceTokens = this.estimateTokens(sentence);
      
      if (options.maxChunkSize && currentTokens + sentenceTokens > options.maxChunkSize && currentChunk.length > 0) {
        // Save current chunk
        const chunkContent = currentChunk.join(' ');
        chunks.push({
          content: chunkContent,
          startIndex: chunkStartIndex,
          endIndex: chunkStartIndex + chunkContent.length,
          metadata: {
            sentenceCount: currentChunk.length,
            avgSentenceLength: chunkContent.length / currentChunk.length
          }
        });
        
        // Start new chunk with overlap
        if (options.overlapSize && options.overlapSize > 0) {
          const overlapSentences = Math.ceil(options.overlapSize / 50);
          const startIdx = Math.max(0, i - overlapSentences);
          currentChunk = sentences.slice(startIdx, i);
          currentTokens = currentChunk.reduce((sum, s) => sum + this.estimateTokens(s), 0);
          chunkStartIndex = text.indexOf(currentChunk[0]);
        } else {
          currentChunk = [];
          currentTokens = 0;
          chunkStartIndex = text.indexOf(sentence);
        }
      }
      
      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }
    
    // Add last chunk
    if (currentChunk.length > 0) {
      const chunkContent = currentChunk.join(' ');
      chunks.push({
        content: chunkContent,
        startIndex: chunkStartIndex,
        endIndex: chunkStartIndex + chunkContent.length,
        metadata: {
          sentenceCount: currentChunk.length,
          avgSentenceLength: chunkContent.length / currentChunk.length
        }
      });
    }
    
    return Promise.resolve(chunks);
  }

  private paragraphChunk(text: string, options: ChunkingOptions): Promise<TextChunk[]> {
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    const chunks: TextChunk[] = [];
    let currentIndex = 0;
    
    for (const paragraph of paragraphs) {
      const startIndex = text.indexOf(paragraph, currentIndex);
      const endIndex = startIndex + paragraph.length;
      
      chunks.push({
        content: paragraph,
        startIndex,
        endIndex,
        metadata: {
          sentenceCount: this.splitIntoSentences(paragraph).length
        }
      });
      
      currentIndex = endIndex;
    }
    
    return Promise.resolve(chunks);
  }

  private fixedChunk(text: string, options: ChunkingOptions): Promise<TextChunk[]> {
    const chunks: TextChunk[] = [];
    const maxSize = options.maxChunkSize || 500;
    const overlapSize = options.overlapSize || Math.floor(maxSize * 0.1);
    
    let startIndex = 0;
    
    while (startIndex < text.length) {
      let endIndex = startIndex + maxSize;
      
      // Try to find a sentence boundary
      if (endIndex < text.length) {
        const searchStart = Math.max(startIndex, endIndex - 50);
        const sentenceEnd = text.indexOf('. ', searchStart);
        if (sentenceEnd !== -1 && sentenceEnd < endIndex + 50) {
          endIndex = sentenceEnd + 2;
        }
      } else {
        endIndex = text.length;
      }
      
      chunks.push({
        content: text.substring(startIndex, endIndex),
        startIndex,
        endIndex
      });
      
      startIndex = endIndex - overlapSize;
    }
    
    return Promise.resolve(chunks);
  }

  private splitIntoSentences(text: string): string[] {
    // Improved sentence splitting that handles common edge cases
    const sentences = text
      .replace(/([.!?])\s*(?=[A-Z])/g, '$1|')
      .split('|')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    return sentences;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private cosineSimilarity(vec1: number[] | undefined, vec2: number[] | undefined): number {
    if (!vec1 || !vec2) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  private averageEmbeddings(embeddings: (number[] | undefined)[]): number[] | undefined {
    const validEmbeddings = embeddings.filter((e): e is number[] => e !== undefined);
    if (validEmbeddings.length === 0) return undefined;
    
    const avg = new Array(validEmbeddings[0].length).fill(0);
    
    for (const embedding of validEmbeddings) {
      for (let i = 0; i < embedding.length; i++) {
        avg[i] += embedding[i];
      }
    }
    
    return avg.map(v => v / validEmbeddings.length);
  }

  private calculateSemanticDensity(embeddings: number[][]): number {
    if (embeddings.length < 2) return 1;
    
    let totalSimilarity = 0;
    let comparisons = 0;
    
    for (let i = 0; i < embeddings.length - 1; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        totalSimilarity += this.cosineSimilarity(embeddings[i], embeddings[j]);
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  async mergeChunks(chunks: TextChunk[], similarityThreshold: number = 0.8): Promise<TextChunk[]> {
    if (chunks.length < 2) return chunks;
    
    const mergedChunks: TextChunk[] = [];
    let currentMerged = chunks[0];
    
    for (let i = 1; i < chunks.length; i++) {
      if (currentMerged.embedding && chunks[i].embedding) {
        const currentEmbedding = currentMerged.embedding;
        const nextEmbedding = chunks[i].embedding;
        const similarity = this.cosineSimilarity(currentEmbedding, nextEmbedding);
        
        if (similarity >= similarityThreshold) {
          // Merge chunks
          const mergedEmbedding = this.averageEmbeddings([currentEmbedding, nextEmbedding]);
          currentMerged = {
            content: currentMerged.content + ' ' + chunks[i].content,
            startIndex: currentMerged.startIndex,
            endIndex: chunks[i].endIndex,
            embedding: mergedEmbedding,
            metadata: {
              sentenceCount: (currentMerged.metadata?.sentenceCount || 0) + (chunks[i].metadata?.sentenceCount || 0),
              semanticDensity: ((currentMerged.metadata?.semanticDensity || 0) + (chunks[i].metadata?.semanticDensity || 0)) / 2
            }
          };
        } else {
          mergedChunks.push(currentMerged);
          currentMerged = chunks[i];
        }
      } else {
        mergedChunks.push(currentMerged);
        currentMerged = chunks[i];
      }
    }
    
    mergedChunks.push(currentMerged);
    return mergedChunks;
  }
}

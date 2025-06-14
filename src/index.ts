import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { MemoryService } from './services/memory';
import { MemoryType, MemorySearchParams } from './types/memory';
import { tools } from './mcp/tools';
import { config } from './config/environment';
import { zodToJsonSchema } from './utils/zodToJsonSchema';

class MemoryMCPServer {
  private server: Server;
  private memoryService: MemoryService;

  constructor() {
    this.memoryService = new MemoryService();
    this.server = new Server(
      {
        name: config.MCP_SERVER_NAME,
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(tools).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {

          case 'store_memory': {
            const parsed = tools.store_memory.inputSchema.parse(args);
            const memory = await this.memoryService.createMemory(
              parsed.content,
              parsed.type as MemoryType,
              parsed.context,
              parsed.importance,
              parsed.summary
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(memory, null, 2),
                },
              ],
            };
          }

          case 'store_memory_chunked': {
            const parsed = tools.store_memory_chunked.inputSchema.parse(args);
            const memories = await this.memoryService.createMemoryWithChunking(
              parsed.content,
              parsed.type as MemoryType,
              parsed.context,
              parsed.importance,
              parsed.chunkingOptions,
              parsed.summary
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Created ${memories.length} memory chunks`,
                    parentId: memories[0].id,
                    chunkIds: memories.slice(1).map(m => m.id),
                    memories: memories
                  }, null, 2),
                },
              ],
            };
          }

          case 'search_memories': {
            const parsed = tools.search_memories.inputSchema.parse(args);
            const searchParams: any = {
              query: parsed.query,
              type: parsed.type as MemoryType | undefined,
              minImportance: parsed.minImportance,
              emotionalRange: parsed.emotionalRange,
              limit: parsed.limit,
              includeAssociations: parsed.includeAssociations,
              detailLevel: parsed.detailLevel,
              similarityThreshold: parsed.similarityThreshold,
              reconstructChunks: parsed.reconstructChunks,
            };
            
            // Add date range if provided
            if (parsed.dateRange) {
              searchParams.dateRange = {
                start: new Date(parsed.dateRange.start),
                end: new Date(parsed.dateRange.end),
              };
            }
            
            const memories = await this.memoryService.searchChunkedMemories(searchParams);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(memories, null, 2),
                },
              ],
            };
          }

          case 'quick_search_memories': {
            const parsed = tools.quick_search_memories.inputSchema.parse(args);
            
            // Use the search with scores functionality for quick browsing
            const searchParams: MemorySearchParams = {
              query: parsed.query,
              type: parsed.type as MemoryType | undefined,
              minImportance: parsed.minImportance,
              limit: parsed.limit || 20,
              includeAssociations: false,
              detailLevel: 'compact',
              similarityThreshold: 0.3, // Use default threshold
            };
            
            const memoriesWithScores = await this.memoryService.searchMemoriesWithScores(searchParams);
            
            // The results are already in compact format with relevance scores, sorted by score
            
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(memoriesWithScores, null, 2),
                },
              ],
            };
          }

          case 'get_memory': {
            const parsed = tools.get_memory.inputSchema.parse(args);
            const memory = await this.memoryService.getMemory(parsed.id);
            return {
              content: [
                {
                  type: 'text',
                  text: memory ? JSON.stringify(memory, null, 2) : 'Memory not found',
                },
              ],
            };
          }

          case 'update_memory': {
            const parsed = tools.update_memory.inputSchema.parse(args);
            const memory = await this.memoryService.updateMemory(parsed.id, {
              content: parsed.content,
              importance: parsed.importance,
              context: parsed.context,
              metadata: parsed.metadata,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: memory ? JSON.stringify(memory, null, 2) : 'Memory not found',
                },
              ],
            };
          }

          case 'delete_memory': {
            const parsed = tools.delete_memory.inputSchema.parse(args);
            await this.memoryService.deleteMemory(parsed.id);
            return {
              content: [
                {
                  type: 'text',
                  text: `Memory ${parsed.id} deleted successfully`,
                },
              ],
            };
          }

          case 'analyze_memories': {
            const parsed = tools.analyze_memories.inputSchema.parse(args);
            // Simple analysis for now
            const memories = await this.memoryService.searchMemories({
              query: '',
              type: parsed.type as MemoryType | undefined,
              limit: 100,
            });

            const analysis = {
              totalMemories: memories.length,
              byType: memories.reduce((acc, m) => {
                acc[m.type] = (acc[m.type] || 0) + 1;
                return acc;
              }, {} as Record<string, number>),
              averageImportance: memories.reduce((sum, m) => sum + m.importance, 0) / memories.length,
              averageEmotionalValence: memories.reduce((sum, m) => sum + m.emotionalValence, 0) / memories.length,
              mostCommonTags: this.getMostCommonTags(memories),
            };

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(analysis, null, 2),
                },
              ],
            };
          }

          case 'connect_memories': {
            const parsed = tools.connect_memories.inputSchema.parse(args);
            await this.memoryService.connectMemories(
              parsed.sourceId,
              parsed.targetId,
              parsed.bidirectional
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Connected memories ${parsed.sourceId} and ${parsed.targetId}`,
                },
              ],
            };
          }

          case 'find_memory_paths': {
            const parsed = tools.find_memory_paths.inputSchema.parse(args);
            const paths = await this.memoryService.findMemoryPaths(
              parsed.startId,
              parsed.endId,
              parsed.maxDepth,
              parsed.includeContent
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(paths, null, 2),
                },
              ],
            };
          }

          case 'get_association_graph': {
            const parsed = tools.get_association_graph.inputSchema.parse(args);
            const graph = await this.memoryService.getAssociationGraph(
              parsed.centerMemoryId,
              parsed.depth,
              parsed.minImportance,
              parsed.includeContent
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(graph, null, 2),
                },
              ],
            };
          }

          case 'consolidate_memories': {
            const parsed = tools.consolidate_memories.inputSchema.parse(args);
            const consolidated = await this.memoryService.consolidateMemories(
              parsed.memoryIds,
              parsed.strategy,
              parsed.keepOriginals
            );
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(consolidated, null, 2),
                },
              ],
            };
          }

          case 'remove_association': {
            const parsed = tools.remove_association.inputSchema.parse(args);
            await this.memoryService.removeAssociation(
              parsed.sourceId,
              parsed.targetId,
              parsed.bidirectional
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Removed association between ${parsed.sourceId} and ${parsed.targetId}`,
                },
              ],
            };
          }

          case 'delete_memories_bulk': {
            const parsed = tools.delete_memories_bulk.inputSchema.parse(args);
            const result = await this.memoryService.deleteMemories(parsed.ids);
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: `Deleted ${result.deleted} memories`,
                    deleted: result.deleted,
                    failed: result.failed,
                    totalRequested: parsed.ids.length
                  }, null, 2),
                },
              ],
            };
          }

          case 'delete_all_memories': {
            const parsed = tools.delete_all_memories.inputSchema.parse(args);
            if (parsed.confirm !== true) {
              throw new Error('Confirmation required to delete all memories');
            }
            const result = await this.memoryService.deleteAllMemories();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    message: 'All memories have been deleted',
                    deleted: result.deleted
                  }, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    });
  }

  private getMostCommonTags(memories: any[]): Record<string, number> {
    const tagCounts: Record<string, number> = {};
    memories.forEach(m => {
      m.context.tags?.forEach((tag: string) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    return Object.fromEntries(
      Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
    );
  }

  async start() {
    await this.memoryService.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Start the server
const server = new MemoryMCPServer();
server.start().catch(console.error);
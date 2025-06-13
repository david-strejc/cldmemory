#!/usr/bin/env node

import { Command } from 'commander';
import { QdrantClient } from '@qdrant/js-client-rest';
import { Memory } from '../types/memory';
import * as dotenv from 'dotenv';
import chalk from 'chalk';
import Table from 'cli-table3';

dotenv.config();

interface CliConfig {
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName: string;
}

class MemoryAnalyticsCLI {
  private qdrant: QdrantClient;
  private collectionName: string;

  constructor(config: CliConfig) {
    // Parse the URL to extract protocol, host, and port
    const url = new URL(config.qdrantUrl);
    const isHttps = url.protocol === 'https:';
    const defaultPort = isHttps ? 443 : 6333;
    const port = url.port ? parseInt(url.port) : defaultPort;
    
    this.qdrant = new QdrantClient({
      host: url.hostname,
      port: port,
      https: isHttps,
      apiKey: config.qdrantApiKey,
    });
    this.collectionName = config.collectionName;
  }

  async countMemories(): Promise<void> {
    try {
      const info = await this.qdrant.getCollection(this.collectionName);
      console.log(chalk.green('\n📊 Memory Statistics:'));
      console.log(chalk.white(`Total memories: ${chalk.bold(info.points_count || 0)}`));
      
      // Sample memories instead of loading all
      const sampleMemories = await this.sampleMemories(1000);
      const byAgent = this.groupByMetadata(sampleMemories);
      
      console.log(chalk.white(`\nBy Agent (MEMORY_METADATA) - Based on ${sampleMemories.length} sampled memories:`));
      const agentTable = new Table({
        head: ['Agent', 'Sample Count', 'Est. Percentage'],
        style: { head: ['cyan'] }
      });
      
      const total = sampleMemories.length;
      for (const [agent, memories] of Object.entries(byAgent)) {
        const percentage = ((memories.length / total) * 100).toFixed(1);
        agentTable.push([agent || '(no agent)', memories.length, `${percentage}%`]);
      }
      console.log(agentTable.toString());
    } catch (error) {
      console.error(chalk.red('Error counting memories:'), error);
    }
  }

  private async sampleMemories(sampleSize: number = 1000): Promise<Memory[]> {
    const memories: Memory[] = [];
    
    try {
      // Use search without query to get random sample
      const response = await this.qdrant.search(this.collectionName, {
        vector: Array(1536).fill(0), // Zero vector for random sampling
        limit: Math.min(sampleSize, 1000), // Qdrant limit
        with_payload: true,
        with_vector: false
      });
      
      if (response && response.length > 0) {
        for (const result of response) {
          if (result.payload) {
            memories.push(result.payload as unknown as Memory);
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('Error sampling memories:'), error);
    }
    
    return memories;
  }

  private groupByMetadata(memories: Memory[]): Record<string, Memory[]> {
    const groups: Record<string, Memory[]> = {};
    
    for (const memory of memories) {
      // Get the agent identifier from metadata
      let agent = '';
      if (memory.metadata?.user) {
        agent = memory.metadata.user;
      } else if (memory.metadata && Object.keys(memory.metadata).length > 0) {
        // Use first metadata key-value as identifier
        const [key, value] = Object.entries(memory.metadata)[0];
        agent = `${key}:${value}`;
      }
      
      if (!groups[agent]) groups[agent] = [];
      groups[agent].push(memory);
    }
    
    return groups;
  }
}

// CLI setup
const program = new Command();

program
  .name('memory-analytics-fast')
  .description('Fast analytics tool for memory system (sampling-based)')
  .version('1.0.0')
  .requiredOption('-u, --url <url>', 'Qdrant URL')
  .option('-k, --api-key <key>', 'Qdrant API key')
  .option('-c, --collection <name>', 'Collection name', 'human_memories');

program
  .command('count')
  .description('Count total memories and estimate by agent')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.countMemories();
    process.exit(0);
  });

program.parse();
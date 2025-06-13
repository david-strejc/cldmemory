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
      
      // Get all memories to analyze by metadata
      const allMemories = await this.getAllMemories();
      const byAgent = this.groupByMetadata(allMemories);
      
      console.log(chalk.white(`\nBy Agent (MEMORY_METADATA):`));
      const agentTable = new Table({
        head: ['Agent', 'Count', 'Percentage'],
        style: { head: ['cyan'] }
      });
      
      const total = allMemories.length;
      for (const [agent, memories] of Object.entries(byAgent)) {
        const percentage = ((memories.length / total) * 100).toFixed(1);
        agentTable.push([agent || '(no agent)', memories.length, `${percentage}%`]);
      }
      console.log(agentTable.toString());
    } catch (error) {
      console.error(chalk.red('Error counting memories:'), error);
    }
  }

  async countByTags(): Promise<void> {
    try {
      const allMemories = await this.getAllMemories();
      const tagCounts = new Map<string, number>();
      
      // Count all tags
      for (const memory of allMemories) {
        if (memory.context?.tags) {
          for (const tag of memory.context.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }
      }
      
      // Sort by count
      const sortedTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1]);
      
      console.log(chalk.green('\n🏷️  Tag Analysis:'));
      const tagTable = new Table({
        head: ['Tag', 'Count', 'Memories'],
        style: { head: ['cyan'] }
      });
      
      // Show top 20 tags
      for (const [tag, count] of sortedTags.slice(0, 20)) {
        tagTable.push([tag, count, `${((count / allMemories.length) * 100).toFixed(1)}%`]);
      }
      console.log(tagTable.toString());
      
      if (sortedTags.length > 20) {
        console.log(chalk.gray(`\n... and ${sortedTags.length - 20} more tags`));
      }
    } catch (error) {
      console.error(chalk.red('Error analyzing tags:'), error);
    }
  }

  async listMetadata(): Promise<void> {
    try {
      const allMemories = await this.getAllMemories();
      const metadataStats = new Map<string, Set<string>>();
      
      // Collect all metadata keys and values
      for (const memory of allMemories) {
        if (memory.metadata) {
          for (const [key, value] of Object.entries(memory.metadata)) {
            if (!metadataStats.has(key)) {
              metadataStats.set(key, new Set());
            }
            metadataStats.get(key)!.add(String(value));
          }
        }
      }
      
      console.log(chalk.green('\n🔖 Metadata Analysis:'));
      const metadataTable = new Table({
        head: ['Key', 'Unique Values', 'Values'],
        style: { head: ['cyan'] },
        colWidths: [20, 15, 60]
      });
      
      for (const [key, values] of metadataStats.entries()) {
        const valueList = Array.from(values).slice(0, 5).join(', ');
        const moreValues = values.size > 5 ? ` ... +${values.size - 5} more` : '';
        metadataTable.push([key, values.size, valueList + moreValues]);
      }
      console.log(metadataTable.toString());
    } catch (error) {
      console.error(chalk.red('Error analyzing metadata:'), error);
    }
  }

  async analyzeTimeline(): Promise<void> {
    try {
      const allMemories = await this.getAllMemories();
      const now = new Date();
      const dayMs = 24 * 60 * 60 * 1000;
      
      // Group by time periods
      const timeline = {
        today: 0,
        yesterday: 0,
        thisWeek: 0,
        thisMonth: 0,
        older: 0
      };
      
      for (const memory of allMemories) {
        const memoryDate = new Date(memory.timestamp);
        const daysAgo = Math.floor((now.getTime() - memoryDate.getTime()) / dayMs);
        
        if (daysAgo === 0) timeline.today++;
        else if (daysAgo === 1) timeline.yesterday++;
        else if (daysAgo < 7) timeline.thisWeek++;
        else if (daysAgo < 30) timeline.thisMonth++;
        else timeline.older++;
      }
      
      console.log(chalk.green('\n📅 Timeline Analysis:'));
      const timelineTable = new Table({
        head: ['Period', 'Count', 'Percentage'],
        style: { head: ['cyan'] }
      });
      
      const total = allMemories.length;
      timelineTable.push(
        ['Today', timeline.today, `${((timeline.today / total) * 100).toFixed(1)}%`],
        ['Yesterday', timeline.yesterday, `${((timeline.yesterday / total) * 100).toFixed(1)}%`],
        ['This Week', timeline.thisWeek, `${((timeline.thisWeek / total) * 100).toFixed(1)}%`],
        ['This Month', timeline.thisMonth, `${((timeline.thisMonth / total) * 100).toFixed(1)}%`],
        ['Older', timeline.older, `${((timeline.older / total) * 100).toFixed(1)}%`]
      );
      console.log(timelineTable.toString());
    } catch (error) {
      console.error(chalk.red('Error analyzing timeline:'), error);
    }
  }

  async analyzeTypes(): Promise<void> {
    try {
      const allMemories = await this.getAllMemories();
      const typeCounts = new Map<string, number>();
      
      for (const memory of allMemories) {
        typeCounts.set(memory.type, (typeCounts.get(memory.type) || 0) + 1);
      }
      
      console.log(chalk.green('\n🧠 Memory Type Analysis:'));
      const typeTable = new Table({
        head: ['Type', 'Count', 'Percentage'],
        style: { head: ['cyan'] }
      });
      
      const total = allMemories.length;
      for (const [type, count] of typeCounts.entries()) {
        typeTable.push([type, count, `${((count / total) * 100).toFixed(1)}%`]);
      }
      console.log(typeTable.toString());
    } catch (error) {
      console.error(chalk.red('Error analyzing types:'), error);
    }
  }

  async analyzeImportance(): Promise<void> {
    try {
      const allMemories = await this.getAllMemories();
      
      // Group by importance ranges
      const ranges = {
        'Critical (0.9-1.0)': 0,
        'High (0.7-0.8)': 0,
        'Medium (0.5-0.6)': 0,
        'Low (0.3-0.4)': 0,
        'Very Low (0.0-0.2)': 0
      };
      
      let totalImportance = 0;
      for (const memory of allMemories) {
        totalImportance += memory.importance;
        
        if (memory.importance >= 0.9) ranges['Critical (0.9-1.0)']++;
        else if (memory.importance >= 0.7) ranges['High (0.7-0.8)']++;
        else if (memory.importance >= 0.5) ranges['Medium (0.5-0.6)']++;
        else if (memory.importance >= 0.3) ranges['Low (0.3-0.4)']++;
        else ranges['Very Low (0.0-0.2)']++;
      }
      
      console.log(chalk.green('\n⭐ Importance Analysis:'));
      console.log(chalk.white(`Average importance: ${chalk.bold((totalImportance / allMemories.length).toFixed(3))}`));
      
      const importanceTable = new Table({
        head: ['Range', 'Count', 'Percentage'],
        style: { head: ['cyan'] }
      });
      
      const total = allMemories.length;
      for (const [range, count] of Object.entries(ranges)) {
        importanceTable.push([range, count, `${((count / total) * 100).toFixed(1)}%`]);
      }
      console.log(importanceTable.toString());
    } catch (error) {
      console.error(chalk.red('Error analyzing importance:'), error);
    }
  }

  async compareAgents(): Promise<void> {
    try {
      const allMemories = await this.getAllMemories();
      const byAgent = this.groupByMetadata(allMemories);
      
      console.log(chalk.green('\n🤖 Agent Comparison:'));
      
      const comparisonTable = new Table({
        head: ['Metric', ...Object.keys(byAgent)],
        style: { head: ['cyan'] }
      });
      
      // Count by type for each agent
      const typesByAgent: Record<string, Record<string, number>> = {};
      for (const [agent, memories] of Object.entries(byAgent)) {
        typesByAgent[agent] = {};
        for (const memory of memories) {
          typesByAgent[agent][memory.type] = (typesByAgent[agent][memory.type] || 0) + 1;
        }
      }
      
      // Add type rows
      const allTypes = new Set<string>();
      for (const types of Object.values(typesByAgent)) {
        Object.keys(types).forEach(t => allTypes.add(t));
      }
      
      for (const type of allTypes) {
        const row = [type];
        for (const agent of Object.keys(byAgent)) {
          row.push(String(typesByAgent[agent][type] || 0));
        }
        comparisonTable.push(row);
      }
      
      // Add summary rows
      comparisonTable.push(
        ['---', ...Object.keys(byAgent).map(() => '---')],
        ['Total Memories', ...Object.values(byAgent).map(m => String(m.length))],
        ['Avg Importance', ...Object.values(byAgent).map(memories => 
          (memories.reduce((sum, m) => sum + m.importance, 0) / memories.length).toFixed(2)
        )]
      );
      
      console.log(comparisonTable.toString());
    } catch (error) {
      console.error(chalk.red('Error comparing agents:'), error);
    }
  }

  private async getAllMemories(): Promise<Memory[]> {
    const memories: Memory[] = [];
    
    try {
      // Get collection info first
      const info = await this.qdrant.getCollection(this.collectionName);
      const totalPoints = info.points_count || 0;
      
      if (totalPoints === 0) return memories;
      
      console.log(chalk.gray(`Loading ${totalPoints} memories...`));
      
      // Use search with random vectors to get all memories in batches
      const batchSize = 100;
      const batches = Math.ceil(totalPoints / batchSize);
      
      for (let i = 0; i < batches; i++) {
        try {
          // Generate random vector for each batch to get different results
          const randomVector = Array(1536).fill(0).map(() => Math.random() - 0.5);
          
          const response = await this.qdrant.search(this.collectionName, {
            vector: randomVector,
            limit: batchSize,
            offset: i * batchSize,
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
          
          if (memories.length % 500 === 0) {
            console.log(chalk.gray(`Loaded ${memories.length}/${totalPoints} memories...`));
          }
        } catch (error) {
          console.error(chalk.red(`Error in batch ${i}:`), error);
          // Continue with next batch
        }
      }
      
      // Remove duplicates based on ID
      const uniqueMemories = new Map<string, Memory>();
      for (const memory of memories) {
        if (memory.id) {
          uniqueMemories.set(memory.id, memory);
        }
      }
      
      const finalMemories = Array.from(uniqueMemories.values());
      console.log(chalk.gray(`Total unique memories loaded: ${finalMemories.length}`));
      
      return finalMemories;
    } catch (error) {
      console.error(chalk.red('Error loading memories:'), error);
      // Fallback to sampling
      console.log(chalk.yellow('Falling back to sampling mode...'));
      return this.sampleMemories(1000);
    }
  }
  
  private async sampleMemories(sampleSize: number = 1000): Promise<Memory[]> {
    const memories: Memory[] = [];
    
    try {
      const response = await this.qdrant.search(this.collectionName, {
        vector: Array(1536).fill(0),
        limit: Math.min(sampleSize, 1000),
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
  .name('memory-analytics')
  .description('Analytics tool for memory system')
  .version('1.0.0')
  .requiredOption('-u, --url <url>', 'Qdrant URL')
  .option('-k, --api-key <key>', 'Qdrant API key')
  .option('-c, --collection <name>', 'Collection name', 'human_memories');

program
  .command('count')
  .description('Count total memories and by agent')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.countMemories();
  });

program
  .command('tags')
  .description('Analyze memory tags')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.countByTags();
  });

program
  .command('metadata')
  .description('List and analyze metadata fields')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.listMetadata();
  });

program
  .command('timeline')
  .description('Analyze memory timeline')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.analyzeTimeline();
  });

program
  .command('types')
  .description('Analyze memory types distribution')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.analyzeTypes();
  });

program
  .command('importance')
  .description('Analyze memory importance distribution')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.analyzeImportance();
  });

program
  .command('compare')
  .description('Compare memories across different agents')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    await cli.compareAgents();
  });

program
  .command('all')
  .description('Run all analytics')
  .action(async () => {
    const options = program.opts();
    const cli = new MemoryAnalyticsCLI({
      qdrantUrl: options.url,
      qdrantApiKey: options.apiKey,
      collectionName: options.collection
    });
    
    await cli.countMemories();
    await cli.analyzeTypes();
    await cli.analyzeImportance();
    await cli.countByTags();
    await cli.listMetadata();
    await cli.analyzeTimeline();
    await cli.compareAgents();
  });

program.parse();
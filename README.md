# MCP Memory Server

A human-like memory system using Qdrant vector database and OpenAI embeddings, accessible through the Model Context Protocol (MCP).

## Features

- **Human-like Memory Types**:
  - Episodic (personal experiences)
  - Semantic (facts and knowledge)
  - Procedural (how to do things)
  - Emotional (emotional memories)
  - Sensory (sensory impressions)
  - Working (short-term memory)

- **Memory Characteristics**:
  - Importance scoring (0-1)
  - Emotional valence (-1 to 1)
  - Associations between memories
  - Context (location, people, mood, activity)
  - Decay factor and access tracking
  - Automatic project tracking (hostname:folder)
  - Custom metadata via environment variables

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

   **New environment variables**:
   - `MEMORY_METADATA` - Optional metadata to include with all memories
     - Format: `"key:value,key2:value2"` or just `"value"` (stored as `user:value`)
     - Examples: `"server:prod,user:john"` or `"davidstrejc"`

3. **Start Qdrant** (if using local):
   ```bash
   docker run -p 6333:6333 -p 6334:6334 \
     --name qdrant-memory \
     -v $(pwd)/qdrant_storage:/qdrant/storage:z \
     qdrant/qdrant
   ```
   
   **Note**: Qdrant URL supports both HTTP and HTTPS protocols (e.g., `https://your-qdrant-instance.com:6333`)

4. **Build the project**:
   ```bash
   npm run build
   ```

## Testing with Claude Code

Use the MCP configuration file with Claude Code CLI:

```bash
# Basic usage
claude -p "Store a memory about today's meeting" --mcp-config claude-code-mcp.json

# Skip permissions for automation
claude -p "Search my memories" --mcp-config claude-code-mcp.json --dangerously-skip-permissions

# List available tools
claude -p "List available memory tools" --mcp-config claude-code-mcp.json
```

Available MCP tools (prefixed with `mcp__memory__`):

- `store_memory` - Store a new memory
- `search_memories` - Search for memories using natural language
- `get_memory` - Retrieve a specific memory
- `update_memory` - Update an existing memory
- `delete_memory` - Delete a memory
- `analyze_memories` - Analyze memory patterns

## Example Usage

```
# Store a memory
store_memory({
  "content": "Had lunch with Sarah at the Italian restaurant",
  "type": "episodic",
  "context": {
    "location": "Downtown Italian restaurant",
    "people": ["Sarah"],
    "mood": "happy"
  },
  "importance": 0.8
})

# Search memories
search_memories({
  "query": "restaurant experiences",
  "limit": 5,
  "includeAssociations": true
})
```

### New Features

**Automatic Project Tracking**: All memories now include a `project` field that captures the hostname and current working directory (e.g., `"myserver:/home/user/project"`).

**Environment Metadata**: Set the `MEMORY_METADATA` environment variable to automatically include custom metadata in all memories:
```bash
export MEMORY_METADATA="server:production,team:engineering,region:us-west"
```

This metadata is automatically:
- Added to all new memories
- Included in memory embeddings for better search relevance
- Used in search queries to improve context matching

## Memory Analytics Tool

A comprehensive CLI tool is included for analyzing memories:

```bash
# Quick start
./memory-analytics count    # Count memories by agent
./memory-analytics tags     # Analyze tag usage
./memory-analytics compare  # Compare agents
./memory-analytics all      # Run all analytics
```

See [docs/MEMORY_ANALYTICS.md](docs/MEMORY_ANALYTICS.md) for detailed documentation.

## Development

- `npm run dev` - Run in development mode
- `npm run build` - Build TypeScript
- `npm run test` - Run tests
- `npm run lint` - Run linter
- `npm run typecheck` - Type check
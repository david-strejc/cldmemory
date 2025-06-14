# Memory Analytics Tool

A comprehensive CLI tool for analyzing memories stored in the Qdrant vector database, with special focus on agent-based analysis using MEMORY_METADATA.

## Installation

```bash
npm install
npm run build

# Copy and configure environment variables
cp .env.example .env
# Edit .env with your Qdrant credentials
```

## Configuration

The analytics tools now require environment variables to be set. No API keys are hardcoded.

**Required environment variables:**
- `QDRANT_URL` - Your Qdrant instance URL (e.g., `https://memory.apertia.ai`)
- `QDRANT_API_KEY` - Your Qdrant API key
- `QDRANT_COLLECTION_NAME` - Collection name (defaults to `human_memories`)

## Usage

### Using the shell script (recommended)

```bash
# Count all memories and group by agent
./memory-analytics count

# Analyze tags across all memories
./memory-analytics tags

# List all metadata fields and values
./memory-analytics metadata

# Analyze memory timeline
./memory-analytics timeline

# Analyze memory types distribution
./memory-analytics types

# Analyze importance distribution
./memory-analytics importance

# Compare memories across different agents
./memory-analytics compare

# Run all analytics
./memory-analytics all
```

### Direct usage with custom connection

```bash
# Using custom Qdrant instance (supports both HTTP and HTTPS)
node dist/cli/memory-analytics.js \
  --url "https://your-qdrant:6333" \
  --api-key "your-api-key" \
  --collection "your-collection" \
  count
```

### Using environment variables

The tools will automatically load from `.env` file if present, or you can set environment variables directly:

```bash
export QDRANT_URL="https://custom-qdrant:6333"
export QDRANT_API_KEY="your-api-key"
export QDRANT_COLLECTION_NAME="custom_collection"
./memory-analytics count
```

## Commands

### `count`
Displays total memory count and breakdown by agent (MEMORY_METADATA).

**Output includes:**
- Total number of memories
- Count per agent with percentages
- Identifies memories without agent metadata

### `tags`
Analyzes all tags used in memory contexts.

**Output includes:**
- Top 20 most used tags
- Usage count and percentage for each tag
- Total number of unique tags

### `metadata`
Lists all metadata fields and their unique values.

**Output includes:**
- All metadata keys found
- Number of unique values per key
- Sample values for each key

### `timeline`
Analyzes when memories were created.

**Output includes:**
- Memories created today
- Memories created yesterday
- This week's memories
- This month's memories
- Older memories

### `types`
Shows distribution of memory types (episodic, semantic, procedural, etc.).

**Output includes:**
- Count per memory type
- Percentage distribution

### `importance`
Analyzes the importance distribution of memories.

**Output includes:**
- Average importance score
- Distribution across importance ranges:
  - Critical (0.9-1.0)
  - High (0.7-0.8)
  - Medium (0.5-0.6)
  - Low (0.3-0.4)
  - Very Low (0.0-0.2)

### `compare`
Compares memories across different agents.

**Output includes:**
- Memory type distribution per agent
- Total memories per agent
- Average importance per agent

### `all`
Runs all analytics commands in sequence for a comprehensive analysis.

## Understanding Agent Identification

The tool uses the MEMORY_METADATA environment variable to identify different agents:

1. **Single value format**: `MEMORY_METADATA="agentname"`
   - Stored as `{"user": "agentname"}`
   
2. **Key-value format**: `MEMORY_METADATA="server:prod,user:john"`
   - Stored as `{"server": "prod", "user": "john"}`

Agents are identified by:
- The `user` field if present
- The first metadata key-value pair if no `user` field
- "(no agent)" for memories without metadata

## Examples

### Example 1: Basic Analysis
```bash
# See how many memories each agent has created
./memory-analytics count

# Output:
# 📊 Memory Statistics:
# Total memories: 1,234
# 
# By Agent (MEMORY_METADATA):
# ┌─────────────┬───────┬────────────┐
# │ Agent       │ Count │ Percentage │
# ├─────────────┼───────┼────────────┤
# │ davidstrejc │ 456   │ 37.0%      │
# │ agent2      │ 378   │ 30.6%      │
# │ (no agent)  │ 400   │ 32.4%      │
# └─────────────┴───────┴────────────┘
```

### Example 2: Tag Analysis
```bash
# Find most common topics/tags
./memory-analytics tags

# Output:
# 🏷️  Tag Analysis:
# ┌──────────────┬───────┬──────────┐
# │ Tag          │ Count │ Memories │
# ├──────────────┼───────┼──────────┤
# │ programming  │ 234   │ 19.0%    │
# │ memory       │ 189   │ 15.3%    │
# │ api          │ 156   │ 12.6%    │
# └──────────────┴───────┴──────────┘
```

### Example 3: Agent Comparison
```bash
# Compare what different agents remember
./memory-analytics compare

# Output:
# 🤖 Agent Comparison:
# ┌─────────────────┬─────────────┬────────┐
# │ Metric          │ davidstrejc │ agent2 │
# ├─────────────────┼─────────────┼────────┤
# │ episodic        │ 123         │ 89     │
# │ semantic        │ 234         │ 189    │
# │ procedural      │ 99          │ 100    │
# ├─────────────────┼─────────────┼────────┤
# │ Total Memories  │ 456         │ 378    │
# │ Avg Importance  │ 0.72        │ 0.68   │
# └─────────────────┴─────────────┴────────┘
```

## Tips

1. **Performance**: The tool loads all memories into memory for analysis. For very large collections (>100k memories), operations may take time.

2. **Filtering**: Currently analyzes all memories. Future versions may add date ranges and agent filtering.

3. **Export**: Pipe output to files for further analysis:
   ```bash
   ./memory-analytics all > analysis-report.txt
   ```

4. **Monitoring**: Use in cron jobs for regular monitoring:
   ```bash
   # Add to crontab for daily reports
   0 9 * * * /path/to/memory-analytics all > /path/to/daily-report-$(date +\%Y\%m\%d).txt
   ```

## Troubleshooting

**Connection errors**: Verify Qdrant URL and API key are correct.

**No memories found**: Check collection name matches your configuration.

**Missing metadata**: Memories created before metadata implementation will show as "(no agent)".
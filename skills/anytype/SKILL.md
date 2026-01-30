---
name: anytype
description: Connect to Anytype as a local "second brain" - search, create, and surface insights from your encrypted knowledge base. Syncs objects to local memory for semantic vector search.
homepage: https://developers.anytype.io
metadata: {"moltbot":{"emoji":"🧠","requires":{"bins":["mcporter"]},"primaryEnv":"ANYTYPE_API_KEY","install":[{"id":"node","kind":"node","package":"mcporter","bins":["mcporter"],"label":"Install mcporter (node)"}]}}
---

# anytype

Connect to Anytype for semantic search, object management, and insight generation. Uses mcporter to communicate with the Anytype MCP server.

## Setup

### 1. Get your Anytype API key

1. Open **Anytype Desktop** (must be running for API access)
2. Go to **Settings** (gear icon) > **API Keys**
3. Click **Create new** to generate a key
4. Copy the key (starts with `Bearer `)

### 2. Configure mcporter

Add Anytype to mcporter config:

```bash
mcporter config add anytype \
  --command "npx -y @anyproto/anytype-mcp" \
  --env "OPENAPI_MCP_HEADERS={\"Authorization\":\"Bearer YOUR_API_KEY\",\"Anytype-Version\":\"2025-05-19\"}"
```

Or edit `~/.config/mcporter.json` directly:

```json
{
  "servers": {
    "anytype": {
      "command": "npx",
      "args": ["-y", "@anyproto/anytype-mcp"],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\":\"Bearer YOUR_API_KEY\",\"Anytype-Version\":\"2025-05-19\"}"
      }
    }
  }
}
```

### 3. Verify connection

```bash
mcporter list anytype
```

Should show available tools like `search_objects`, `get_object`, `create_object`, etc.

## Core Operations

### Search objects

```bash
mcporter call anytype.search_objects query="meeting notes" --output json
```

With filters:
```bash
mcporter call anytype.search_objects query="project" types="[\"Note\",\"Task\"]" --output json
```

### Get object details

```bash
mcporter call anytype.get_object object_id="bafyrei..." --output json
```

### Create object

```bash
mcporter call anytype.create_object \
  space_id="..." \
  type_key="ot-note" \
  name="New Note" \
  body="Content here" \
  --output json
```

### Update object

```bash
mcporter call anytype.update_object \
  object_id="bafyrei..." \
  name="Updated Title" \
  body="New content" \
  --output json
```

### List spaces

```bash
mcporter call anytype.get_spaces --output json
```

### List types in a space

```bash
mcporter call anytype.get_types space_id="..." --output json
```

## Memory Sync (Second Brain)

Sync Anytype objects to local markdown for semantic vector search:

```bash
python skills/anytype/scripts/sync.py
```

This creates `memory/anytype/*.md` files that Moltbot's memory system indexes automatically.

### Sync options

```bash
# Full sync
python skills/anytype/scripts/sync.py --full

# Sync specific space
python skills/anytype/scripts/sync.py --space "Personal"

# Dry run (show what would sync)
python skills/anytype/scripts/sync.py --dry-run
```

### Search synced content

After sync, use Moltbot's memory search:
```bash
moltbot memory search "machine learning notes"
```

## Insight Patterns

### Find connections

When asked to find connections between topics:
1. Search memory for both topics
2. Use `mcporter call anytype.search_objects` for live matches
3. Check object relations via `get_object`
4. Synthesize connections

### Daily review

When asked for a knowledge review:
1. Query recently modified objects: `search_objects` with date filter
2. Group by type and tags
3. Summarize themes and suggest follow-ups

### Knowledge gaps

When asked to identify gaps:
1. List all types and their object counts
2. Find objects with no relations (orphans)
3. Identify sparse areas needing attention

See `references/insight-patterns.md` for detailed patterns.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `get_spaces` | List all spaces |
| `search_objects` | Search across objects |
| `get_object` | Get object details and content |
| `create_object` | Create new object |
| `update_object` | Update object properties/content |
| `delete_object` | Delete an object |
| `get_types` | List available types in a space |
| `get_templates` | List templates for a type |
| `get_members` | List space members |
| `add_objects_to_list` | Add objects to a collection/list |
| `remove_object_from_list` | Remove from collection |
| `export_object` | Export object as markdown/protobuf |

## Notes

- Anytype Desktop must be running (API on `localhost:31009`)
- API key grants read/write access to your vault
- Synced markdown files are stored locally in `memory/anytype/`
- Vector search uses Moltbot's hybrid BM25 + embedding approach
- Relations between objects are preserved in markdown frontmatter

# Anytype Insight Patterns

Patterns for generating insights from your Anytype knowledge base.

## Finding Connections

When the user asks to find connections between topics or notes:

### Pattern 1: Direct relation lookup

```bash
# 1. Search for objects matching the topic
mcporter call anytype.search_objects query="machine learning" --output json

# 2. For each result, get full object with relations
mcporter call anytype.get_object object_id="..." --output json

# 3. Look at the "relations" field to find connected objects
# 4. Recursively fetch related objects to build a graph
```

### Pattern 2: Memory-based semantic search

```bash
# 1. Search synced memory for semantic matches
openclaw memory search "machine learning concepts"

# 2. Extract anytype_id from results' frontmatter
# 3. Fetch live relations from Anytype
# 4. Cross-reference with other memory matches
```

### Pattern 3: Tag-based clustering

```bash
# 1. Search for objects with shared tags
mcporter call anytype.search_objects types='["Note","Task"]' --output json

# 2. Group results by tags
# 3. Identify objects that share multiple tags (strong connections)
# 4. Highlight clusters and bridges between clusters
```

## Daily/Weekly Review

When the user asks for a knowledge review:

### Pattern: Recent activity summary

```bash
# 1. Get recently modified objects (last 24h or 7d)
mcporter call anytype.search_objects \
  query="" \
  limit=50 \
  --output json

# 2. Filter by modified date in results
# 3. Group by type (Note, Task, Bookmark, etc.)
# 4. Group by space if multiple spaces

# 5. Summarize:
#    - "You modified 12 notes this week"
#    - "Main themes: project-x (5), research (4), personal (3)"
#    - "3 tasks marked complete, 2 new tasks created"
#    - "Suggestion: Your 'AI Research' note links to 5 others but hasn't been updated in 2 weeks"
```

### Pattern: Orphan detection

```bash
# 1. Get all objects
mcporter call anytype.search_objects limit=500 --output json

# 2. For each object, check relations count
# 3. Flag objects with 0 relations as "orphans"
# 4. Suggest connections based on semantic similarity from memory search
```

## Knowledge Gap Analysis

When the user asks to identify gaps:

### Pattern: Type distribution

```bash
# 1. Get all types in workspace
mcporter call anytype.get_types space_id="..." --output json

# 2. Count objects per type via search
# 3. Compare against expected knowledge areas
# 4. Report: "You have 50 Notes but only 3 Bookmarks - consider saving more references"
```

### Pattern: Sparse area detection

```bash
# 1. Get all unique tags across objects
# 2. Count objects per tag
# 3. Find tags with only 1-2 objects
# 4. Suggest: "Your 'quantum-computing' tag only has 1 note - is this an area to expand?"
```

### Pattern: Stale content detection

```bash
# 1. Get all objects
# 2. Sort by last_modified_date
# 3. Find objects not touched in 30+ days
# 4. Prioritize by: has relations (important), has tasks (actionable)
# 5. Suggest review: "These 5 notes haven't been touched in a month but have active links"
```

## Synthesis Prompts

When generating insights, use these prompt patterns:

### Connection synthesis
```
Based on the following Anytype objects and their relations:
[object summaries with relations]

Identify:
1. Direct connections (explicit relations)
2. Implicit connections (shared tags, similar content)
3. Missing connections (objects that should be linked but aren't)
4. Central nodes (objects with many connections)
```

### Knowledge review synthesis
```
Here are the objects modified in the last [timeframe]:
[object list with types and tags]

Provide:
1. Main themes and topics worked on
2. Progress on any ongoing projects
3. Suggestions for next actions
4. Objects that might need attention
```

### Gap analysis synthesis
```
Here is the distribution of your knowledge base:
[type counts, tag counts, relation counts]

Here are potential orphans:
[objects with no relations]

Here are stale objects:
[objects not modified recently]

Analyze:
1. Areas that are well-developed
2. Areas that seem sparse
3. Suggested actions to strengthen the knowledge base
```

## Query Templates

### Find everything about a topic
```bash
# Combine live search + memory search
mcporter call anytype.search_objects query="$TOPIC" --output json
openclaw memory search "$TOPIC"
```

### Find related notes to current context
```bash
# Based on current conversation/task, search memory
openclaw memory search "$CURRENT_CONTEXT"
# Then expand via Anytype relations
```

### Build a topic graph
```bash
# Start with seed object
mcporter call anytype.get_object object_id="$SEED_ID" --output json
# Recursively fetch relations (depth 2-3)
# Output as mermaid diagram or bullet list
```

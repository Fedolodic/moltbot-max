#!/usr/bin/env python3
"""
Anytype to Markdown sync script.

Syncs Anytype objects to local markdown files for Moltbot's memory system
to index and enable semantic vector search.

Usage:
    python sync.py                  # Incremental sync
    python sync.py --full           # Full resync
    python sync.py --space "Name"   # Sync specific space
    python sync.py --dry-run        # Show what would sync
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Default paths
MEMORY_DIR = Path(os.environ.get("MOLTBOT_WORKSPACE", Path.home() / ".moltbot" / "workspace")) / "memory" / "anytype"
STATE_FILE = MEMORY_DIR / ".sync-state.json"


def run_mcporter(tool: str, **kwargs) -> dict[str, Any]:
    """Call an Anytype MCP tool via mcporter."""
    args = ["mcporter", "call", f"anytype.API-{tool}", "--output", "json"]
    for key, value in kwargs.items():
        if value is not None:
            if isinstance(value, (list, dict)):
                args.append(f"{key}={json.dumps(value)}")
            else:
                args.append(f"{key}={value}")

    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"mcporter failed: {result.stderr}")

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        # Some tools return plain text
        return {"text": result.stdout}


def load_state() -> dict[str, Any]:
    """Load sync state from file."""
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"last_sync": None, "synced_objects": {}}


def save_state(state: dict[str, Any]) -> None:
    """Save sync state to file."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def extract_property(properties: list, key: str) -> str | None:
    """Extract a property value by key from the properties list."""
    for prop in properties:
        if prop.get("key") == key:
            if "date" in prop:
                return prop["date"]
            if "objects" in prop:
                return prop["objects"]
            if "text" in prop:
                return prop["text"]
    return None


def object_to_markdown(obj: dict[str, Any], space_name: str) -> str:
    """Convert an Anytype object to markdown with frontmatter."""
    # Extract metadata
    obj_id = obj.get("id", "unknown")
    obj_type = obj.get("type", {}).get("name", "Unknown")
    name = obj.get("name", "Untitled")

    # Properties is a list in the actual API
    properties = obj.get("properties", [])
    created = extract_property(properties, "created_date") or ""
    modified = extract_property(properties, "last_modified_date") or ""

    # Extract backlinks/links as relations
    backlinks = extract_property(properties, "backlinks") or []
    links = extract_property(properties, "links") or []

    relations = []
    if backlinks:
        for target in backlinks:
            relations.append({"target": target, "type": "backlink"})
    if links:
        for target in links:
            relations.append({"target": target, "type": "link"})

    # Build frontmatter
    frontmatter = {
        "anytype_id": obj_id,
        "anytype_type": obj_type,
        "space": space_name,
        "created": created,
        "modified": modified,
    }
    if relations:
        frontmatter["relations"] = relations

    # Build markdown
    lines = ["---"]
    for key, value in frontmatter.items():
        if isinstance(value, (list, dict)):
            lines.append(f"{key}: {json.dumps(value)}")
        else:
            lines.append(f'{key}: "{value}"')
    lines.append("---")
    lines.append("")
    lines.append(f"# {name}")
    lines.append("")

    # Add body content - use snippet if no body
    body = obj.get("body", "") or obj.get("snippet", "") or obj.get("description", "")
    if body:
        lines.append(body)

    return "\n".join(lines)


def sync_space(space: dict[str, Any], state: dict[str, Any], dry_run: bool = False) -> int:
    """Sync all objects from a space."""
    space_id = space.get("id")
    space_name = space.get("name", "Unknown")

    print(f"Syncing space: {space_name}")

    # List all objects in space
    try:
        result = run_mcporter("list-objects", space_id=space_id, limit=1000)
    except RuntimeError as e:
        print(f"  Error listing objects: {e}")
        return 0

    objects = result.get("data", [])
    synced_count = 0

    for obj in objects:
        obj_id = obj.get("id")
        if not obj_id:
            continue

        # Skip archived objects
        if obj.get("archived"):
            continue

        # Check if object changed since last sync
        properties = obj.get("properties", [])
        modified = extract_property(properties, "last_modified_date") or ""
        last_synced = state["synced_objects"].get(obj_id, {}).get("modified", "")

        if modified == last_synced:
            continue  # Skip unchanged

        # Use the object data we already have (includes snippet)
        # For full body, we'd need to call get-object with format=md
        markdown = object_to_markdown(obj, space_name)

        # Write file
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in obj.get("name", obj_id)[:50])
        filename = f"{safe_name}_{obj_id[:12]}.md"
        filepath = MEMORY_DIR / filename

        if dry_run:
            print(f"  Would sync: {filename}")
        else:
            filepath.parent.mkdir(parents=True, exist_ok=True)
            filepath.write_text(markdown)
            print(f"  Synced: {filename}")

            # Update state
            state["synced_objects"][obj_id] = {
                "modified": modified,
                "file": str(filepath)
            }

        synced_count += 1

    return synced_count


def main():
    parser = argparse.ArgumentParser(description="Sync Anytype objects to markdown")
    parser.add_argument("--full", action="store_true", help="Full resync (ignore state)")
    parser.add_argument("--space", type=str, help="Sync only this space")
    parser.add_argument("--dry-run", action="store_true", help="Show what would sync")
    args = parser.parse_args()

    # Check mcporter available
    if subprocess.run(["which", "mcporter"], capture_output=True).returncode != 0:
        print("Error: mcporter not found. Install with: npm install -g mcporter")
        sys.exit(1)

    # Load state
    state = load_state() if not args.full else {"last_sync": None, "synced_objects": {}}

    # Get spaces
    try:
        result = run_mcporter("list-spaces")
    except RuntimeError as e:
        print(f"Error getting spaces: {e}")
        print("Make sure Anytype Desktop is running and mcporter is configured.")
        sys.exit(1)

    spaces = result.get("data", [])
    if not spaces:
        print("No spaces found.")
        sys.exit(0)

    # Filter spaces if requested
    if args.space:
        spaces = [s for s in spaces if s.get("name") == args.space]
        if not spaces:
            print(f"Space '{args.space}' not found.")
            sys.exit(1)

    # Sync each space
    total_synced = 0
    for space in spaces:
        total_synced += sync_space(space, state, dry_run=args.dry_run)

    # Save state
    if not args.dry_run:
        state["last_sync"] = datetime.now().isoformat()
        save_state(state)

    print(f"\nTotal objects synced: {total_synced}")
    if not args.dry_run:
        print(f"Memory files in: {MEMORY_DIR}")


if __name__ == "__main__":
    main()

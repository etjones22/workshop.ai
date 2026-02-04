# Sub-Agents

Workshop.AI uses specialist sub-agents for focused tasks. These run with their own prompts and limited tool access, then pass results back to the main agent.

## Email Writer
- **Purpose:** Drafts clear, professional email replies.
- **Trigger:** Email drafting intent (e.g., “draft an email”, “reply to”, “write an email”).
- **Tools:** None.

## Research
- **Purpose:** Web research with source synthesis and citations.
- **Trigger:** Research intent (e.g., “research”, “deep dive”, “find sources”).
- **Tools:** `web_search`, `web_fetch`.
- **Notes:** Runs multiple tool steps to gather sources before summarizing.
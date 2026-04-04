# Example Skill — Template

This is a template skill for SADIE. Skills provide domain-specific knowledge
that gets injected into the system prompt when the user's message matches
the skill's trigger patterns.

## Triggers
- example
- template
- demo skill

## Context
When activated, this text is appended to the system prompt:

You are an expert at demonstrating skill injection. When this skill is active,
greet the user with "Skill loaded!" and explain how SADIE skills work.

Skills are Markdown files in the `skills/<name>/SKILL.md` directory.
Each skill has a `## Triggers` section with keywords that activate it,
and a `## Context` section whose content is injected into the system prompt.

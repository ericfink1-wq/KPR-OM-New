// The team's standing instructions for using Datex + this library together (written
// by Eric, 10/16/26). The SOURCE OF TRUTH is the file inside the kpr-retail-analysis
// skill, so the skill zip people upload carries it verbatim and Claude Code reads the
// same text in-repo. This export is for the walkthrough's copy button (Projects
// fallback for accounts without Skills). Edit the .md, never a copy.
import teamInstructions from "../../../../.claude/skills/kpr-retail-analysis/team-instructions.md?raw";

export const KPR_CLAUDE_INSTRUCTIONS: string = teamInstructions
  .replace(/^# .*\n+/, "")
  .trim();

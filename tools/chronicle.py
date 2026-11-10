#!/usr/bin/env python3
"""
Aswath Chronicle: Zero-token-overhead decision and interaction audit trail logger.
Appends structured prompt/decision/action/pivot records to docs/interactions/session-ledger.md.
"""
import argparse
import os
from datetime import datetime, timezone

LEDGER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "docs",
    "interactions",
    "session-ledger.md",
)


def append_entry(title: str, prompt: str, decision: str, action: str, pivot: str = ""):
    os.makedirs(os.path.dirname(LEDGER_PATH), exist_ok=True)
    if not os.path.exists(LEDGER_PATH):
        with open(LEDGER_PATH, "w", encoding="utf-8") as f:
            f.write("# Aswath Chronicle — Engineering Decision & Interaction Ledger\n\n")
            f.write("Granular step-by-step audit trail of architectural decisions, user prompts, pivots, and commits.\n\n---\n\n")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    lines = [
        f"## [{ts}] {title}",
        "",
        f"- **User Prompt / Trigger**: {prompt}",
        f"- **Architectural Decision**: {decision}",
        f"- **Implementation Action**: {action}",
    ]
    if pivot:
        lines.append(f"- **Failure Discovery & Pivot**: {pivot}")
    lines.extend(["", "---", ""])

    with open(LEDGER_PATH, "a", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    parser = argparse.ArgumentParser(description="Record an engineering chronicle entry.")
    parser.add_argument("title", help="Short milestone title")
    parser.add_argument("-p", "--prompt", default="", help="User prompt or trigger")
    parser.add_argument("-d", "--decision", default="", help="Decision made")
    parser.add_argument("-a", "--action", default="", help="Action or files modified")
    parser.add_argument("-v", "--pivot", default="", help="Mistake/bug discovered and pivot")
    args = parser.parse_args()
    append_entry(args.title, args.prompt, args.decision, args.action, args.pivot)
    print(f"Recorded chronicle entry: {args.title}")


if __name__ == "__main__":
    main()

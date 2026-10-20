"""Template answers used when no Foundry model is configured.

The UI labels these as "offline" so nobody mistakes them for AI output.
"""

from __future__ import annotations

from . import store


def explain(moment_id: int, voice: str = "fan") -> str:
    f = store.get_moment(moment_id)
    played, better = f["played"], f["better_option"]
    def name(who: str | None) -> str:  # "#7 Omar Everwood (right winger, ...)" -> "Omar Everwood"
        return who.split(" (")[0].split(" ", 1)[1] if who else "goal"

    who = name(f["player"])
    to = name(played["to"])
    first = (
        f"{who} went for {'a shot' if played['action'] == 'shot' else 'a pass to ' + to} "
        f"({played['chance_it_arrives']} to come off, {played['goal_chance']} goal chance)."
    )
    if not better:
        return first + " That was the right call."
    bto = (better["to"] or "goal").split(" (")[0]
    if better["action"] == "shot":
        alt = "shooting"
    elif better.get("into_space"):
        alt = f"the ball into space ahead of {bto}"
    else:
        alt = f"the pass to {bto}"
    second = f" The better ball was {alt}: {better['chance_it_arrives']} to come off and a {better['goal_chance']} goal chance."
    third = f" That's {f['goal_chance_missed']} of goal chance left behind."
    if voice == "analyst" and better.get("defenders_beaten"):
        third += f" It would have taken {better['defenders_beaten']} defenders out of the game."
    return first + second + third


def ask(question: str, as_of: float | None = None) -> dict:
    with store.as_of(as_of):
        s = store.match_summary()
        lines = ["AI answers are offline (no Foundry model connected). Here are the key facts so far:"]
        for t in s["teams"]:
            lines.append(
                f"- {t['team']}: {t['goals']} goals, {t['xg']} xG, {t['good_decisions'] or '-'} good decisions, "
                f"{t['missed_chances']} missed chances."
            )
        top = store.key_moments(limit=1)
        if top:
            lines.append(f"- Biggest missed chance: {top[0]['minute']}' by {top[0]['player'].split(' (')[0]} ({top[0]['goal_chance_missed']}).")
        return {
            "text": "\n".join(lines),
            "cards": [store.card_teams()],
            "follow_ups": ["Who has missed the most chances?", "Who is the best decision maker?", "What was the biggest missed chance?"],
        }


def coach(team: str, as_of: float | None = None) -> str:
    with store.as_of(as_of):
        r = store.team_report(team)
        best = ", ".join(p["player"].split(" (")[0] + f" ({p['good_decisions']})" for p in r["best_decision_makers"]) or "-"
        weak = ", ".join(p["player"].split(" (")[0] + f" ({p['good_decisions']})" for p in r["weakest_decision_makers"]) or "-"
        halves = "; ".join(f"{k.replace('_', ' ')}: {v['good_decisions']} good, {v['missed_chances']} missed chances"
                           for k, v in r["by_half"].items())
        return (
            f"### What worked\n- Best decision makers: {best}.\n\n"
            f"### Fix next\n- {halves}.\n\n"
            f"### Player spotlight\n- Most room to improve: {weak}.\n\n"
            "_Offline template: connect a Foundry model for the AI coach._"
        )


def pundit(moment_id: int) -> dict:
    """Template breakdown used without a Foundry model."""
    f = store.get_moment(moment_id)

    def name(who: str | None) -> str:  # "#7 Omar Everwood (right winger, ...)" -> "Omar Everwood"
        return who.split(" (")[0].split(" ", 1)[1] if who else "goal"

    who = name(f["player"])
    played, better = f["played"], f["better_option"]
    to = name(played["to"])
    lines = [
        f"{f['minute']} minutes in, {who} has the ball for {f['team']}, {f['on_the_ball_at']}.",
        f"He goes to {to}: only {played['chance_it_arrives']} to arrive, {played['goal_chance']} goal chance.",
    ]
    if better:
        bto = name(better["to"])
        lines.append(f"The pass was on to {bto}: {better['goal_chance']} goal chance, {f['goal_chance_missed']} left behind.")
    return {
        "headline": f["verdict"].split(" (")[0].upper(),
        "lines": lines,
        "show": {"space": bool(better), "back_line": bool(better and better.get("defenders_beaten")),
                 "beaten": bool((better or {}).get("defenders_beaten") or played.get("defenders_beaten")),
                 "offside": bool(f.get("teammates_offside"))},
    }

"""Template answers used when no Foundry model is configured.

The UI labels these as "offline" so nobody mistakes them for AI output.
"""

from __future__ import annotations

from . import store


def explain(moment_id: int, voice: str = "fan") -> str:
    f = store.get_moment(moment_id)
    played, better = f["played"], f["better_option"]
    who = f["player"].split(" (")[0]
    to = (played["to"] or "goal").split(" (")[0]
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


def ask(question: str) -> str:
    s = store.match_summary()
    lines = ["AI answers are offline (no Foundry model connected). Here are the key facts instead:"]
    for t in s["teams"]:
        lines.append(
            f"- {t['team']}: {t['goals']} goals, {t['xg']} xG, {t['good_decisions']} good decisions, "
            f"{t['missed_chances']} missed chances, {t['clear_upgrades_missed']} clear upgrades missed."
        )
    top = store.key_moments(limit=1)[0]
    lines.append(f"- Biggest missed chance: {top['minute']}' by {top['player'].split(' (')[0]} ({top['goal_chance_missed']}).")
    return "\n".join(lines)


def coach(team: str) -> str:
    r = store.team_report(team)
    best = ", ".join(p["player"].split(" (")[0] + f" ({p['good_decisions']})" for p in r["best_decision_makers"])
    weak = ", ".join(p["player"].split(" (")[0] + f" ({p['good_decisions']})" for p in r["weakest_decision_makers"])
    h1, h2 = r["by_half"]["half_1"], r["by_half"]["half_2"]
    return (
        f"### What worked\n- Best decision makers: {best}.\n"
        f"- Good decisions: {h1['good_decisions']} in the 1st half, {h2['good_decisions']} in the 2nd.\n\n"
        f"### Fix next\n- Missed chances: {h1['missed_chances']} in the 1st half, {h2['missed_chances']} in the 2nd.\n\n"
        f"### Player spotlight\n- Most room to improve: {weak}.\n\n"
        "_Offline template: connect a Foundry model for the AI coach._"
    )

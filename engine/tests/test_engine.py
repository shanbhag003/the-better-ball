import numpy as np
import pytest

from betterball import pitch
from betterball.analysis import evaluate_decision, pass_success, xg, xt
from betterball.analysis.report import analyze_match
from betterball.sim import simulate


def test_attacking_frame_roundtrip():
    xy = np.array([[10.0, 20.0], [100.0, 5.0]])
    flipped = pitch.to_attacking_frame(xy, -1)
    assert np.allclose(flipped[0], [95.0, 48.0])
    assert np.allclose(pitch.from_attacking_frame(flipped, -1), xy)


def test_xg_shape():
    assert xg([99.5, 34]) > xg([94, 34]) > xg([88.5, 34]) > xg([80, 34])
    assert xg([94, 34]) > xg([94, 10])  # tight angle
    assert xg([94, 34], header=True) < xg([94, 34])
    assert 0.15 < xg([94, 34]) < 0.35  # penalty spot, open play


def test_xt_increases_towards_goal():
    assert xt([20, 34]) < xt([52.5, 34]) < xt([80, 34]) < xt([95, 34])
    assert xt([95, 34]) <= 0.4


def _no_vel(n):
    return np.zeros((n, 2))


def test_open_pass_is_likely_and_blocked_pass_is_not():
    passer = np.array([50.0, 34.0])
    target = np.array([65.0, 34.0])
    far_defenders = np.array([[50.0, 5.0], [80.0, 60.0]])
    blocking = np.array([[57.5, 34.0], [80.0, 60.0]])
    open_p = pass_success(passer, target, target, np.zeros(2), far_defenders, _no_vel(2)).p_success
    blocked_p = pass_success(passer, target, target, np.zeros(2), blocking, _no_vel(2)).p_success
    assert open_p > 0.85
    assert blocked_p < open_p - 0.2


def test_keeper_advantage_inside_box():
    passer = np.array([80.0, 34.0])
    target = np.array([97.0, 34.0])
    keeper = np.array([[101.0, 34.0]])
    with_hands = pass_success(passer, target, target - [2, 0], np.zeros(2), keeper, _no_vel(1), keeper=0).p_success
    without = pass_success(passer, target, target - [2, 0], np.zeros(2), keeper, _no_vel(1)).p_success
    assert with_hands < without


@pytest.fixture(scope="module")
def short_match():
    return simulate(seed=3, minutes=4, out_fps=5)


def test_simulation_outputs(short_match):
    m = short_match
    assert len(m["players"]) == 22
    assert m["meta"]["synthetic"] is True
    passes = [e for e in m["events"] if e["type"] == "pass"]
    assert len(passes) > 30
    assert all("freeze_frame" in e and len(e["freeze_frame"]["pos"]) == 22 for e in passes)
    track = np.array(m["tracking"])
    assert track.shape[1] == len(m["tracking_columns"])
    xy = track[:, 5:].reshape(len(track), 22, 2)
    assert xy[..., 0].min() > -2 and xy[..., 0].max() < 107


def test_decision_analysis(short_match):
    ev = next(e for e in short_match["events"] if e["type"] == "pass" and not e.get("set_piece"))
    res = evaluate_decision(ev, short_match["players"])
    assert res["decision_cost"] >= 0
    assert res["best"]["ev"] >= res["chosen"]["ev"]
    assert 0 <= res["chosen"]["p_success"] <= 1
    report = analyze_match(short_match)
    assert report["decisions"] and set(report["teams"]) == {"0", "1"}


def test_bypassed_counts_only_defenders_near_the_pass():
    from betterball.analysis.options import _bypassed

    passer, target = np.array([40.0, 34.0]), np.array([70.0, 34.0])
    defenders = np.array([
        [50.0, 36.0],  # in the lane: beaten
        [60.0, 28.0],  # near the lane: beaten
        [55.0, 5.0],   # far wing: not involved
        [75.0, 34.0],  # still goal-side of the receiver
        [30.0, 34.0],  # already behind the ball
    ])
    assert _bypassed(passer, target, defenders) == 2
    assert _bypassed(passer, np.array([42.0, 60.0]), defenders) == 0  # sideways pass

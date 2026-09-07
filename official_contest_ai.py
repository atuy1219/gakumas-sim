from __future__ import annotations

"""Contest DFS controller and evaluation primitives."""

from dataclasses import dataclass, field
from enum import IntEnum
import math
import struct
from typing import Hashable, Optional, Protocol, Sequence


UINT32_MASK = 0xFFFFFFFF


class ProducePlanType(IntEnum):
    UNKNOWN = 0
    COMMON = 1
    PLAN1 = 2
    PLAN2 = 3
    PLAN3 = 4


class ExamDepthFirstSearchVersionType(IntEnum):
    UNKNOWN = 0
    V1 = 1
    V2 = 2


class ExamPhase(IntEnum):
    NONE = 0
    EXAM_STANDBY = 1
    TURN_START = 2
    TURN_START_AFTER = 3
    TURN_START_DRAW = 4
    MAIN_START = 5
    MAIN = 6
    TURN_END = 7
    EXAM_END = 8


@dataclass(frozen=True)
class ExamSetting:
    exam_auto_play_enable_version: int
    exam_auto_play_search_command_plan_limits: Sequence[int]

    def __post_init__(self) -> None:
        if len(self.exam_auto_play_search_command_plan_limits) < 3:
            raise ValueError("command plan limits must contain Plan1/Plan2/Plan3")


def get_exam_depth_first_search_version_type(setting: ExamSetting) -> ExamDepthFirstSearchVersionType:
    v = setting.exam_auto_play_enable_version
    if v <= 0:
        return ExamDepthFirstSearchVersionType.UNKNOWN
    if v == 1:
        return ExamDepthFirstSearchVersionType.V1
    return ExamDepthFirstSearchVersionType.V2


def get_calculate_turn(setting: ExamSetting, plan_type: ProducePlanType) -> int:
    if plan_type in (ProducePlanType.PLAN1, ProducePlanType.PLAN2):
        return 2
    if plan_type == ProducePlanType.PLAN3:
        return 2 if get_exam_depth_first_search_version_type(setting) == ExamDepthFirstSearchVersionType.V2 else 1
    raise ValueError(f"unsupported plan: {plan_type!r}")


def get_calculate_command(setting: ExamSetting, plan_type: ProducePlanType) -> int:
    if plan_type not in (ProducePlanType.PLAN1, ProducePlanType.PLAN2, ProducePlanType.PLAN3):
        raise ValueError(f"unsupported plan: {plan_type!r}")
    return int(setting.exam_auto_play_search_command_plan_limits[int(plan_type) - 2])


class XorShift32:
    __slots__ = ("state",)
    def __init__(self, seed: int): self.state = seed & UINT32_MASK
    def next_u32(self) -> int:
        x = self.state
        x ^= (x << 13) & UINT32_MASK
        x ^= x >> 17
        x ^= (x << 5) & UINT32_MASK
        self.state = x & UINT32_MASK
        return self.state
    def next_int(self, minimum: int, maximum: int) -> int:
        if maximum <= minimum: raise ValueError("maximum must be > minimum")
        width = (maximum - minimum) & UINT32_MASK
        result = minimum + (((self.state & UINT32_MASK) * width) >> 32)
        self.next_u32()
        return int(result)


@dataclass(frozen=True)
class ProduceExamAutoResourceEvaluation:
    type: int
    resource_type: int
    resource_id: int
    remaining_term: int
    evaluation_type: int
    addition: int
    multiplication: int


def _f32(x: float) -> float:
    return struct.unpack("<f", struct.pack("<f", float(x)))[0]


def apply_resource_evaluation_score(value: int, coefficient: int, resource_evaluation: Optional[ProduceExamAutoResourceEvaluation]) -> int:
    """Apply the resource-evaluation coefficient with single-precision rounding."""
    if value == 0:
        return 0
    c = int(coefficient)
    if resource_evaluation is not None:
        addition = int(resource_evaluation.addition)
        if addition != 0:
            multiplication = int(resource_evaluation.multiplication)
            if multiplication != 0:
                v = _f32(_f32(multiplication * c + addition) / _f32(1000.0))
                c = math.trunc(_f32(v + _f32(0.0001)))
            else:
                c += addition
    return int(value) * c


class ExamSequence(Protocol):
    @property
    def phase(self) -> int: ...
    @property
    def current_turn(self) -> int: ...
    @property
    def remain_turn(self) -> int: ...
    @property
    def main_effect_type(self) -> int: ...
    @property
    def judge_parameter(self) -> int: ...
    @property
    def judge_parameter_vocal(self) -> int: ...
    @property
    def judge_parameter_dance(self) -> int: ...
    @property
    def judge_parameter_visual(self) -> int: ...
    def clone(self) -> "ExamSequence": ...
    def save_data(self) -> object: ...
    def restore_data(self, save_data: object) -> None: ...
    def advance_until_main_phase_or_end(self) -> None: ...
    def selectable_command_indices(self) -> Sequence[int]: ...
    def execute_command(self, select_index: int) -> Optional[str]: ...
    def turn_end_logs(self) -> Sequence[object]: ...
    def branch_identity(self) -> Hashable: ...


class ExamRuleCalculator(Protocol):
    def evaluate(
        self,
        sequence: ExamSequence,
        term: int,
        play_type: int,
        exam_effect_type: int,
        play_card_in_term_ids: Sequence[str],
        log: object | None = None,
    ) -> int: ...


@dataclass(frozen=True)
class ExamSimulateResult:
    select_index_list: tuple[int, ...]
    exam_save_data: object
    evaluate_score: int
    turn_end_log_list: Sequence[object]
    parameter: int
    vocal: int
    dance: int
    visual: int
    is_exam_end: bool


@dataclass
class _Node:
    sequence: ExamSequence
    select_indices: tuple[int, ...] = ()
    play_card_ids: tuple[str, ...] = ()


@dataclass
class SearchTrace:
    visited_nodes: int = 0
    leaf_nodes: int = 0
    duplicate_nodes: int = 0


@dataclass
class OfficialContestDFS:
    setting: ExamSetting
    plan_type: ProducePlanType
    calculator: ExamRuleCalculator
    trace: SearchTrace = field(default_factory=SearchTrace)
    EVALUATION_PLAY_TYPE: int = 1

    def _make_leaf_result(self, sequence: ExamSequence, calculate_turn: int,
                          select_indices: tuple[int, ...], play_card_ids: tuple[str, ...]) -> ExamSimulateResult:
        # RemainTurn is non-negative
        # in valid states, so // is equivalent here and avoids float conversion.
        term = sequence.remain_turn // calculate_turn + 1
        score = self.calculator.evaluate(
            sequence, term, self.EVALUATION_PLAY_TYPE,
            sequence.main_effect_type, play_card_ids, None,
        )
        return ExamSimulateResult(
            select_index_list=select_indices,
            exam_save_data=sequence.save_data(),
            evaluate_score=int(score),
            turn_end_log_list=tuple(sequence.turn_end_logs()),
            parameter=int(sequence.judge_parameter),
            vocal=int(sequence.judge_parameter_vocal),
            dance=int(sequence.judge_parameter_dance),
            visual=int(sequence.judge_parameter_visual),
            is_exam_end=int(sequence.phase) == int(ExamPhase.EXAM_END),
        )

    def search(self, origin_sequence: ExamSequence) -> ExamSimulateResult:
        version = get_exam_depth_first_search_version_type(self.setting)
        calculate_turn = get_calculate_turn(self.setting, self.plan_type)
        calculate_command = get_calculate_command(self.setting, self.plan_type)
        max_turn = calculate_turn if int(origin_sequence.phase) == int(ExamPhase.EXAM_STANDBY) else origin_sequence.current_turn + calculate_turn - 1

        self.trace = SearchTrace()
        result_by_path: dict[tuple[int, ...], ExamSimulateResult] = {}
        # The search maintains an execute-value map keyed from the selected-index log.
        # Keep insertion semantics; do not reorder children.
        seen_execution: set[tuple[Hashable, tuple[int, ...]]] = set()

        def visit(node: _Node) -> None:
            self.trace.visited_nodes += 1
            node.sequence.advance_until_main_phase_or_end()

            command_limit = version == ExamDepthFirstSearchVersionType.V2 and len(node.select_indices) >= calculate_command
            turn_limit = node.sequence.current_turn > max_turn
            exam_end = int(node.sequence.phase) == int(ExamPhase.EXAM_END)
            if exam_end or turn_limit or command_limit:
                if node.select_indices not in result_by_path:
                    result_by_path[node.select_indices] = self._make_leaf_result(
                        node.sequence, calculate_turn, node.select_indices, node.play_card_ids
                    )
                    self.trace.leaf_nodes += 1
                return

            selectable = list(node.sequence.selectable_command_indices())
            if not selectable:
                selectable = [-1]

            # BranchNode recursively executes children in command-index order.
            for select_index in selectable:
                child = node.sequence.clone()
                played = child.execute_command(int(select_index))
                path = node.select_indices + (int(select_index),)
                cards = node.play_card_ids if played is None else node.play_card_ids + (str(played),)
                key = (child.branch_identity(), path)
                if key in seen_execution:
                    self.trace.duplicate_nodes += 1
                    continue
                seen_execution.add(key)
                visit(_Node(child, path, cards))

        visit(_Node(origin_sequence.clone()))
        if not result_by_path:
            raise RuntimeError("Contest DFS produced no leaf result")

        # GetSearchResult uses MaxBy over the insertion-ordered result map.
        # Strict '>' preserves the first encountered maximum on a tie.
        best: ExamSimulateResult | None = None
        for result in result_by_path.values():
            if best is None or result.evaluate_score > best.evaluate_score:
                best = result
        assert best is not None
        return best

    def choose_first_command(self, origin_sequence: ExamSequence) -> int:
        result = self.search(origin_sequence)
        return result.select_index_list[0] if result.select_index_list else -1


def leaf_term(remain_turn: int, calculate_turn: int) -> int:
    if calculate_turn == 0: raise ZeroDivisionError("calculate_turn must not be zero")
    return remain_turn // calculate_turn + 1

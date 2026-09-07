from __future__ import annotations

"""Common Exam state model and deterministic simulation helpers.

Unsupported branches fail explicitly instead of substituting fallback rules.
"""

from dataclasses import dataclass, field
from enum import IntEnum, Enum
from typing import Iterable, Sequence, Hashable, Any
import math
import struct


UINT32_MASK = 0xFFFFFFFF




def _f32(value: float) -> float:
    return struct.unpack('<f', struct.pack('<f', float(value)))[0]

def _ceil_f32(value: float) -> int:
    return int(math.ceil(_f32(value)))

def _floor_f32(value: float) -> int:
    return int(math.floor(_f32(value)))

def _from_permil(value: int) -> float:
    return _f32(_f32(float(int(value))) / _f32(1000.0))


@dataclass
class ExamRuleSetting:
    """Indexed Exam setting values used by the simulator."""
    values: dict[int, int] = field(default_factory=dict)

    NAMES = {
        0:'ExamStaminaConsumptionDownPermil',1:'ExamStaminaConsumptionAddPermil',
        2:'ExamBuffConsumptionDownPermil',3:'ExamBuffConsumptionAddPermil',
        4:'ExamBlockAddDownPermil',5:'ExamStaminaConsumptionDownAddPermil',
        6:'ExamStaminaConsumptionAddDownPermil',7:'ExamStaminaReduceChange',
        8:'ExamConcentrationLessonValueMultiplePermil',9:'ExamFullPowerLessonValueMultiplePermil',
        10:'FullPowerPlayableValueAdd',11:'PreservationReleasePlayableValueAdd1',
        12:'PreservationReleasePlayableValueAdd2',13:'PreservationReleaseBlockAdd1',
        14:'PreservationReleaseBlockAdd2',15:'PreservationReleaseEnthusiastic1',
        16:'PreservationReleaseEnthusiastic2',17:'OverPreservationReleasePlayableValueAdd',
        18:'OverPreservationReleaseBlockAdd',19:'OverPreservationReleaseEnthusiastic',
        20:'ExamOverPreservationLessonValueMultiplePermil',21:'ExamOverPreservationStaminaMultiplePermil',
        22:'OverPreservationReleaseToFullPowerGrowEffectLessonAdd',
        23:'ExamConcentrationLessonValueMultiplePermil1',24:'ExamConcentrationLessonValueMultiplePermil2',
        25:'ExamPreservationLessonValueMultiplePermil1',26:'ExamPreservationLessonValueMultiplePermil2',
        27:'ExamConcentrationStaminaMultiplePermil1',28:'ExamConcentrationStaminaMultiplePermil2',
        29:'ExamConcentrationStaminaPenetrateReduce1',30:'ExamConcentrationStaminaPenetrateReduce2',
        31:'ExamPreservationStaminaMultiplePermil1',32:'ExamPreservationStaminaMultiplePermil2',
        33:'HoldLimit',34:'HandLimit',35:'TurnStartDistribute',36:'ExamGimmickParameterDebuffPermil',
        37:'ExamParameterBuffPermil',38:'ExamParameterBuffMultiplePerTurnPermil',
        39:'ExamTurnEndRecoveryStamina',40:'PanicStaminaList',
        41:'ExamBattleConditionThresholdMultipleScore',42:'ExamAutoPlayEnableVersion',
        43:'ExamAutoPlaySearchCommandPlanLimitList',
        44:'ExamLessonValueMultipleDependReviewOrAggressiveMultiplePermil',
        45:'ExamLessonValueMultipleDependReviewOrAggressiveMaxPermil',
        46:'FixMoveCardShuffleDeckEnable',47:'ExamFullPowerPointReduceCancelDisable',
    }

    def get(self, index: int) -> int:
        if index not in self.values:
            raise UnsupportedPath('IExamSetting', f'missing {self.NAMES.get(index, index)} (slot {index})')
        return int(self.values[index])

    def set(self, index: int, value: int) -> None:
        self.values[int(index)] = int(value)


@dataclass(frozen=True)
class ParameterCalculationModifier:
    # Optional parameter-calculation modifiers.
    parameter_buff_multiple: float = 1.0
    enthusiastic_multiple: float = 1.0
    concentration_multiple: float = 1.0
    full_power_multiple: float = 1.0


class UnsupportedPath(RuntimeError):
    def __init__(self, method_name: str, detail: str):
        self.method_name = method_name
        self.detail = detail
        super().__init__(f"unsupported path: {method_name}: {detail}")


class ExamPhase(IntEnum):
    # Sequential phase values used by the Exam loop.
    NONE = 0
    EXAM_STANDBY = 1
    TURN_START = 2
    TURN_START_AFTER = 3
    TURN_START_DRAW = 4
    MAIN_START = 5
    MAIN = 6
    TURN_END = 7
    EXAM_END = 8


class CardPosition(str, Enum):
    HAND = "hand"
    DECK = "deck"
    GRAVE = "grave"
    LOST = "lost"
    HOLD = "hold"


class EffectKind(str, Enum):
    # Executors implemented below.
    LESSON = "Lesson"
    LESSON_FIX = "LessonFix"
    BLOCK = "Block"
    DRAW = "Draw"
    EXTRA_TURN = "ExtraTurn"
    PARAMETER_BUFF = "ParameterBuff"
    REVIEW = "Review"
    LESSON_BUFF = "LessonBuff"


class StatusKind(str, Enum):
    PARAMETER_BUFF = "ParameterBuff"
    REVIEW = "Review"
    LESSON_BUFF = "LessonBuff"

    # These names also guard branches that are not yet supported. Inputs can
    # include them so unsupported influence is never ignored.
    SLUMP = "Slump"
    PARAMETER_BUFF_ADDITIVE_FIX = "ParameterBuffAdditiveFix"
    PARAMETER_BUFF_ADDITIVE_MULTIPLE = "ParameterBuffAdditiveMultiple"
    REVIEW_ADDITIVE_FIX = "ReviewAdditiveFix"
    REVIEW_ADDITIVE_MULTIPLE = "ReviewAdditiveMultiple"
    LESSON_BUFF_ADDITIVE_FIX = "LessonBuffAdditiveFix"
    LESSON_BUFF_ADDITIVE_MULTIPLE = "LessonBuffAdditiveMultiple"
    PARAMETER_BUFF_MULTIPLE_PER_TURN = "ParameterBuffMultiplePerTurn"
    PARAMETER_DEBUFF = "ParameterDebuff"
    LESSON_DEBUFF = "LessonDebuff"
    ENTHUSIASTIC = "Enthusiastic"
    LESSON_PARAMETER_MULTIPLE = "LessonParameterMultiple"
    LESSON_PARAMETER_DOWN = "LessonParameterDown"
    LESSON_BUFF_MULTIPLE = "LessonBuffMultiple"
    BLOCK_RESTRICTION = "BlockRestriction"
    AGGRESSIVE = "Aggressive"
    BLOCK_ADD_DOWN = "BlockAddDown"
    BLOCK_ADD_DOWN_FIX = "BlockAddDownFix"
    STAMINA_CONSUMPTION_DOWN = "StaminaConsumptionDown"
    STAMINA_CONSUMPTION_ADD = "StaminaConsumptionAdd"
    STAMINA_CONSUMPTION_DOWN_FIX = "StaminaConsumptionDownFix"
    STAMINA_CONSUMPTION_ADD_FIX = "StaminaConsumptionAddFix"
    STAMINA_REDUCE_CHANGE = "StaminaReduceChange"
    STAMINA_CONSUMPTION_DOWN_ADD = "StaminaConsumptionDownAdd"
    STAMINA_CONSUMPTION_ADD_DOWN = "StaminaConsumptionAddDown"
    BUFF_CONSUMPTION_DOWN = "BuffConsumptionDown"
    BUFF_CONSUMPTION_ADD = "BuffConsumptionAdd"
    UPLIFTING = "Uplifting"
    ANTI_DEBUFF = "AntiDebuff"
    PLAYABLE_VALUE_ADD = "PlayableValueAdd"
    EXTRA_TURN = "ExtraTurn"
    FULL_POWER_POINT = "FullPowerPoint"
    CONCENTRATION_LESSON_MULTIPLE_ADDITIVE = "ConcentrationLessonMultipleAdditive"
    FULL_POWER_LESSON_MULTIPLE_ADDITIVE = "FullPowerLessonMultipleAdditive"
    ENTHUSIASTIC_MULTIPLE = "EnthusiasticMultiple"
    ENTHUSIASTIC_ADDITIVE = "EnthusiasticAdditive"
    REVIEW_MULTIPLE = "ReviewMultiple"
    REVIEW_ADDITIVE = "ReviewAdditive"
    LESSON_BUFF_ADDITIVE = "LessonBuffAdditive"
    PARAMETER_BUFF_ADDITIVE = "ParameterBuffAdditive"
    AGGRESSIVE_ADDITIVE = "AggressiveAdditive"
    FULL_POWER_POINT_ADDITIVE = "FullPowerPointAdditive"
    GROW_EFFECT_LESSON_ADD_ADDITIVE = "GrowEffectLessonAddAdditive"
    LESSON_VALUE_DEPEND_REVIEW_AGGRESSIVE = "LessonValueMultipleDependReviewOrAggressive"
    REVIEW_TURN_END_REDUCE_LOCK = "ReviewTurnEndReduceLock"
    PARAMETER_BUFF_TURN_END_REDUCE_LOCK = "ParameterBuffTurnEndReduceLock"
    STANCE_LOCK = "StanceLock"
    EXAM_CARD_VALUE = "ExamCardValue"
    PLAY_CARD_LIMIT_PLAYABLE_VALUE_ADD = "PlayCardLimitPlayableValueAdd"
    PLAY_COUNT_BUFF = "PlayCountBuff"
    SEARCH_PLAY_CARD_BUFF_CONSUMPTION_CHANGE = "SearchPlayCardBuffConsumptionChange"
    SEARCH_PLAY_CARD_STAMINA_CONSUMPTION_CHANGE = "SearchPlayCardStaminaConsumptionChange"
    HAND_HOLD = "HandHold"
    TIMER = "Timer"
    TRIGGER = "Trigger"
    ENCHANT = "Enchant"


@dataclass
class XorShift32:
    """ExamParameterModel PRNG state."""

    state: int

    def __post_init__(self) -> None:
        self.state &= UINT32_MASK

    def deep_copy(self) -> "XorShift32":
        return XorShift32(self.state)

    def next_u32(self) -> int:
        x = self.state
        x ^= (x << 13) & UINT32_MASK
        x ^= x >> 17
        x ^= (x << 5) & UINT32_MASK
        self.state = x & UINT32_MASK
        return self.state

    def next_int(self, minimum: int, maximum: int) -> int:
        if maximum <= minimum:
            raise ValueError("maximum must be greater than minimum")
        width = (maximum - minimum) & UINT32_MASK
        # GetRandomInt maps the current state first, then advances it.
        result = minimum + (((self.state & UINT32_MASK) * width) >> 32)
        self.next_u32()
        return int(result)


@dataclass
class StatusEffect:
    kind: str
    value: float = 0
    turn: int = 0
    turn_limited: bool = False
    uid: int = 0
    virtual_type: str = "base"
    count: int | None = None
    count_limited: bool = False
    limit_count_in_turn: int | None = None
    limit_count_in_turn_remain: int | None = None
    turn_count: int = 0
    phase_counts: dict[int, int] = field(default_factory=dict)
    int_value: int | None = None
    bool_value: bool | None = None
    is_passing_turn_start: bool = False
    custom_spend_turn: bool = False
    custom_clear_turn_state: bool = False

    @classmethod
    def exam_card_value_int(cls, value: int, count: int, turn: int, *, uid: int = 0, kind: str = StatusKind.EXAM_CARD_VALUE.value) -> "StatusEffect":
        return cls(
            kind=kind,
            value=int(value),
            turn=int(turn),
            turn_limited=int(turn) > 0,
            uid=uid,
            virtual_type="exam_card_value",
            count=int(count),
            count_limited=int(count) > 0,
            int_value=int(value),
        )

    @classmethod
    def exam_card_value_bool(cls, value: bool, count: int, turn: int, *, uid: int = 0, kind: str = StatusKind.EXAM_CARD_VALUE.value) -> "StatusEffect":
        return cls(
            kind=kind,
            value=1 if value else 0,
            turn=int(turn),
            turn_limited=int(turn) > 0,
            uid=uid,
            virtual_type="exam_card_value",
            count=int(count),
            count_limited=int(count) > 0,
            bool_value=bool(value),
        )

    @classmethod
    def play_card_limit(cls, limit_count: int, limit_count_in_turn: int, turn: int, *, uid: int = 0) -> "StatusEffect":
        return cls(
            kind=StatusKind.PLAY_CARD_LIMIT_PLAYABLE_VALUE_ADD.value,
            turn=int(turn),
            turn_limited=int(turn) >= 0,
            uid=uid,
            virtual_type="play_card_limit",
            count=int(limit_count),
            count_limited=int(limit_count) >= 0,
            limit_count_in_turn=int(limit_count_in_turn),
            limit_count_in_turn_remain=int(limit_count_in_turn),
        )

    @classmethod
    def trigger_effect(cls, turn: int, *, limit_count: int = -1, limit_count_in_turn: int = -1, uid: int = 0) -> "StatusEffect":
        return cls(
            kind=StatusKind.TRIGGER.value,
            turn=int(turn),
            turn_limited=int(turn) >= 0,
            uid=uid,
            virtual_type="trigger_effect",
            count=int(limit_count),
            count_limited=int(limit_count) >= 0,
            limit_count_in_turn=int(limit_count_in_turn),
            limit_count_in_turn_remain=int(limit_count_in_turn),
        )

    @classmethod
    def anti_debuff(cls, count: int, turn: int, *, uid: int = 0) -> "StatusEffect":
        return cls(
            kind=StatusKind.ANTI_DEBUFF.value,
            turn=int(turn),
            turn_limited=int(turn) >= 0,
            uid=uid,
            virtual_type="anti_debuff",
            count=int(count),
            count_limited=int(count) >= 0,
        )

    @classmethod
    def play_count_buff(cls, limit_count: int, play_count: int, turn: int, *, uid: int = 0) -> "StatusEffect":
        return cls(
            kind=StatusKind.PLAY_COUNT_BUFF.value,
            value=int(play_count),
            turn=int(turn),
            turn_limited=int(turn) >= 0,
            uid=uid,
            virtual_type="play_count_buff",
            count=int(limit_count),
            count_limited=int(limit_count) > 0,
        )

    @classmethod
    def playable_value_add(cls, count: int, *, uid: int = 0) -> "StatusEffect":
        return cls(
            kind=StatusKind.PLAYABLE_VALUE_ADD.value,
            turn=1,
            turn_limited=True,
            uid=uid,
            virtual_type="playable_value_add",
            count=int(count),
        )

    @classmethod
    def search_play_card_buff_consumption_change(cls, value: int, count: int, turn: int, *, uid: int = 0) -> "StatusEffect":
        return cls(
            kind=StatusKind.SEARCH_PLAY_CARD_BUFF_CONSUMPTION_CHANGE.value,
            value=int(value),
            turn=int(turn),
            turn_limited=int(turn) >= 0,
            uid=uid,
            virtual_type="search_play_card_buff_consumption_change",
            count=int(count),
        )

    @classmethod
    def search_play_card_stamina_consumption_change(cls, value: int, count: int, turn: int, *, uid: int = 0) -> "StatusEffect":
        return cls(
            kind=StatusKind.SEARCH_PLAY_CARD_STAMINA_CONSUMPTION_CHANGE.value,
            value=int(value),
            turn=int(turn),
            turn_limited=int(turn) >= 0,
            uid=uid,
            virtual_type="search_play_card_stamina_consumption_change",
            count=int(count),
        )

    def deep_copy(self) -> "StatusEffect":
        return StatusEffect(
            kind=self.kind,
            value=self.value,
            turn=self.turn,
            turn_limited=self.turn_limited,
            uid=self.uid,
            virtual_type=self.virtual_type,
            count=self.count,
            count_limited=self.count_limited,
            limit_count_in_turn=self.limit_count_in_turn,
            limit_count_in_turn_remain=self.limit_count_in_turn_remain,
            turn_count=self.turn_count,
            phase_counts=dict(self.phase_counts),
            int_value=self.int_value,
            bool_value=self.bool_value,
            is_passing_turn_start=self.is_passing_turn_start,
            custom_spend_turn=self.custom_spend_turn,
            custom_clear_turn_state=self.custom_clear_turn_state,
        )

    def spend_turn(self, context: "ExamEffectCalculateContext | None" = None) -> None:
        before = self.turn
        if self.custom_spend_turn:
            raise UnsupportedPath("ExamStatusEffectBase.SpendTurn", f"{self.kind} has an unsupported SpendTurn override")
        if self.virtual_type == "exam_card_value":
            self.turn -= 1
        elif self.turn_limited:
            self.turn -= 1
        if self.kind == StatusKind.REVIEW.value and before > self.turn and context is not None:
            context.parameter.review_consumption_sum_count += before - self.turn

    def clear_turn_state(self) -> None:
        if self.custom_clear_turn_state:
            raise UnsupportedPath("ExamStatusEffectBase.ClearTurnState", f"{self.kind} has an unsupported ClearTurnState override")
        if self.virtual_type == "play_card_limit":
            self.limit_count_in_turn_remain = self.limit_count_in_turn

    def spend_count(self) -> None:
        if self.virtual_type == "play_card_limit":
            if self.count is None:
                raise ValueError("count is not initialized")
            if self.count >= 0:
                self.count -= 1
            if self.limit_count_in_turn is not None and self.limit_count_in_turn >= 0:
                if self.limit_count_in_turn_remain is None:
                    raise ValueError("limit_count_in_turn_remain is not initialized")
                self.limit_count_in_turn_remain -= 1
            return
        if self.virtual_type in {
            "exam_card_value", "anti_debuff", "play_count_buff",
            "playable_value_add", "search_play_card_buff_consumption_change",
            "search_play_card_stamina_consumption_change",
        }:
            if self.count is None:
                raise ValueError("count is not initialized")
            self.count -= 1
            return
        if self.virtual_type == "trigger_effect":
            if self.count is not None and self.count >= 0:
                self.count -= 1
            if self.limit_count_in_turn is not None and self.limit_count_in_turn >= 0:
                if self.limit_count_in_turn_remain is None:
                    raise ValueError("limit_count_in_turn_remain is not initialized")
                self.limit_count_in_turn_remain -= 1
            return
        raise UnsupportedPath("IExamCountStatusEffect.SpendCount", f"{self.kind} count behavior is unsupported")

    def add_count(self, amount: int) -> None:
        amount = int(amount)
        if self.virtual_type == "trigger_effect":
            if self.count is not None and self.count >= 0:
                self.count += amount
            return
        if self.virtual_type == "play_card_limit":
            if self.count is not None and self.count >= 0:
                self.count += amount
            self.limit_count_in_turn_remain = self.limit_count_in_turn
            return
        if self.virtual_type in {
            "anti_debuff", "playable_value_add", "search_play_card_buff_consumption_change",
            "search_play_card_stamina_consumption_change",
        }:
            if self.count is None:
                raise ValueError("count is not initialized")
            self.count += amount
            return
        raise UnsupportedPath("IExamCountStatusEffect.AddCount", f"{self.kind} count-add behavior is unsupported")

    def increment_turn_count(self) -> None:
        if self.virtual_type != "trigger_effect":
            raise UnsupportedPath("TriggerEffectStatusEffect.IncrementTurnCount", f"{self.kind} is not a trigger effect")
        self.turn_count += 1
        self.limit_count_in_turn_remain = self.limit_count_in_turn

    def get_phase_count(self, phase_type: int) -> int:
        if self.virtual_type != "trigger_effect":
            raise UnsupportedPath("TriggerEffectStatusEffect.GetPhaseCount", f"{self.kind} is not a trigger effect")
        return int(self.phase_counts.get(int(phase_type), 0))

    def increment_phase_count(self, phase_type: int) -> None:
        if self.virtual_type != "trigger_effect":
            raise UnsupportedPath("TriggerEffectStatusEffect.IncrementPhaseCount", f"{self.kind} is not a trigger effect")
        k = int(phase_type)
        self.phase_counts[k] = self.phase_counts.get(k, 0) + 1

    def clear_phase_count(self, phase_type: int) -> None:
        if self.virtual_type != "trigger_effect":
            raise UnsupportedPath("TriggerEffectStatusEffect.ClearPhaseCount", f"{self.kind} is not a trigger effect")
        k = int(phase_type)
        if k in self.phase_counts:
            self.phase_counts[k] = 0

    @property
    def has_remaining_in_turn_count(self) -> bool:
        if self.virtual_type != "play_card_limit":
            raise UnsupportedPath("PlayCardLimitPlayableValueAddStatusEffect.HasRemainingInTurnCount", f"{self.kind} is not a play-card-limit status")
        remain = self.limit_count_in_turn_remain
        return remain == -1 or (remain is not None and remain > 0)

    @property
    def ended(self) -> bool:
        return self.turn_limited and self.turn <= 0


@dataclass
class ExamStatusEffectCollection:
    effects: list[StatusEffect] = field(default_factory=list)
    removed_effects: list[StatusEffect] = field(default_factory=list)
    effect_create_count: int = 0
    recently_use_effect_uid_list: list[int] = field(default_factory=list)
    idol_status_type: int = 0
    idol_status_step: int = 0

    def deep_copy(self) -> "ExamStatusEffectCollection":
        # ExamStatusEffectCollection.DeepCopy maps every active and
        # removed status through its own DeepCopy and copies bookkeeping lists.
        return ExamStatusEffectCollection(
            effects=[e.deep_copy() for e in self.effects],
            removed_effects=[e.deep_copy() for e in self.removed_effects],
            effect_create_count=self.effect_create_count,
            recently_use_effect_uid_list=list(self.recently_use_effect_uid_list),
            idol_status_type=self.idol_status_type,
            idol_status_step=self.idol_status_step,
        )

    def by_kind(self, kind: str | StatusKind) -> list[StatusEffect]:
        k = str(kind.value if isinstance(kind, StatusKind) else kind)
        return [e for e in self.effects if e.kind == k and not e.ended]

    def first(self, kind: str | StatusKind) -> StatusEffect | None:
        xs = self.by_kind(kind)
        return xs[0] if xs else None

    def has(self, kind: str | StatusKind) -> bool:
        return self.first(kind) is not None

    def value(self, kind: str | StatusKind, default: int = 0) -> int:
        e = self.first(kind)
        return default if e is None else int(e.value)

    def turn(self, kind: str | StatusKind, default: int = 0) -> int:
        e = self.first(kind)
        return default if e is None else int(e.turn)

    def total_value(self, kind: str | StatusKind) -> int:
        return int(sum(int(e.value) for e in self.by_kind(kind)))

    def total_float(self, kind: str | StatusKind) -> float:
        v = _f32(0.0)
        for e in self.by_kind(kind):
            v = _f32(v + _f32(float(e.value)))
        return v

    def ratio_multiple(self, kind: str | StatusKind) -> float:
        # multiple-status getters start from 1.0 and add value/1000 for each status.
        v = _f32(1.0)
        for e in self.by_kind(kind):
            v = _f32(v + _f32(_f32(float(e.value)) / _f32(1000.0)))
        return v

    def reduce_value(self, kind: str | StatusKind, amount: int) -> int:
        remaining=max(0,int(amount)); before=self.total_value(kind)
        for e in list(self.by_kind(kind)):
            if remaining <= 0: break
            take=min(max(0,int(e.value)),remaining)
            e.value=int(e.value)-take; remaining-=take
            if e.value <= 0 and not e.turn_limited:
                if e in self.effects:
                    self.effects.remove(e); self.removed_effects.append(e)
        return before-self.total_value(kind)

    def consume_turn(self, kind: str | StatusKind, amount: int) -> int:
        remaining=max(0,int(amount)); before=self.turn(kind)
        for e in list(self.by_kind(kind)):
            if remaining <= 0: break
            take=min(max(0,int(e.turn)),remaining); e.turn-=take; remaining-=take
            if e.turn <= 0 and e.turn_limited:
                if e in self.effects:
                    self.effects.remove(e); self.removed_effects.append(e)
        return before-self.turn(kind)

    def _next_uid(self) -> int:
        self.effect_create_count += 1
        return self.effect_create_count

    def _apply_additive(self, value: int, fix_kind: StatusKind, multiple_kind: StatusKind) -> int:
        fixed = int(value) + self.total_value(fix_kind)
        multiple = self.ratio_multiple(multiple_kind)
        return _ceil_f32(_f32(_f32(float(fixed)) * multiple))

    def add_parameter_buff(self, turn: int, context: "ExamEffectCalculateContext") -> bool:
        # TryAddParameterBuffStatus.  computes
        # ceil((turn + additiveFix) * additiveMultiple), then accumulates the
        # resulting turn on an existing turn-limited ParameterBuff status.
        turn = self._apply_additive(
            int(turn),
            StatusKind.PARAMETER_BUFF_ADDITIVE_FIX,
            StatusKind.PARAMETER_BUFF_ADDITIVE_MULTIPLE,
        )
        if context.is_enchant_trigger_active:
            raise UnsupportedPath(
                "ExamStatusEffectCollection.TryAddParameterBuffStatus",
                "enchant-trigger phase count update",
            )
        if turn < 0:
            raise UnsupportedPath(
                "ExamStatusEffectCollection.TryAddParameterBuffStatus",
                "negative turn input is unsupported",
            )
        e = self.first(StatusKind.PARAMETER_BUFF)
        if e is not None:
            if not e.turn_limited:
                raise UnsupportedPath(
                    "ExamStatusEffectCollection.TryAddParameterBuffStatus",
                    "existing ParameterBuff is not turn-limited",
                )
            e.turn += int(turn)
        else:
            self.effects.append(
                StatusEffect(
                    kind=StatusKind.PARAMETER_BUFF.value,
                    turn=int(turn),
                    turn_limited=True,
                    uid=self._next_uid(),
                )
            )
        return True

    def add_review(self, turn: int, context: "ExamEffectCalculateContext", is_fix: bool = False) -> bool:
        # TryAddReviewStatus has the same ceil(additive/multiple)
        # pattern and then accumulates _turn on an existing ReviewStatusEffect.
        if not is_fix:
            turn = self._apply_additive(
                int(turn),
                StatusKind.REVIEW_ADDITIVE_FIX,
                StatusKind.REVIEW_ADDITIVE_MULTIPLE,
            )
        if context.is_enchant_trigger_active:
            raise UnsupportedPath(
                "ExamStatusEffectCollection.TryAddReviewStatus",
                "enchant-trigger phase count update",
            )
        if turn < 0:
            raise UnsupportedPath(
                "ExamStatusEffectCollection.TryAddReviewStatus",
                "negative turn input is unsupported",
            )
        e = self.first(StatusKind.REVIEW)
        if e is not None:
            if not e.turn_limited:
                raise UnsupportedPath(
                    "ExamStatusEffectCollection.TryAddReviewStatus",
                    "existing Review is not turn-limited",
                )
            e.turn += int(turn)
        else:
            self.effects.append(
                StatusEffect(
                    kind=StatusKind.REVIEW.value,
                    turn=int(turn),
                    turn_limited=True,
                    uid=self._next_uid(),
                )
            )
        return True

    def add_lesson_buff(self, value: int, context: "ExamEffectCalculateContext", is_fix: bool = False) -> bool:
        # TryAddLessonBuffStatus: after optional additive/multiple
        # conversion it either adds to the existing status value or creates a
        # new status, clamping the accumulated value at >= 0.
        if not is_fix:
            value = self._apply_additive(
                int(value),
                StatusKind.LESSON_BUFF_ADDITIVE_FIX,
                StatusKind.LESSON_BUFF_ADDITIVE_MULTIPLE,
            )
        if context.is_enchant_trigger_active:
            raise UnsupportedPath(
                "ExamStatusEffectCollection.TryAddLessonBuffStatus",
                "enchant-trigger phase count update",
            )
        e = self.first(StatusKind.LESSON_BUFF)
        if e is not None:
            e.value = max(0, e.value + int(value))
        else:
            self.effects.append(
                StatusEffect(
                    kind=StatusKind.LESSON_BUFF.value,
                    value=max(0, int(value)),
                    uid=self._next_uid(),
                )
            )
        return True

    def spend_initial_turn(self, context: "ExamEffectCalculateContext") -> None:
        # uses a separate SpendInitialTurn on turn 1.  Its specialized
        # branches are not yet supported.  It is exactly safe as a no-op only when
        # there are no statuses to process.
        if self.effects:
            raise UnsupportedPath(
                "ExamStatusEffectCollection.SpendInitialTurn",
                "initial-turn status processing is unsupported; start with no statuses or start at MAIN",
            )

    def spend_turn(self, context: "ExamEffectCalculateContext") -> None:
        # Collection SpendTurn also handles timer/enchant/unique-status hooks.
        # Reject those, then the base status decrement is exact.
        complex_kinds = {
            StatusKind.TIMER.value,
            StatusKind.TRIGGER.value,
            StatusKind.ENCHANT.value,
        }
        bad = [e.kind for e in self.effects if e.kind in complex_kinds or e.custom_spend_turn]
        if bad:
            raise UnsupportedPath(
                "ExamStatusEffectCollection.SpendTurn",
                "complex status present: " + ", ".join(bad),
            )
        for e in list(self.effects):
            e.spend_turn(context)
            if e.ended:
                self.effects.remove(e)
                self.removed_effects.append(e)

    def clear_turn_state(self) -> None:
        for e in self.effects:
            e.clear_turn_state()

    def identity(self) -> tuple:
        return (
            tuple(
                (
                    e.kind, e.value, e.turn, e.turn_limited, e.uid, e.virtual_type, e.count,
                    e.count_limited, e.limit_count_in_turn, e.limit_count_in_turn_remain,
                    e.turn_count, tuple(sorted(e.phase_counts.items())), e.int_value, e.bool_value,
                    e.is_passing_turn_start, e.custom_spend_turn, e.custom_clear_turn_state,
                )
                for e in self.effects
            ),
            tuple((e.kind, e.value, e.turn, e.uid) for e in self.removed_effects),
            self.effect_create_count,
            tuple(self.recently_use_effect_uid_list),
            self.idol_status_type,
            self.idol_status_step,
        )


@dataclass
class ExamParameterModel:
    seed: int
    current_turn: int
    remain_turn: int
    stamina: int
    max_stamina: int
    judge_parameter: int = 0
    block: int = 0
    main_effect_type: int = 0
    phase: ExamPhase = ExamPhase.EXAM_STANDBY
    extra_turn: int = 0
    judge_parameter_vocal: int = 0
    judge_parameter_dance: int = 0
    judge_parameter_visual: int = 0
    turn_card_play_count: int = 0
    is_turn_card_grave: bool = False
    is_turn_card_lost: bool = False
    is_turn_card_play_end: bool = False
    current_turn_consume_stamina: int = 0
    review_consumption_sum_count: int = 0
    status_effects: ExamStatusEffectCollection = field(default_factory=ExamStatusEffectCollection)
    setting: ExamRuleSetting = field(default_factory=ExamRuleSetting)
    parameter_add_limit: int | None = None
    parameter_limit_ends_exam: bool = False
    rng: XorShift32 | None = None

    def __post_init__(self) -> None:
        if self.rng is None:
            self.rng = XorShift32(self.seed)
        self.stamina = max(0, min(self.stamina, self.max_stamina))

    def deep_copy(self) -> "ExamParameterModel":
        # ExamParameterModel.DeepCopy.
        return ExamParameterModel(
            seed=self.seed,
            current_turn=self.current_turn,
            remain_turn=self.remain_turn,
            stamina=self.stamina,
            max_stamina=self.max_stamina,
            judge_parameter=self.judge_parameter,
            block=self.block,
            main_effect_type=self.main_effect_type,
            phase=ExamPhase(int(self.phase)),
            extra_turn=self.extra_turn,
            judge_parameter_vocal=self.judge_parameter_vocal,
            judge_parameter_dance=self.judge_parameter_dance,
            judge_parameter_visual=self.judge_parameter_visual,
            turn_card_play_count=self.turn_card_play_count,
            is_turn_card_grave=self.is_turn_card_grave,
            is_turn_card_lost=self.is_turn_card_lost,
            is_turn_card_play_end=self.is_turn_card_play_end,
            current_turn_consume_stamina=self.current_turn_consume_stamina,
            review_consumption_sum_count=self.review_consumption_sum_count,
            status_effects=self.status_effects.deep_copy(),
            setting=ExamRuleSetting(dict(self.setting.values)),
            parameter_add_limit=self.parameter_add_limit,
            parameter_limit_ends_exam=self.parameter_limit_ends_exam,
            rng=self.rng.deep_copy() if self.rng else None,
        )

    def clear_turn_state(self, context: "ExamEffectCalculateContext") -> None:
        # ExamParameterModel.ClearTurnState explicitly clears these
        # flags/counter and calls StatusEffectCollection.ClearTurnState.
        self.is_turn_card_grave = False
        self.is_turn_card_lost = False
        self.is_turn_card_play_end = False
        self.turn_card_play_count = 0
        self.current_turn_consume_stamina = 0
        self.status_effects.clear_turn_state()
        # also calls ClearCountByPhaseType(25).  It affects specialized
        # phase-count statuses, which are not handled here.
        if any(e.kind in {StatusKind.TIMER.value, StatusKind.TRIGGER.value, StatusKind.ENCHANT.value}
               for e in self.status_effects.effects):
            raise UnsupportedPath(
                "ExamParameterModel.ClearTurnState",
                "ClearCountByPhaseType(25) required for a phase-count status",
            )

    def identity(self) -> tuple:
        return (
            int(self.phase), self.current_turn, self.remain_turn, self.stamina,
            self.max_stamina, self.judge_parameter, self.block,
            self.main_effect_type, self.extra_turn,
            self.judge_parameter_vocal, self.judge_parameter_dance,
            self.judge_parameter_visual, self.turn_card_play_count,
            self.is_turn_card_grave, self.is_turn_card_lost,
            self.is_turn_card_play_end, self.current_turn_consume_stamina,
            self.review_consumption_sum_count, self.parameter_add_limit, self.parameter_limit_ends_exam,
            self.rng.state if self.rng else None,
            tuple(sorted(self.setting.values.items())),
            self.status_effects.identity(),
        )


@dataclass
class ExamEffect:
    kind: str
    value: int = 0
    value2: int = 0
    turn: int = 0
    count: int = 1

    def deep_copy(self) -> "ExamEffect":
        return ExamEffect(self.kind, self.value, self.value2, self.turn, self.count)


@dataclass
class ExamCardData:
    produce_card_id: str
    guid: str
    effects: list[ExamEffect] = field(default_factory=list)
    stamina_cost: int = 0
    play_move_position: CardPosition | None = None
    reset_position: CardPosition | None = None
    play_limit: int | None = None
    play_count: int = 0
    fixed_deck_order: int = 0

    # Presence of any of these features reaches additional command
    # builders in ExecuteCardCommandImpl; they are explicit gates here.
    play_effect_triggers: tuple[Any, ...] = ()
    card_status_effects: tuple[Any, ...] = ()
    grow_effects: tuple[Any, ...] = ()
    enchant_effects: tuple[Any, ...] = ()
    phase_effects: tuple[Any, ...] = ()
    is_once_play_effect_list: bool = False
    support_upgrade_mutable: bool = False

    def deep_copy(self) -> "ExamCardData":
        return ExamCardData(
            produce_card_id=str(self.produce_card_id),
            guid=str(self.guid),
            effects=[e.deep_copy() for e in self.effects],
            stamina_cost=self.stamina_cost,
            play_move_position=self.play_move_position,
            reset_position=self.reset_position,
            play_limit=self.play_limit,
            play_count=self.play_count,
            fixed_deck_order=self.fixed_deck_order,
            play_effect_triggers=tuple(self.play_effect_triggers),
            card_status_effects=tuple(self.card_status_effects),
            grow_effects=tuple(self.grow_effects),
            enchant_effects=tuple(self.enchant_effects),
            phase_effects=tuple(self.phase_effects),
            is_once_play_effect_list=self.is_once_play_effect_list,
            support_upgrade_mutable=self.support_upgrade_mutable,
        )

    def guard_simple_play_path(self) -> None:
        unsupported = []
        for name, value in (
            ("play_effect_triggers", self.play_effect_triggers),
            ("card_status_effects", self.card_status_effects),
            ("grow_effects", self.grow_effects),
            ("enchant_effects", self.enchant_effects),
            ("phase_effects", self.phase_effects),
        ):
            if value:
                unsupported.append(name)
        if self.is_once_play_effect_list:
            unsupported.append("is_once_play_effect_list")
        if self.support_upgrade_mutable:
            unsupported.append("support_upgrade_mutable")
        if unsupported:
            raise UnsupportedPath(
                "ExamSequence.ExecuteCardCommandImpl",
                f"card {self.produce_card_id} reaches unsupported command path(s): "
                + ", ".join(unsupported),
            )

    def identity(self) -> tuple:
        return (
            self.produce_card_id,
            self.guid,
            tuple((e.kind, e.value, e.value2, e.turn, e.count) for e in self.effects),
            self.stamina_cost,
            self.play_move_position.value if self.play_move_position else None,
            self.reset_position.value if self.reset_position else None,
            self.play_limit,
            self.play_count,
            self.fixed_deck_order,
            bool(self.play_effect_triggers), bool(self.card_status_effects),
            bool(self.grow_effects), bool(self.enchant_effects), bool(self.phase_effects),
            self.is_once_play_effect_list, self.support_upgrade_mutable,
        )


@dataclass
class ExamCardPoolModel:
    cards: list[ExamCardData] = field(default_factory=list)

    def deep_copy(self) -> "ExamCardPoolModel":
        return ExamCardPoolModel([c.deep_copy() for c in self.cards])

    @property
    def is_fixed_order(self) -> bool:
        return any(int(c.fixed_deck_order) > 0 for c in self.cards)

    def shuffle(self, rng: XorShift32) -> None:
        if self.is_fixed_order:
            orders = [int(c.fixed_deck_order) for c in self.cards]
            if len(set(orders)) != len(orders):
                raise UnsupportedPath(
                    "ExamCardPoolModel.Shuffle",
                    "equal FixedDeckOrder values require the collection sort tie behavior",
                )
            self.cards.sort(key=lambda c: int(c.fixed_deck_order))
            return
        n = len(self.cards)
        while n >= 2:
            j = rng.next_int(0, n)
            self.cards[j], self.cards[n - 1] = self.cards[n - 1], self.cards[j]
            n -= 1

    def identity(self) -> tuple:
        return tuple(c.identity() for c in self.cards)


@dataclass
class ExamCardMoveController:
    hand: ExamCardPoolModel
    deck: ExamCardPoolModel
    grave: ExamCardPoolModel
    lost: ExamCardPoolModel
    hold: ExamCardPoolModel
    future_decks: list[ExamCardPoolModel] = field(default_factory=list)
    past_decks: list[ExamCardPoolModel] = field(default_factory=list)
    playing_card_guid: str | None = None

    def _pool(self, position: CardPosition) -> ExamCardPoolModel:
        return {
            CardPosition.HAND: self.hand,
            CardPosition.DECK: self.deck,
            CardPosition.GRAVE: self.grave,
            CardPosition.LOST: self.lost,
            CardPosition.HOLD: self.hold,
        }[position]

    def resolve_card(self, guid: str | None) -> ExamCardData | None:
        if guid is None:
            return None
        pools = [self.hand, self.deck, self.grave, self.lost, self.hold, *self.future_decks, *self.past_decks]
        for p in pools:
            for c in p.cards:
                if c.guid == guid:
                    return c
        return None

    @property
    def playing_card(self) -> ExamCardData | None:
        return self.resolve_card(self.playing_card_guid)

    def set_playing_card(self, card: ExamCardData | None) -> None:
        self.playing_card_guid = None if card is None else card.guid

    def use_hand(self, index: int) -> ExamCardData:
        # UseHand extracts the hand entry by the supplied index.
        if index < 0 or index >= len(self.hand.cards):
            raise IndexError(index)
        card = self.hand.cards.pop(index)
        self.set_playing_card(card)
        return card

    def shuffle_deck(self, context: "ExamEffectCalculateContext") -> None:
        self.deck.shuffle(context.parameter.rng)

    def draw_card(self, count: int, context: "ExamEffectCalculateContext", invoke_pool_events: bool = True) -> list[ExamCardData]:
        # DrawCard has recycle/future/past-deck branches.  The plain
        # branch enumerates deck indices from 0 upward.  Do not cross a recycle
        # boundary or special-deck branch in this strict subset.
        if count < 0:
            raise ValueError("count must be >= 0")
        if self.future_decks or self.past_decks:
            raise UnsupportedPath(
                "ExamCardMoveController.DrawCard",
                "future/past deck lists are non-empty",
            )
        if count > len(self.deck.cards):
            raise UnsupportedPath(
                "ExamCardMoveController.DrawCard",
                "draw requires ReplaceGraveToDeck / recycle",
            )
        out = []
        for _ in range(count):
            card = self.deck.cards.pop(0)
            self.hand.cards.append(card)
            out.append(card)
        return out

    def move_play_card(self, card: ExamCardData, context: "ExamEffectCalculateContext") -> None:
        # MovePlayCard reads card.PlayMovePositionType and routes via
        # AddCard. The target must be supplied explicitly; there is no fallback default.
        if card.play_move_position is None:
            raise UnsupportedPath(
                "ExamCardMoveController.MovePlayCard",
                f"card {card.produce_card_id} has no configured PlayMovePositionType",
            )
        self._pool(card.play_move_position).cards.append(card)
        if card.play_move_position == CardPosition.GRAVE:
            context.parameter.is_turn_card_grave = True
        if card.play_move_position == CardPosition.LOST:
            context.parameter.is_turn_card_lost = True
        self.set_playing_card(None)

    def reset_hand(self, context: "ExamEffectCalculateContext") -> None:
        # ResetHand starts by checking IsHandHold and processes each
        # card's reset destination.  We require that destination to be
        # supplied explicitly.
        if context.parameter.status_effects.has(StatusKind.HAND_HOLD):
            return
        while self.hand.cards:
            card = self.hand.cards.pop(0)
            if card.support_upgrade_mutable:
                raise UnsupportedPath(
                    "ExamCardMoveController.ResetHand",
                    f"card {card.produce_card_id} requires ResetSupportUpgrade semantics",
                )
            if card.reset_position is None:
                raise UnsupportedPath(
                    "ExamCardMoveController.ResetHand",
                    f"card {card.produce_card_id} has no explicit reset destination",
                )
            self._pool(card.reset_position).cards.append(card)

    def identity(self) -> tuple:
        return (
            self.hand.identity(), self.deck.identity(), self.grave.identity(),
            self.lost.identity(), self.hold.identity(),
            tuple(p.identity() for p in self.future_decks),
            tuple(p.identity() for p in self.past_decks),
            self.playing_card_guid,
        )


@dataclass
class ExamEffectCalculateContext:
    parameter: ExamParameterModel
    card_controller: ExamCardMoveController
    hand: ExamCardPoolModel
    deck: ExamCardPoolModel
    grave: ExamCardPoolModel
    lost: ExamCardPoolModel
    hold: ExamCardPoolModel

    playing_card_guid: str | None = None
    playing_effect: ExamEffect | None = None
    target_card_guids: list[str] = field(default_factory=list)
    is_enchant_trigger_active: bool = False
    used_status_uid_list: list[int] = field(default_factory=list)
    difference_data: list[dict[str, Any]] = field(default_factory=list)

    @classmethod
    def create(cls, sequence: "StrictExamSequence") -> "ExamEffectCalculateContext":
        # CreateEffectResolver -> ExamEffectCalculateContext.Create.
        # InitializeFromDataStore stores references to the sequence's mutable
        # models; it does not clone them.
        c = sequence.card_controller
        return cls(
            parameter=sequence.parameter,
            card_controller=c,
            hand=c.hand,
            deck=c.deck,
            grave=c.grave,
            lost=c.lost,
            hold=c.hold,
        )

    def reset(self) -> None:
        # Reset clears temporary playing/target state and the
        # per-effect difference list (returns pooled difference objects).
        self.playing_card_guid = None
        self.playing_effect = None
        self.target_card_guids.clear()
        self.is_enchant_trigger_active = False
        self.used_status_uid_list.clear()
        self.difference_data.clear()

    def log_diff(self, kind: str, before: Any, after: Any) -> None:
        self.difference_data.append({"kind": kind, "before": before, "after": after})


class ExamEffectUtility:
    """ExamEffectUtility calculation helpers."""

    @staticmethod
    def _status_int(s: ExamStatusEffectCollection, kind: StatusKind) -> int:
        return s.total_value(kind)

    @staticmethod
    def _status_turn(s: ExamStatusEffectCollection, kind: StatusKind) -> int:
        return s.turn(kind)

    @staticmethod
    def get_ratio_effect_int_value(value: int, permil: int, ceil_mode: bool) -> int:
        # ExamEffectUtility.GetRatioEffectIntValue.
        if value < 1:
            return 0
        ratio=_f32(_f32(float(int(permil))) / _f32(1000.0))
        x=_f32(ratio * _f32(float(int(value))))
        if ceil_mode:
            return _ceil_f32(_f32(x + _f32(0.0001)))
        return _floor_f32(_f32(x + _f32(-0.0001)))

    @staticmethod
    def calculate_adding_parameter(value: int, context: ExamEffectCalculateContext,
                                   modifier: ParameterCalculationModifier | None = None) -> int:
        # isBuffActive=true.
        p=context.parameter; s=p.status_effects; st=p.setting
        if s.has(StatusKind.SLUMP):
            return 0

        parameter_buff_multiple=_f32(1.0)
        if s.has(StatusKind.PARAMETER_BUFF):
            pb=_f32(_from_permil(st.get(37)) + _f32(-1.0))
            if s.has(StatusKind.PARAMETER_BUFF_MULTIPLE_PER_TURN):
                extra=_f32(_f32(float(s.turn(StatusKind.PARAMETER_BUFF))) * _from_permil(st.get(38)))
                pb=_f32(pb+extra)
            if modifier is not None:
                pb=_f32(pb * _f32(modifier.parameter_buff_multiple))
            parameter_buff_multiple=_f32(_f32(1.0)+pb)

        parameter_debuff_permil=1000
        if s.has(StatusKind.PARAMETER_DEBUFF):
            parameter_debuff_permil=st.get(36)
        parameter_debuff_multiple=_from_permil(parameter_debuff_permil)

        lesson_buff=s.total_value(StatusKind.LESSON_BUFF)
        lesson_debuff=s.total_value(StatusKind.LESSON_DEBUFF)
        enthusiastic=s.total_value(StatusKind.ENTHUSIASTIC)
        if modifier is not None:
            enthusiastic=_ceil_f32(_f32(_f32(modifier.enthusiastic_multiple)*_f32(float(enthusiastic))))

        lesson_multiple=s.ratio_multiple(StatusKind.LESSON_PARAMETER_MULTIPLE)
        lesson_down=s.ratio_multiple(StatusKind.LESSON_PARAMETER_DOWN)
        # The Down getter's neutral value is 1.0 only when the status exists;
        # absent branch feeds 0 into 1-x. Preserve that exact branch here.
        if not s.has(StatusKind.LESSON_PARAMETER_DOWN):
            lesson_down=_f32(0.0)
        down_factor=_f32(max(_f32(0.0), _f32(_f32(1.0)-lesson_down)))

        dep=_f32(0.0)
        if s.has(StatusKind.LESSON_VALUE_DEPEND_REVIEW_AGGRESSIVE):
            rv=max(s.total_value(StatusKind.REVIEW),s.total_value(StatusKind.AGGRESSIVE))
            dep=_f32(_f32(float(rv))*_from_permil(st.get(44)))
            dep=min(dep,_from_permil(st.get(45)))
            dep=_f32(dep)

        lesson_buff_multiple=s.ratio_multiple(StatusKind.LESSON_BUFF_MULTIPLE)
        if not s.has(StatusKind.LESSON_BUFF_MULTIPLE):
            lesson_buff_multiple=_f32(1.0)

        stance_multiple=_f32(1.0)
        t=s.idol_status_type; step=s.idol_status_step
        if t==1:
            slot=23 if step==1 else 24
            base=_f32(_from_permil(st.get(slot)) + _f32(-1.0))
            base=_f32(base + _f32(s.ratio_multiple(StatusKind.CONCENTRATION_LESSON_MULTIPLE_ADDITIVE)-_f32(1.0)))
            factor=_f32(modifier.concentration_multiple) if modifier else _f32(1.0)
            stance_multiple=_f32(_f32(1.0)+_f32(base*factor))
        elif t==2:
            stance_multiple=_from_permil(st.get(25 if step==1 else 26))
        elif t==3:
            base=_f32(_from_permil(st.get(9)) + _f32(-1.0))
            base=_f32(base + _f32(s.ratio_multiple(StatusKind.FULL_POWER_LESSON_MULTIPLE_ADDITIVE)-_f32(1.0)))
            factor=_f32(modifier.full_power_multiple) if modifier else _f32(1.0)
            stance_multiple=_f32(_f32(1.0)+_f32(base*factor))
        elif t==4:
            stance_multiple=_from_permil(st.get(20))

        # GetLessonChangeSpecify* return negative for "no override".
        # The strict model exposes optional aggregate override statuses only when supplied.
        adjusted=int(value)
        more=s.first('LessonChangeSpecifyMoreThan')
        if more is not None and int(more.value)>=0:
            adjusted=int(more.value)
        less=s.first('LessonChangeSpecifyLessThan')
        if less is not None and int(less.value)>=0:
            adjusted=int(less.value)

        base=max(0, _ceil_f32(_f32(lesson_buff_multiple*_f32(float(lesson_buff)))) - lesson_debuff + enthusiastic + adjusted)
        multiple=_f32(lesson_multiple + dep)
        result=_f32(_f32(_f32(_f32(stance_multiple*down_factor)*multiple)*parameter_debuff_multiple)*parameter_buff_multiple)
        result=_f32(result*_f32(float(base)))
        # adds 0.0001 and uses ceil, then clamps through long/int helpers.
        out=_ceil_f32(_f32(result+_f32(0.0001)))
        return min(0x7fffffff,max(0,int(out)))

    @staticmethod
    def add_parameter(value: int, context: ExamEffectCalculateContext) -> None:
        if context.parameter.status_effects.has(StatusKind.SLUMP): value=0
        ExamEffectUtility.add_parameter_fix(value,context)

    @staticmethod
    def add_parameter_fix(value: int, context: ExamEffectCalculateContext) -> None:
        p=context.parameter; before=p.judge_parameter
        after=before+int(value)
        if p.parameter_add_limit is not None: after=min(after,int(p.parameter_add_limit))
        p.judge_parameter=after; context.log_diff('Parameter',before,after)

    @staticmethod
    def calculate_add_block(value: int, context: ExamEffectCalculateContext, aggressive_multiple: float=1.0) -> int:
        # wrapper uses aggressive_multiple=1.0.
        if value < 1: return 0
        p=context.parameter; s=p.status_effects
        if s.has(StatusKind.BLOCK_RESTRICTION): return 0
        value=int(value)+_ceil_f32(_f32(_f32(float(s.total_value(StatusKind.AGGRESSIVE)))*_f32(aggressive_multiple)))
        if value < 1: return max(0,value)
        if s.has(StatusKind.BLOCK_ADD_DOWN):
            permil=1000-p.setting.get(4)
            value-=ExamEffectUtility.get_ratio_effect_int_value(value,permil,False)
        fix=s.total_value(StatusKind.BLOCK_ADD_DOWN_FIX)
        if fix>=1:
            value-=fix
        return max(0,int(value))

    @staticmethod
    def add_block_fix(value: int, context: ExamEffectCalculateContext) -> None:
        p=context.parameter; before=p.block; delta=max(-before,int(value)); p.block=before+delta
        context.log_diff('Block',before,p.block)

    @staticmethod
    def add_stamina_fix(value: int, context: ExamEffectCalculateContext) -> None:
        p=context.parameter; before=p.stamina; p.stamina=max(0,min(p.max_stamina,before+int(value)))
        context.log_diff('Stamina',before,p.stamina)

    @staticmethod
    def calculate_damage(value: int, penetrate: bool, apply_fixed: bool, context: ExamEffectCalculateContext) -> tuple[int,int]:
        # Return order is (staminaDamage, blockDamage).
        p=context.parameter; s=p.status_effects; st=p.setting
        block=0 if penetrate else p.block
        f=_f32(float(int(value)))
        t=s.idol_status_type; step=s.idol_status_step
        if t==1: f=_f32(f*_from_permil(st.get(27 if step==1 else 28)))
        elif t==2: f=_f32(f*_from_permil(st.get(31 if step==1 else 32)))
        elif t==4: f=_f32(f*_from_permil(st.get(21)))
        if s.has(StatusKind.STAMINA_CONSUMPTION_DOWN):
            slot=5 if s.has(StatusKind.STAMINA_CONSUMPTION_DOWN_ADD) else 0
            f=_f32(f*_from_permil(1000-st.get(slot)))
        if s.has(StatusKind.STAMINA_CONSUMPTION_ADD):
            slot=6 if s.has(StatusKind.STAMINA_CONSUMPTION_ADD_DOWN) else 1
            f=_f32(f*_from_permil(1000+st.get(slot)))
        damage=_ceil_f32(f)
        if apply_fixed:
            damage += max(0,s.total_value(StatusKind.STAMINA_CONSUMPTION_ADD_FIX))
            down=s.total_value(StatusKind.STAMINA_CONSUMPTION_DOWN_FIX)
            if down>=1: damage=max(0,damage-down)
            change_threshold=s.total_value(StatusKind.STAMINA_REDUCE_CHANGE)
            if damage <= change_threshold and change_threshold>=1:
                damage=st.get(7)
        stamina_damage=max(0,damage-block)
        block_damage=damage-stamina_damage
        return int(stamina_damage),int(block_damage)

    @staticmethod
    def damage_stamina(value: int, penetrate: bool, context: ExamEffectCalculateContext) -> None:
        # 0x7feefcc: CalculateDamage(..., applyFixed=true), SetBlock/SetStamina,
        # increment CurrentTurnConsumeStamina, then consume one Uplifting if stamina was hit.
        p=context.parameter; before_s=p.stamina; before_b=p.block
        sd,bd=ExamEffectUtility.calculate_damage(value,penetrate,True,context)
        if bd>=1: p.block=max(0,p.block-bd)
        if sd>=1:
            p.stamina=max(0,min(p.max_stamina,p.stamina-sd))
            p.current_turn_consume_stamina += before_s-p.stamina
        if sd>=1 and p.status_effects.total_value(StatusKind.UPLIFTING)>=1:
            p.status_effects.reduce_value(StatusKind.UPLIFTING,1)
        if bd and sd: context.log_diff('StaminaBlockMixDamage',(before_s,before_b),(p.stamina,p.block))
        elif sd: context.log_diff('Stamina',before_s,p.stamina)
        elif bd: context.log_diff('Block',before_b,p.block)

    @staticmethod
    def calculate_buff_cost(value: int, context: ExamEffectCalculateContext) -> int:
        p=context.parameter; s=p.status_effects; f=_f32(float(int(value)))
        if s.has(StatusKind.BUFF_CONSUMPTION_DOWN): f=_f32(f*_from_permil(1000-p.setting.get(2)))
        if s.has(StatusKind.BUFF_CONSUMPTION_ADD): f=_f32(f*_from_permil(1000+p.setting.get(3)))
        return _ceil_f32(f)

    @staticmethod
    def get_cost_buff_value(cost_type: int, context: ExamEffectCalculateContext) -> int:
        s=context.parameter.status_effects
        return {1:s.total_value(StatusKind.LESSON_BUFF),2:s.total_value(StatusKind.REVIEW),
                3:s.total_value(StatusKind.AGGRESSIVE),4:s.turn(StatusKind.PARAMETER_BUFF),
                5:s.total_value(StatusKind.FULL_POWER_POINT),
                6:s.turn(StatusKind.PARAMETER_BUFF_MULTIPLE_PER_TURN)}.get(int(cost_type),0)

    @staticmethod
    def consume_buff_cost(cost_type: int, value: int, context: ExamEffectCalculateContext) -> None:
        cost=ExamEffectUtility.calculate_buff_cost(value,context); s=context.parameter.status_effects
        ct=int(cost_type); before=ExamEffectUtility.get_cost_buff_value(ct,context)
        if ct==1: s.reduce_value(StatusKind.LESSON_BUFF,cost)
        elif ct==2: s.reduce_value(StatusKind.REVIEW,cost)
        elif ct==3: s.reduce_value(StatusKind.AGGRESSIVE,cost)
        elif ct==4: s.consume_turn(StatusKind.PARAMETER_BUFF,cost)
        elif ct==5: s.reduce_value(StatusKind.FULL_POWER_POINT,cost)
        elif ct==6: s.consume_turn(StatusKind.PARAMETER_BUFF_MULTIPLE_PER_TURN,cost)
        after=ExamEffectUtility.get_cost_buff_value(ct,context)
        if before!=after: context.log_diff('BuffCost',before,after)

    @staticmethod
    def consume_stamina_cost(value: int, context: ExamEffectCalculateContext, penetrate: bool=False) -> None:
        if value<=0:return
        ExamEffectUtility.damage_stamina(value,penetrate,context)


class ExamEffectResolver:
    """Executor dispatcher following the game's effect->executor architecture."""

    def __init__(self, context: ExamEffectCalculateContext):
        self.context = context

    def execute(self, effect: ExamEffect) -> None:
        self.context.playing_effect = effect
        try:
            fn = {
                EffectKind.LESSON.value: self._lesson,
                EffectKind.LESSON_FIX.value: self._lesson_fix,
                EffectKind.BLOCK.value: self._block,
                EffectKind.DRAW.value: self._draw,
                EffectKind.EXTRA_TURN.value: self._extra_turn,
                EffectKind.PARAMETER_BUFF.value: self._parameter_buff,
                EffectKind.REVIEW.value: self._review,
                EffectKind.LESSON_BUFF.value: self._lesson_buff,
            }.get(effect.kind)
            if fn is None:
                raise UnsupportedPath(
                    "ExamEffectUtility.CreateExecutor/AffectEffect",
                    f"effect executor is unsupported: {effect.kind}",
                )
            fn(effect)
        finally:
            self.context.playing_effect = None

    def _lesson(self, effect: ExamEffect) -> None:
        # LessonEffectExecutor.ExecuteEffect loops count times.
        if effect.count < 1:
            return
        for _ in range(effect.count):
            v = ExamEffectUtility.calculate_adding_parameter(effect.value, self.context)
            ExamEffectUtility.add_parameter(v, self.context)

    def _lesson_fix(self, effect: ExamEffect) -> None:
        # LessonFixEffectExecutor follows AddParameterFix and performs a fixed addition.
        if effect.count not in (0, 1):
            raise UnsupportedPath(
                "LessonFixEffectExecutor.ExecuteEffect", "counted LessonFix variant"
            )
        ExamEffectUtility.add_parameter_fix(effect.value, self.context)

    def _block(self, effect: ExamEffect) -> None:
        # BlockEffectExecutor.
        v = ExamEffectUtility.calculate_add_block(effect.value, self.context)
        ExamEffectUtility.add_block_fix(v, self.context)

    def _draw(self, effect: ExamEffect) -> None:
        # DrawEffectExecutor delegates to CardController.DrawCard(value,...).
        if effect.count not in (0, 1):
            raise UnsupportedPath("DrawEffectExecutor.ExecuteEffect", "counted draw")
        self.context.card_controller.draw_card(effect.value, self.context, True)

    def _extra_turn(self, effect: ExamEffect) -> None:
        # ExtraTurnEffectExecutor increments both RemainTurn and
        # ExtraTurn by 1.  It has no data fields.
        if effect.value not in (0, 1) or effect.count not in (0, 1):
            raise UnsupportedPath(
                "ExtraTurnEffectExecutor.ExecuteEffect",
                "ExtraTurn executor has no value/count field in type",
            )
        p = self.context.parameter
        before = (p.remain_turn, p.extra_turn)
        p.remain_turn += 1
        p.extra_turn += 1
        self.context.log_diff("ExtraTurn", before, (p.remain_turn, p.extra_turn))

    def _parameter_buff(self, effect: ExamEffect) -> None:
        # ParameterBuffEffectExecutor snapshots turn, calls
        # TryAddParameterBuffStatus(_turn), then snapshots again.
        turn = effect.turn if effect.turn else effect.value
        self.context.parameter.status_effects.add_parameter_buff(turn, self.context)

    def _review(self, effect: ExamEffect) -> None:
        # ReviewEffectExecutor -> TryAddReviewStatus(_value).
        self.context.parameter.status_effects.add_review(effect.value, self.context)

    def _lesson_buff(self, effect: ExamEffect) -> None:
        # LessonBuffEffectExecutor -> TryAddLessonBuffStatus(_value).
        self.context.parameter.status_effects.add_lesson_buff(effect.value, self.context)


@dataclass
class ExamSaveData:
    parameter: ExamParameterModel
    hand: ExamCardPoolModel
    deck: ExamCardPoolModel
    grave: ExamCardPoolModel
    lost: ExamCardPoolModel
    hold: ExamCardPoolModel
    future_decks: list[ExamCardPoolModel]
    past_decks: list[ExamCardPoolModel]
    card_uses_remaining: int
    turn_end_logs: tuple[dict[str, Any], ...]


@dataclass
class StrictExamSequence:
    parameter: ExamParameterModel
    hand: ExamCardPoolModel
    deck: ExamCardPoolModel
    grave: ExamCardPoolModel = field(default_factory=ExamCardPoolModel)
    lost: ExamCardPoolModel = field(default_factory=ExamCardPoolModel)
    hold: ExamCardPoolModel = field(default_factory=ExamCardPoolModel)
    future_decks: list[ExamCardPoolModel] = field(default_factory=list)
    past_decks: list[ExamCardPoolModel] = field(default_factory=list)
    base_card_uses_per_turn: int = 1
    draw_count_per_turn: int = 3
    card_uses_remaining: int = 0
    phase_trigger_count: int = 0
    gimmick_present: bool = False
    command_stack_requires_async: bool = False
    _turn_end_logs: list[dict[str, Any]] = field(default_factory=list)
    card_controller: ExamCardMoveController = field(init=False)

    def __post_init__(self) -> None:
        self._rebuild_card_controller()

    def _rebuild_card_controller(self) -> None:
        # ExamSequence.DeepCopy creates a new ExamCardMoveController from
        # the copied pool models rather than copying the controller itself.
        self.card_controller = ExamCardMoveController(
            hand=self.hand,
            deck=self.deck,
            grave=self.grave,
            lost=self.lost,
            hold=self.hold,
            future_decks=self.future_decks,
            past_decks=self.past_decks,
        )

    # ---- Protocol properties used by Contest DFS ----
    @property
    def phase(self) -> int:
        return int(self.parameter.phase)

    @property
    def current_turn(self) -> int:
        return self.parameter.current_turn

    @property
    def remain_turn(self) -> int:
        return self.parameter.remain_turn

    @property
    def main_effect_type(self) -> int:
        return self.parameter.main_effect_type

    @property
    def judge_parameter(self) -> int:
        return self.parameter.judge_parameter

    @property
    def judge_parameter_vocal(self) -> int:
        return self.parameter.judge_parameter_vocal

    @property
    def judge_parameter_dance(self) -> int:
        return self.parameter.judge_parameter_dance

    @property
    def judge_parameter_visual(self) -> int:
        return self.parameter.judge_parameter_visual

    def create_effect_resolver(self) -> ExamEffectResolver:
        return ExamEffectResolver(ExamEffectCalculateContext.create(self))

    def deep_copy(self) -> "StrictExamSequence":
        # ExamSequence.DeepCopy:
        # Parameter/Gimmick/pools are copied, future/past lists are copied, then
        # the controller and playing-card references are rebuilt/rebound.
        p = self.parameter.deep_copy()
        hand = self.hand.deep_copy()
        deck = self.deck.deep_copy()
        grave = self.grave.deep_copy()
        lost = self.lost.deep_copy()
        hold = self.hold.deep_copy()
        future = [x.deep_copy() for x in self.future_decks]
        past = [x.deep_copy() for x in self.past_decks]
        out = StrictExamSequence(
            parameter=p,
            hand=hand,
            deck=deck,
            grave=grave,
            lost=lost,
            hold=hold,
            future_decks=future,
            past_decks=past,
            base_card_uses_per_turn=self.base_card_uses_per_turn,
            draw_count_per_turn=self.draw_count_per_turn,
            card_uses_remaining=self.card_uses_remaining,
            phase_trigger_count=self.phase_trigger_count,
            gimmick_present=self.gimmick_present,
            command_stack_requires_async=self.command_stack_requires_async,
            _turn_end_logs=[dict(x) for x in self._turn_end_logs],
        )
        # SyncPlayingCard: resolve copied playing card by GUID.
        out.card_controller.playing_card_guid = self.card_controller.playing_card_guid
        if out.card_controller.playing_card_guid is not None and out.card_controller.playing_card is None:
            raise UnsupportedPath(
                "ExamSequence.SyncPlayingCard",
                "copied PlayingCard GUID could not be rebound",
            )
        return out

    # Alias expected by the DFS protocol.
    clone = deep_copy

    def save_data(self) -> ExamSaveData:
        c = self.deep_copy()
        return ExamSaveData(
            parameter=c.parameter,
            hand=c.hand,
            deck=c.deck,
            grave=c.grave,
            lost=c.lost,
            hold=c.hold,
            future_decks=c.future_decks,
            past_decks=c.past_decks,
            card_uses_remaining=c.card_uses_remaining,
            turn_end_logs=tuple(dict(x) for x in c._turn_end_logs),
        )

    def restore_data(self, save_data: ExamSaveData) -> None:
        self.parameter = save_data.parameter.deep_copy()
        self.hand = save_data.hand.deep_copy()
        self.deck = save_data.deck.deep_copy()
        self.grave = save_data.grave.deep_copy()
        self.lost = save_data.lost.deep_copy()
        self.hold = save_data.hold.deep_copy()
        self.future_decks = [x.deep_copy() for x in save_data.future_decks]
        self.past_decks = [x.deep_copy() for x in save_data.past_decks]
        self.card_uses_remaining = save_data.card_uses_remaining
        self._turn_end_logs = [dict(x) for x in save_data.turn_end_logs]
        self._rebuild_card_controller()

    def _guard_simple_phase_machine(self) -> None:
        if self.phase_trigger_count:
            raise UnsupportedPath(
                "ExamSequence.ExamLoopTaskAsync",
                "phase-trigger command list is non-empty",
            )
        if self.gimmick_present:
            raise UnsupportedPath(
                "ExamSequence.ExamLoopTaskAsync", "gimmick processing is present"
            )
        if self.command_stack_requires_async:
            raise UnsupportedPath(
                "ExamSequence.ExamLoopTaskAsync", "async command stack path required"
            )

    def is_end_exam(self) -> bool:
        # ExamSequence.IsEndExam also checks parameter-limit end.
        if self.parameter.parameter_limit_ends_exam:
            if self.parameter.parameter_add_limit is None:
                raise UnsupportedPath(
                    "ExamSequence.IsParameterLimitEndExam",
                    "parameter limit end enabled without explicit limit",
                )
            if self.parameter.judge_parameter >= self.parameter.parameter_add_limit:
                return True
        return self.parameter.remain_turn < 1

    def _start_next_turn(self) -> None:
        self._guard_simple_phase_machine()
        p = self.parameter
        context = ExamEffectCalculateContext.create(self)

        # ExamLoopTaskAsync: if CurrentTurn >= 1, RemainTurn--.
        if p.current_turn >= 1:
            p.remain_turn -= 1

        if self.is_end_exam():
            p.phase = ExamPhase.EXAM_END
            self.card_uses_remaining = 0
            return

        #..0x8070afc: CurrentTurn++.
        p.current_turn += 1

        # First turn uses SpendInitialTurn; turn >= 2 uses SpendTurn.
        if p.current_turn >= 2:
            p.status_effects.spend_turn(context)
        else:
            p.status_effects.spend_initial_turn(context)

        # In the full game, phase commands surround drawing.  In the guarded
        # no-trigger/no-gimmick domain their only state-changing card-pool action
        # is the ordinary draw.
        p.phase = ExamPhase.TURN_START_DRAW
        self.card_controller.draw_card(self.draw_count_per_turn, context, True)
        self.card_uses_remaining = self.base_card_uses_per_turn
        p.phase = ExamPhase.MAIN
        context.reset()

    def _finish_turn(self) -> None:
        self._guard_simple_phase_machine()
        p = self.parameter
        context = ExamEffectCalculateContext.create(self)
        p.phase = ExamPhase.TURN_END

        # The ResetHand path requires per-card reset destinations.
        self.card_controller.reset_hand(context)

        self._turn_end_logs.append(
            {
                "turn": p.current_turn,
                "parameter": p.judge_parameter,
                "stamina": p.stamina,
                "block": p.block,
                "remainTurn": p.remain_turn,
            }
        )

        # ExamLoopTaskAsync later calls Parameter.ClearTurnState and clears
        # EffectCalculateContext difference data.
        p.clear_turn_state(context)
        context.reset()

    def advance_until_main_phase_or_end(self) -> None:
        # DFS invokes this before each branch.  MAIN/END are already branch
        # boundaries; TURN_END/STANDBY advance deterministically.
        while self.parameter.phase not in (ExamPhase.MAIN, ExamPhase.EXAM_END):
            if self.parameter.phase in (
                ExamPhase.EXAM_STANDBY,
                ExamPhase.TURN_END,
                ExamPhase.NONE,
            ):
                self._start_next_turn()
            else:
                raise UnsupportedPath(
                    "ExamSequence.ExamLoopTaskAsync",
                    f"resume from phase {self.parameter.phase.name} requires queued phase commands",
                )

    def _is_card_usable_strict(self, card: ExamCardData) -> bool:
        if self.card_uses_remaining <= 0:
            return False
        if card.play_limit is not None and card.play_count >= card.play_limit:
            return False
        card.guard_simple_play_path()
        # ValidateCardCost has many status-dependent branches.  Neutral-domain
        # cost validation is exact: a positive cost needs enough stamina when no
        # Block/status cost effects are present.  If such effects are present,
        # explicitly stop instead of deciding usability incorrectly.
        if card.stamina_cost > 0:
            p = self.parameter
            s = p.status_effects
            if p.block or s.idol_status_type or any(
                e.kind in ExamEffectUtility.STAMINA_MODIFIER_KINDS for e in s.effects
            ):
                raise UnsupportedPath(
                    "ExamCardUtility.ValidateCardCost",
                    f"card {card.produce_card_id} uses non-neutral stamina-cost validation",
                )
            if p.stamina < card.stamina_cost:
                return False
        return True

    def selectable_command_indices(self) -> Sequence[int]:
        if self.parameter.phase != ExamPhase.MAIN:
            return ()
        out = []
        for i, card in enumerate(self.hand.cards):
            if self._is_card_usable_strict(card):
                out.append(i)
        return tuple(out)

    def execute_command(self, select_index: int) -> str | None:
        if self.parameter.phase != ExamPhase.MAIN:
            raise RuntimeError("execute_command is only valid at MAIN phase")
        if select_index == -1:
            self._finish_turn()
            return None
        if select_index < 0 or select_index >= len(self.hand.cards):
            raise IndexError(select_index)
        if not self._is_card_usable_strict(self.hand.cards[select_index]):
            raise ValueError(f"hand index {select_index} is not playable")

        # Reduced equivalent of ExecuteCardCommandImpl for the explicitly
        # guarded no-trigger/no-enchant/no-grow path.
        card = self.card_controller.use_hand(select_index)
        card.guard_simple_play_path()
        context = ExamEffectCalculateContext.create(self)
        context.playing_card_guid = card.guid
        context.card_controller.set_playing_card(card)

        # ConsumeCardCost -> DamageStamina in the neutral branch.
        ExamEffectUtility.consume_stamina_cost(card.stamina_cost, context)

        resolver = ExamEffectResolver(context)
        for effect in card.effects:
            resolver.execute(effect)

        # ExecuteCardCommandImpl invokes card.PlayCardCount before MovePlayCard.
        card.play_count += 1
        self.parameter.turn_card_play_count += 1
        self.card_uses_remaining -= 1

        self.card_controller.move_play_card(card, context)
        context.reset()

        if self.card_uses_remaining <= 0:
            self.parameter.is_turn_card_play_end = True
            self._finish_turn()

        return str(card.produce_card_id)

    def turn_end_logs(self) -> Sequence[object]:
        return tuple(dict(x) for x in self._turn_end_logs)

    def branch_identity(self) -> Hashable:
        return (
            self.parameter.identity(),
            self.card_controller.identity(),
            self.base_card_uses_per_turn,
            self.draw_count_per_turn,
            self.card_uses_remaining,
            self.phase_trigger_count,
            self.gimmick_present,
            self.command_stack_requires_async,
            tuple(tuple(sorted(x.items())) for x in self._turn_end_logs),
        )


def card(
    card_id: str,
    guid: str,
    effects: Iterable[ExamEffect],
    *,
    stamina_cost: int = 0,
    play_move_position: CardPosition = CardPosition.GRAVE,
    reset_position: CardPosition = CardPosition.GRAVE,
    fixed_deck_order: int = 0,
) -> ExamCardData:
    """Convenience constructor for tests and fixtures."""
    return ExamCardData(
        produce_card_id=str(card_id),
        guid=guid,
        effects=list(effects),
        stamina_cost=stamina_cost,
        play_move_position=play_move_position,
        reset_position=reset_position,
        fixed_deck_order=int(fixed_deck_order),
    )

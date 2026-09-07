import unittest

from exam_engine import (
    CardPosition,
    ExamCardMoveController,
    ExamCardPoolModel,
    ExamEffectCalculateContext,
    ExamParameterModel,
    ExamPhase,
    ExamStatusEffectCollection,
    StatusEffect,
    StatusKind,
    StrictExamSequence,
    UnsupportedPath,
    XorShift32,
    card,
)


def make_sequence(*, seed=0x12345678, statuses=None, hand=None, deck=None):
    parameter = ExamParameterModel(
        seed=seed,
        current_turn=1,
        remain_turn=10,
        stamina=100,
        max_stamina=100,
        phase=ExamPhase.MAIN,
        status_effects=ExamStatusEffectCollection(list(statuses or [])),
    )
    return StrictExamSequence(
        parameter=parameter,
        hand=ExamCardPoolModel(list(hand or [])),
        deck=ExamCardPoolModel(list(deck or [])),
    )


class RandomTests(unittest.TestCase):
    def test_xorshift_vector(self):
        rng = XorShift32(0x12345678)
        self.assertEqual(rng.next_u32(), 0x87985AA5)
        self.assertEqual(rng.next_u32(), 0x155B24A3)
        self.assertEqual(rng.next_u32(), 0x4820F4C4)

    def test_range_uses_current_state_before_advance(self):
        rng = XorShift32(0x80000000)
        self.assertEqual(rng.next_int(0, 10), 5)
        self.assertNotEqual(rng.state, 0x80000000)

    def test_seeded_shuffle_vector(self):
        cards = [card(x, x, []) for x in "ABCDEFGH"]
        pool = ExamCardPoolModel(cards)
        rng = XorShift32(0x12345678)
        pool.shuffle(rng)
        self.assertEqual([c.produce_card_id for c in pool.cards], list("GFECBHDA"))
        self.assertEqual(rng.state, 0x89CA4F1D)

    def test_same_seed_repeats_order(self):
        def shuffled():
            pool = ExamCardPoolModel([card(str(i), str(i), []) for i in range(20)])
            pool.shuffle(XorShift32(20260907))
            return [c.produce_card_id for c in pool.cards]
        self.assertEqual(shuffled(), shuffled())

    def test_fixed_deck_order_does_not_consume_rng(self):
        pool = ExamCardPoolModel([
            card("c", "c", [], fixed_deck_order=3),
            card("a", "a", [], fixed_deck_order=1),
            card("b", "b", [], fixed_deck_order=2),
        ])
        rng = XorShift32(1234)
        pool.shuffle(rng)
        self.assertEqual([c.produce_card_id for c in pool.cards], ["a", "b", "c"])
        self.assertEqual(rng.state, 1234)

    def test_fixed_order_equal_key_is_explicitly_unsupported(self):
        pool = ExamCardPoolModel([
            card("a", "a", [], fixed_deck_order=1),
            card("b", "b", [], fixed_deck_order=1),
        ])
        with self.assertRaises(UnsupportedPath):
            pool.shuffle(XorShift32(1))


class StatusVirtualTests(unittest.TestCase):
    def test_review_spend_turn_tracks_consumption(self):
        review = StatusEffect(kind=StatusKind.REVIEW.value, turn=3, turn_limited=True)
        seq = make_sequence(statuses=[review])
        context = ExamEffectCalculateContext.create(seq)
        review.spend_turn(context)
        self.assertEqual(review.turn, 2)
        self.assertEqual(seq.parameter.review_consumption_sum_count, 1)

    def test_exam_card_value_virtual_methods(self):
        effect = StatusEffect.exam_card_value_int(7, count=2, turn=3)
        effect.spend_turn()
        effect.spend_count()
        effect.clear_turn_state()
        self.assertEqual(effect.turn, 2)
        self.assertEqual(effect.count, 1)
        self.assertEqual(effect.int_value, 7)

    def test_play_card_limit_per_turn_reset_and_unlimited(self):
        effect = StatusEffect.play_card_limit(limit_count=4, limit_count_in_turn=2, turn=3)
        self.assertTrue(effect.has_remaining_in_turn_count)
        effect.spend_count()
        self.assertEqual((effect.count, effect.limit_count_in_turn_remain), (3, 1))
        effect.spend_count()
        self.assertFalse(effect.has_remaining_in_turn_count)
        effect.clear_turn_state()
        self.assertEqual(effect.limit_count_in_turn_remain, 2)

        unlimited = StatusEffect.play_card_limit(limit_count=-1, limit_count_in_turn=-1, turn=3)
        unlimited.spend_count()
        self.assertEqual(unlimited.count, -1)
        self.assertEqual(unlimited.limit_count_in_turn_remain, -1)
        self.assertTrue(unlimited.has_remaining_in_turn_count)

    def test_confirmed_count_status_methods(self):
        anti = StatusEffect.anti_debuff(count=2, turn=3)
        anti.spend_count()
        anti.add_count(4)
        self.assertEqual(anti.count, 5)

        play_count = StatusEffect.play_count_buff(limit_count=3, play_count=2, turn=4)
        play_count.spend_count()
        self.assertEqual(play_count.count, 2)
        self.assertEqual(play_count.value, 2)

        playable = StatusEffect.playable_value_add(count=3)
        self.assertEqual((playable.turn, playable.turn_limited), (1, True))
        playable.spend_count()
        playable.add_count(2)
        self.assertEqual(playable.count, 4)

        buff_change = StatusEffect.search_play_card_buff_consumption_change(7, 3, 4)
        buff_change.spend_count()
        buff_change.add_count(5)
        self.assertEqual((buff_change.value, buff_change.count), (7, 7))

        stamina_change = StatusEffect.search_play_card_stamina_consumption_change(-2, 4, 5)
        stamina_change.spend_count()
        stamina_change.add_count(3)
        self.assertEqual((stamina_change.value, stamina_change.count), (-2, 6))

    def test_trigger_virtual_counters(self):
        trigger = StatusEffect.trigger_effect(turn=5, limit_count=3, limit_count_in_turn=2)
        trigger.increment_turn_count()
        self.assertEqual(trigger.turn_count, 1)
        self.assertEqual(trigger.limit_count_in_turn_remain, 2)
        trigger.spend_count()
        self.assertEqual((trigger.count, trigger.limit_count_in_turn_remain), (2, 1))
        trigger.increment_phase_count(50)
        trigger.increment_phase_count(50)
        self.assertEqual(trigger.get_phase_count(50), 2)
        trigger.clear_phase_count(50)
        self.assertEqual(trigger.get_phase_count(50), 0)
        trigger.add_count(4)
        self.assertEqual(trigger.count, 6)

    def test_status_deep_copy_keeps_virtual_state_independent(self):
        trigger = StatusEffect.trigger_effect(turn=5, limit_count=3, limit_count_in_turn=2)
        trigger.phase_counts[50] = 4
        copied = trigger.deep_copy()
        copied.phase_counts[50] = 8
        copied.count = 1
        self.assertEqual(trigger.phase_counts[50], 4)
        self.assertEqual(trigger.count, 3)


class AdditiveStatusTests(unittest.TestCase):
    def _context(self, effects):
        seq = make_sequence(statuses=effects)
        return seq, ExamEffectCalculateContext.create(seq)

    def test_parameter_buff_additive_fix_and_multiple(self):
        seq, context = self._context([
            StatusEffect(StatusKind.PARAMETER_BUFF_ADDITIVE_FIX.value, value=2),
            StatusEffect(StatusKind.PARAMETER_BUFF_ADDITIVE_MULTIPLE.value, value=500),
        ])
        seq.parameter.status_effects.add_parameter_buff(3, context)
        self.assertEqual(seq.parameter.status_effects.turn(StatusKind.PARAMETER_BUFF), 8)

    def test_review_fix_skips_additive_conversion(self):
        seq, context = self._context([
            StatusEffect(StatusKind.REVIEW_ADDITIVE_FIX.value, value=10),
            StatusEffect(StatusKind.REVIEW_ADDITIVE_MULTIPLE.value, value=1000),
        ])
        seq.parameter.status_effects.add_review(3, context, is_fix=True)
        self.assertEqual(seq.parameter.status_effects.turn(StatusKind.REVIEW), 3)

    def test_lesson_buff_additive_conversion(self):
        seq, context = self._context([
            StatusEffect(StatusKind.LESSON_BUFF_ADDITIVE_FIX.value, value=2),
            StatusEffect(StatusKind.LESSON_BUFF_ADDITIVE_MULTIPLE.value, value=500),
        ])
        seq.parameter.status_effects.add_lesson_buff(3, context)
        self.assertEqual(seq.parameter.status_effects.value(StatusKind.LESSON_BUFF), 8)


class CardMoveTests(unittest.TestCase):
    def test_shuffle_deck_uses_sequence_rng(self):
        deck = [card(x, x, []) for x in "ABCDEFGH"]
        seq = make_sequence(deck=deck)
        context = ExamEffectCalculateContext.create(seq)
        seq.card_controller.shuffle_deck(context)
        self.assertEqual([c.produce_card_id for c in seq.deck.cards], list("GFECBHDA"))
        self.assertEqual(seq.parameter.rng.state, 0x89CA4F1D)

    def test_hand_hold_leaves_hand_unchanged(self):
        hand = [card("a", "a", []), card("b", "b", [])]
        hold = StatusEffect(kind=StatusKind.HAND_HOLD.value, turn=1, turn_limited=True)
        seq = make_sequence(statuses=[hold], hand=hand)
        context = ExamEffectCalculateContext.create(seq)
        seq.card_controller.reset_hand(context)
        self.assertEqual([c.produce_card_id for c in seq.hand.cards], ["a", "b"])
        self.assertEqual(seq.grave.cards, [])

    def test_sequence_copy_preserves_rng_state(self):
        seq = make_sequence(deck=[card(x, x, []) for x in "ABCDE"])
        seq.deck.shuffle(seq.parameter.rng)
        copy = seq.deep_copy()
        self.assertEqual(seq.parameter.rng.state, copy.parameter.rng.state)
        self.assertEqual(seq.deck.identity(), copy.deck.identity())
        seq.parameter.rng.next_u32()
        self.assertNotEqual(seq.parameter.rng.state, copy.parameter.rng.state)


if __name__ == "__main__":
    unittest.main()

import unittest

from exam_engine import (
    ExamEffect,
    ExamEffectCalculateContext,
    ExamEffectResolver,
    ExamParameterModel,
    ExamCardPoolModel,
    ExamPhase,
    StrictExamSequence,
    LessonEffectExecutor,
    LessonFixEffectExecutor,
    BlockEffectExecutor,
    DrawEffectExecutor,
    ExtraTurnEffectExecutor,
    ParameterBuffEffectExecutor,
    ReviewEffectExecutor,
    LessonBuffEffectExecutor,
)


def sequence():
    return StrictExamSequence(
        parameter=ExamParameterModel(
            seed=0xdeadbeef,
            current_turn=1,
            remain_turn=7,
            stamina=35,
            max_stamina=50,
            phase=ExamPhase.MAIN,
        ),
        hand=ExamCardPoolModel(),
        deck=ExamCardPoolModel(),
    )


class NativeNameTests(unittest.TestCase):
    def test_model_fields_read_and_write_through_legacy_attributes(self):
        s = sequence()
        p = s.parameter
        self.assertEqual(p.Seed, 0xdeadbeef)
        self.assertEqual(p.CurrentTurn, 1)
        p.JudgeParameter = 250
        self.assertEqual(p.judge_parameter, 250)
        p.stamina = 32
        self.assertEqual(p.Stamina, 32)
        p.TurnCardPlayCount = 3
        self.assertEqual(p.turn_card_play_count, 3)
        self.assertIs(p.StatusEffectCollection, p.status_effects)
        p.RemainTurn = 4
        self.assertEqual(p.remain_turn, 4)
        self.assertEqual(p.DeepCopy().CurrentTurn, p.current_turn)

    def test_calculate_context_and_native_method_aliases(self):
        s = sequence()
        ctx = ExamEffectCalculateContext.Create(s)
        self.assertIs(ctx.ExamParameter, s.parameter)
        self.assertIs(ctx.CardController, s.card_controller)
        self.assertIs(ctx.HandList, s.hand)
        self.assertIs(ctx.DeckList, s.deck)
        self.assertIs(ctx.GraveList, s.grave)
        self.assertIs(ctx.LostList, s.lost)
        self.assertIs(ctx.HoldList, s.hold)
        ctx.PlayingEffect = ExamEffect('LessonFix', value=2)
        self.assertEqual(ctx.playing_effect.kind, 'LessonFix')
        ctx.Reset()
        self.assertIsNone(ctx.PlayingEffect)
        self.assertEqual(ExamEffectUtilityBridge(ctx), 0)

    def test_native_executors_match_resolver_dispatch(self):
        executor_types = {
            'Lesson': LessonEffectExecutor,
            'LessonFix': LessonFixEffectExecutor,
            'Block': BlockEffectExecutor,
            'Draw': DrawEffectExecutor,
            'ExtraTurn': ExtraTurnEffectExecutor,
            'ParameterBuff': ParameterBuffEffectExecutor,
            'Review': ReviewEffectExecutor,
            'LessonBuff': LessonBuffEffectExecutor,
        }
        for kind, executor_type in executor_types.items():
            with self.subTest(kind=kind):
                first = sequence()
                second = first.deep_copy()
                effect = ExamEffect(kind, value=0 if kind == 'Draw' else 1 if kind == 'ExtraTurn' else 2, count=1, turn=2)
                executor_type(ExamEffectCalculateContext.Create(first)).ExecuteEffect(effect)
                ExamEffectResolver(ExamEffectCalculateContext.Create(second)).execute(effect)
                self.assertEqual(first.parameter.identity(), second.parameter.identity())
                self.assertEqual(first.card_controller.identity(), second.card_controller.identity())


def ExamEffectUtilityBridge(ctx):
    # Calling a native-named utility without a status-dependent modifier.
    from exam_engine import ExamEffectUtility
    return ExamEffectUtility.CalculateAddingParameter(0, ctx)


if __name__ == '__main__':
    unittest.main()

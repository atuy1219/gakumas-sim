import unittest

from official_contest_ai import (
    ExamDepthFirstSearchVersionType,
    ExamSetting,
    ProduceExamAutoResourceEvaluation,
    ProducePlanType,
    XorShift32,
    apply_resource_evaluation_score,
    get_calculate_command,
    get_calculate_turn,
    get_exam_depth_first_search_version_type,
    leaf_term,
)


class ContestPrimitiveTests(unittest.TestCase):
    def test_dfs_version(self):
        self.assertEqual(
            get_exam_depth_first_search_version_type(ExamSetting(0, [7, 8, 9])),
            ExamDepthFirstSearchVersionType.UNKNOWN,
        )
        self.assertEqual(
            get_exam_depth_first_search_version_type(ExamSetting(1, [7, 8, 9])),
            ExamDepthFirstSearchVersionType.V1,
        )
        self.assertEqual(
            get_exam_depth_first_search_version_type(ExamSetting(2, [7, 8, 9])),
            ExamDepthFirstSearchVersionType.V2,
        )

    def test_calculate_turn_and_command(self):
        v1 = ExamSetting(1, [11, 22, 33])
        v2 = ExamSetting(2, [11, 22, 33])
        self.assertEqual(get_calculate_turn(v1, ProducePlanType.PLAN1), 2)
        self.assertEqual(get_calculate_turn(v1, ProducePlanType.PLAN2), 2)
        self.assertEqual(get_calculate_turn(v1, ProducePlanType.PLAN3), 1)
        self.assertEqual(get_calculate_turn(v2, ProducePlanType.PLAN3), 2)
        self.assertEqual(get_calculate_command(v2, ProducePlanType.PLAN1), 11)
        self.assertEqual(get_calculate_command(v2, ProducePlanType.PLAN2), 22)
        self.assertEqual(get_calculate_command(v2, ProducePlanType.PLAN3), 33)

    def test_rng_matches_common_engine_vector(self):
        rng = XorShift32(0x12345678)
        self.assertEqual(rng.next_u32(), 0x87985AA5)
        self.assertEqual(rng.next_u32(), 0x155B24A3)
        self.assertEqual(rng.next_u32(), 0x4820F4C4)

    def test_leaf_term(self):
        self.assertEqual(leaf_term(10, 2), 6)
        self.assertEqual(leaf_term(9, 2), 5)
        self.assertEqual(leaf_term(0, 2), 1)

    def test_resource_evaluation_add_only(self):
        row = ProduceExamAutoResourceEvaluation(0, 0, 0, 0, 0, 5, 0)
        self.assertEqual(apply_resource_evaluation_score(3, 10, row), 45)

    def test_resource_evaluation_multiplication(self):
        row = ProduceExamAutoResourceEvaluation(0, 0, 0, 0, 0, 100, 1200)
        self.assertEqual(apply_resource_evaluation_score(3, 10, row), 36)


if __name__ == "__main__":
    unittest.main()

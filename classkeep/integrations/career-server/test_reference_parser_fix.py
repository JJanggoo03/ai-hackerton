import unittest
import career_reference_api as parser


class ParserFixTests(unittest.TestCase):
    def test_generic_spec_title_uses_scoped_company_banner(self):
        page = '<title>합격스펙 | 잡코리아</title><div class="company-header-branding-body"><div class="name">삼성전자㈜</div></div>'
        parser._check_identity(page, '삼성전자')
        with self.assertRaises(ValueError):
            parser._check_identity(page.replace('삼성전자㈜', '삼성전자서비스'), '삼성전자')

    def test_body_mention_or_other_company_title_cannot_override_identity(self):
        with self.assertRaises(ValueError):
            parser._check_identity('<title>합격스펙 | 잡코리아</title><p>삼성전자</p>', '삼성전자')
        with self.assertRaises(ValueError):
            parser._check_identity('<title>다른기업 합격스펙</title><div class="company-header-branding-body"><div class="name">삼성전자</div></div>', '삼성전자')

    def test_review_inside_form_remains_readable_but_menu_is_not_a_review(self):
        page = '<title>삼성전자 인적성·면접후기</title><body><form><h2>인적성·면접·합격 후기</h2><p>2023 하반기 소프트웨어개발자</p><p>1. 고사장 시험환경은 어떠했습니까?</p><p>온라인으로 진행했습니다. 시험 전에 환경을 점검했습니다.</p></form></body>'
        self.assertIn('온라인으로 진행', parser._review_text(page))
        self.assertEqual(parser._review_text('<body>인적성·면접·합격 후기 전체 채용시기 면접질문 면접후기 최종합격후기</body>'), '')


if __name__ == '__main__':
    unittest.main()

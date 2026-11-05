import unittest
from datetime import date
from grounded_programs import plan_program_request, answer_program_request, program_records


class GroundedProgramsTests(unittest.TestCase):
    def test_only_explicit_program_requests(self):
        for text in ['내일배움카드가 뭐야?', '취업이 너무 걱정돼', '파이썬 코드를 설명해줘', '내일배움카드 발급 자격 알려줘', '이 과제의 해결 과정을 알려줘', '파이썬 프로그램 사용법 알려줘', '자바 프로그램 코드 알려줘', '삼성전자 지원하려는데 내 프로그램 오류를 알려줘']:
            self.assertIsNone(plan_program_request(text), text)
        plan = plan_program_request('삼성전자 취업하려면 어떤 프로그램을 하면 좋아?', ['파이썬을 배우고 싶어요'])
        self.assertTrue(plan['training'])
        self.assertEqual(plan['keyword'], '파이썬')
        self.assertEqual(plan_program_request('삼성전자 취업 프로그램 추천해줘')['keyword'], '')
        self.assertIsNone(plan_program_request('훈련과정 추천하지 말고 내 자기소개서를 봐줘'))

    def test_provider_dates_links_and_same_title_kept(self):
        records = program_records({'srchList': {'scn_list': [
            {'title': '과정 A', 'subTitle': '기관1', 'titleLink': 'https://example.com/course', 'traStartDate': '2026-11-10', 'traEndDate': '2026-12-10'},
            {'title': '과정 A', 'subTitle': '기관2', 'traStartDate': '2026-12-10', 'traEndDate': '2027-01-10'}]}})
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]['provider'], '기관1')
        self.assertEqual(records[0]['url'], 'https://example.com/course')
        self.assertEqual(records[0]['end'], '2026-12-10')

    def test_actual_program_api_fields(self):
        record = program_records({'empPgmSchdInvite': [{'orgNm': '센터', 'pgmNm': '구직 프로그램', 'pgmSubNm': '면접 준비', 'pgmTarget': '청년 구직자', 'pgmStdt': '20261110', 'pgmEndt': '20261111', 'openPlcCont': '교육실'}]})[0]
        self.assertEqual(record['provider'], '센터')
        self.assertEqual(record['topic'], '면접 준비')
        self.assertEqual(record['target'], '청년 구직자')
        self.assertEqual(record['location'], '교육실')
        self.assertEqual(record['start'], '20261110')
        self.assertEqual(record['end'], '20261111')

    def test_past_courses_excluded_and_no_fabricated_fields(self):
        result = {'source': '고용24 Open API', 'retrieved_at': '2026-11-06', 'data': [
            {'title': '종료된 과정', 'traEndDate': '2024-01-30'},
            {'title': '실제 미래 과정', 'subTitle': '실제 기관', 'traStartDate': '2026-12-01', 'traEndDate': '2027-01-01', 'titleLink': 'https://example.com/course'}]}
        answer = answer_program_request(plan_program_request('파이썬 국비 과정 추천해줘'), search_training=lambda **kw: result, search_jobseeker_programs=lambda **kw: {}, today=date(2026, 11, 6))
        self.assertNotIn('종료된 과정', answer['answer'])
        self.assertIn('실제 미래 과정', answer['answer'])
        self.assertIn('기관 소재지: 응답에 없음', answer['answer'])
        self.assertIn('2026-12-01 ~ 2027-01-01', answer['answer'])
        self.assertGreater(answer['answer'].index('https://example.com/course'), answer['answer'].index('\n출처\n'))
        self.assertEqual(answer['tool_events'], [{'name': 'search_training', 'ok': True}])

    def test_lookup_failure_does_not_invent_program(self):
        answer = answer_program_request(plan_program_request('취업역량 프로그램 추천해줘'), search_training=lambda **kw: {}, search_jobseeker_programs=lambda **kw: {'error': 'bad credentials'})
        self.assertIn('조회에 실패', answer['answer'])
        self.assertNotIn('고용노동부', answer['answer'])
        self.assertEqual(answer['sources'], [])
        self.assertFalse(answer['tool_events'][0]['ok'])

    def test_empty_or_all_expired_records(self):
        for data in [[], [{'pgmNm': '옛 과정', 'pgmEndt': '20240131'}]]:
            result = answer_program_request(plan_program_request('취업역량 프로그램 추천해줘'), search_training=lambda **kw: {}, search_jobseeker_programs=lambda **kw: {'data': data}, today=date(2026, 11, 6))
            self.assertNotIn('옛 과정', result['answer'])
            self.assertIn('원문 URL이 제공되지 않았습니다', result['answer'])

    def test_program_topic_and_target_rendered_without_guessing(self):
        response = {'data': {'empPgmSchdInvite': [{'pgmNm': '취업특강', 'pgmSubNm': '이력서 작성', 'pgmTarget': '구직자', 'pgmEndt': '20261231'}]}}
        result = answer_program_request(plan_program_request('취업 프로그램 추천해줘'), search_training=lambda **kw: response, search_jobseeker_programs=lambda **kw: response, today=date(2026, 11, 6))
        self.assertIn('세부 주제: 이력서 작성', result['answer'])
        self.assertIn('대상: 구직자', result['answer'])
        self.assertEqual(program_records({'title': '국비 과정', 'trainTarget': '실업자'})[0]['target'], '실업자')

    def test_sensitive_url_not_rendered(self):
        record = program_records({'title': '과정', 'titleLink': 'https://example.com/?authKey=secret'})[0]
        self.assertEqual(record['url'], '')

if __name__ == '__main__':
    unittest.main()

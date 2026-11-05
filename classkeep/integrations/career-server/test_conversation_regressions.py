"""Conversation regression checks; all model and API calls are mocked."""
import unittest
from unittest.mock import patch
from flask import Flask
import job_assistant as j
from study_chat_api import register_study_chat_api

class ConversationRegressionTests(unittest.TestCase):
    def test_company_average_question_is_not_personal_profile(self):
        self.assertFalse(j._is_candidate_profile_response('삼성전자 평균 학점 알려줘'))
        self.assertFalse(j._is_candidate_profile_response('토익은 몇 점이 좋아?'))
        self.assertTrue(j._is_candidate_profile_response('학점 3.7/4.5, 토익 835점'))
        self.assertTrue(j._is_candidate_profile_response('저는 컴퓨터공학 전공이에요'))

    def test_partial_profile_keeps_company_and_previous_fields(self):
        state={'pending_company_assessment':{'company_name':'테스트기업','average_spec':{'items':[]}},'candidate_profile':'학점 3.7/4.5'}
        with patch.object(j,'_evaluate_candidate_profile',return_value='평가') as evaluate:
            self.assertEqual(j.chat_turn([], '토익 835점', state),'평가')
            profile=evaluate.call_args.args[0]
            self.assertIn('학점 3.7/4.5',profile)
            self.assertTrue(profile.startswith('토익 835점'))
        self.assertEqual(state['pending_company_assessment']['company_name'],'테스트기업')

    def test_api_error_envelopes_are_not_successful_results(self):
        self.assertIsNotNone(j._api_response_error({'header':{'resultCode':'30','resultMsg':'invalid key'}}))
        self.assertIsNone(j._api_response_error({'header':{'resultCode':'00'},'items':[]}))
        self.assertIsNone(j._api_response_error({'total':'0'}))

    def test_explicit_training_request_does_not_depend_on_model_tool_choice(self):
        state={'user_facts':['파이썬을 배우고 싶어요']}
        fetched={'source':'고용24 Open API','data':{'title':'실제 API 과정','subTitle':'확인된 기관','traEndDate':'2099-12-31','titleLink':'https://example.com/course'}}
        with patch.object(j,'search_training',return_value=fetched) as search, patch.object(j,'_call_ollama',side_effect=AssertionError('must not invent courses')):
            answer=j.chat_turn([], '내일배움카드 과정 추천해줘',state)
        self.assertEqual(search.call_args.kwargs['keyword'],'파이썬')
        self.assertIn('실제 API 과정',answer)
        self.assertIn('확인된 기관',answer)
        self.assertTrue(state['tool_events'][0]['ok'])

    def test_gateway_passes_target_memory_and_selected_evidence(self):
        app=Flask(__name__);register_study_chat_api(app,lambda:None)
        with patch('study_chat_api.chat_turn',return_value='답변') as turn:
            response=app.test_client().post('/api/chat',json={
              'task':'classkeep-study','stream':False,'model':j.OLLAMA_MODEL,
              'messages':[{'role':'system','content':'출처는 아래에 모으세요.'},{'role':'user','content':'참고 자료 시작\n프로젝트: 센서 분석\n참고 자료 끝\n질문: 어떻게 보완할까?'}],
              'career_target':'기계설계','conversation':[{'role':'user','content':'나는 학생이야'}],
              'career_state':{'user_facts':['학점 3.7/4.5']}})
        self.assertEqual(response.status_code,200)
        history,question,state=turn.call_args.args
        self.assertEqual(question,'어떻게 보완할까?')
        self.assertIn('출처는 아래에 모으세요.',history[0]['content'])
        combined='\n'.join(m['content'] for m in history)
        for fact in ['기계설계','센서 분석','학생','학점 3.7/4.5']:self.assertIn(fact,combined)

if __name__=='__main__':unittest.main()

import unittest
from unittest.mock import patch, Mock

import study_chat_api
import web_app


class StudyTests(unittest.TestCase):
    def setUp(self):
        web_app.app.config.update(TESTING=True)
        web_app._external_rate_limits.clear()
        self.client = web_app.app.test_client()
        self.payload = {'task':'classkeep-study', 'model':study_chat_api.OLLAMA_MODEL, 'messages':[{'role':'system','content':'사용자가 취업 정보 출처를 선택했다. Use only these sources.'}, {'role':'user','content':'Source material ' * 300}], 'stream':False}

    def test_materials_and_task_rules_reach_tool_enabled_model(self):
        reply = Mock(status_code=200)
        reply.json.return_value = {'message':{'content':'Grounded answer [1]'}, 'load_duration':100}
        with patch.object(study_chat_api, 'OLLAMA_BASE_URL', 'http://model.example:11434'), patch.object(study_chat_api.requests, 'post', return_value=reply) as post:
            result = self.client.post('/api/chat',json=self.payload)
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json['classkeep_study_version'],1)
        sent = post.call_args.kwargs['json']
        combined='\n'.join(m['content'] for m in sent['messages'])
        self.assertIn(self.payload['messages'][0]['content'],combined)
        self.assertIn(self.payload['messages'][1]['content'].strip(),combined)
        self.assertIn(study_chat_api.SYSTEM_PROMPT,combined)
        self.assertTrue(sent['tools'])
        self.assertFalse(sent['stream'])

    def test_json_mode_preserved_and_no_cross_user_history(self):
        self.payload['format']='json'
        reply=Mock(status_code=200);reply.json.return_value={'message':{'content':'{"mode":"uncertain","companies":[]}'}}
        with patch.object(study_chat_api, 'OLLAMA_BASE_URL', 'http://model.example:11434'), patch.object(study_chat_api.requests, 'post', return_value=reply) as post:
            for _ in range(2):
                self.assertEqual(self.client.post('/api/chat',json=self.payload).status_code,200)
        self.assertEqual(post.call_args.kwargs['json']['format'],'json')
        self.assertEqual(post.call_args.kwargs['json']['messages'], self.payload['messages'])

    def test_bad_model_size_self_loop_and_internal_error(self):
        wrong={**self.payload,'model':'not-installed'}
        self.assertEqual(self.client.post('/api/chat',json=wrong).status_code,404)
        big={**self.payload,'messages':[{'role':'user','content':'가'*53000}]}
        self.assertEqual(self.client.post('/api/chat',json=big).status_code,413)
        with patch.object(study_chat_api,'OLLAMA_BASE_URL','http://localhost:80'):
            self.assertEqual(self.client.post('/api/chat',json=self.payload).status_code,503)
        with patch.object(study_chat_api,'OLLAMA_BASE_URL','http://model.example:11434'), patch.object(study_chat_api.requests,'post',side_effect=study_chat_api.requests.ConnectionError('SECRET_TOKEN')):
            result=self.client.post('/api/chat',json=self.payload)
            self.assertEqual(result.status_code,502);self.assertNotIn('SECRET_TOKEN',result.get_data(as_text=True))

    def test_existing_chat_route_and_version_untouched(self):
        with patch.object(web_app,'chat_turn',return_value='Existing custom chatbot'):
            self.assertEqual(self.client.post('/api/chat',json={'message':'hello'}).json['reply'],'Existing custom chatbot')
        self.assertIn('classkeep-study-v1',self.client.get('/api/version').json['capabilities'])


if __name__=='__main__':
    unittest.main()

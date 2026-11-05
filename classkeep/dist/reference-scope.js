import {careerSiteId,CAREER_SITES} from './career-sites.js';
// Explicit leading @repository and !career-site tokens select sources; ordinary prose is untouched.
export function parseReferenceQuestion(value) {
 if(typeof value!=='string'||value.length>8000)throw Error('질문은 8,000자 이내로 입력해주세요.');
 let rest=value.trimStart();const repositories=[],careerSites=[];
 while(rest.startsWith('@')||rest.startsWith('!')){
  if(rest.startsWith('!')){
   const tag=rest.match(/^!([^\s!@]+)(?=\s|$)/);const id=tag&&careerSiteId(tag[1]);
   if(!id)throw Error('취업 참조는 '+CAREER_SITES.map(s=>s.token).join(', ')+' 중에서 선택해주세요. 기존 취업 사이트 직접 연동은 중단했습니다.');
   if(!careerSites.includes(id))careerSites.push(id);
   rest=rest.slice(tag[0].length).trimStart();continue;
  }
  const match=rest.match(/^@([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+)(?=\s|$)/);
  if(!match)throw Error('GitHub 참조는 문장 앞에 @소유자/저장소 형식으로 입력해주세요.');
  if(!repositories.some(r=>r.toLowerCase()===match[1].toLowerCase()))repositories.push(match[1]);
  if(repositories.length>10)throw Error('한 질문에는 저장소를 최대 10개까지 선택할 수 있습니다.');
  rest=rest.slice(match[0].length).trimStart();
 }
 const question=rest.trim();
 return {source:repositories.length?'github':'archive',repositories,careerSites,question};
}

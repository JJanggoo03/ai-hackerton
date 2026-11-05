export const CAREER_SITES=[
 {id:'government-employment',name:'기업 취업정보',token:'!취업정보',aliases:['정부취업정보','잡코리아'],description:'기업 웹 탐색 · 연결 상태는 서버에서 확인'}
];
export function careerSiteId(token){const value=token.replace(/^!/,'').toLowerCase();return CAREER_SITES.find(s=>s.name===value||s.token.slice(1)===value||s.id===value||s.aliases?.includes(value))?.id;}
export function formatReferenceQuestion({repositories=[],careerSites=[],question=''}){
 return [...repositories.map(r=>'@'+r),...careerSites.map(id=>CAREER_SITES.find(s=>s.id===id)?.token||''),question].filter(Boolean).join(' ');
}
